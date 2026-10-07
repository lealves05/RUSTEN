import { fileURLToPath } from 'node:url';
// Gera edge/index.js (API inteira num arquivo) para a Supabase Edge Function "rusten-api".
// Pacotes npm ficam externos como "npm:pacote@versão" (o Deno os instala); built-ins "node:*" também.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)));
const version = (name) => lock.packages[`node_modules/${name}`]?.version || pkg.dependencies[name].replace(/^[\^~]/, '');

const npmExternal = {
  name: 'npm-external',
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('node:')) return { path: args.path, external: true };
      const name = args.path.startsWith('@') ? args.path.split('/').slice(0, 2).join('/') : args.path.split('/')[0];
      if (!pkg.dependencies[name]) return undefined;
      const sub = args.path.slice(name.length);
      return { path: `npm:${name}@${version(name)}${sub}`, external: true };
    });
  },
};

await build({
  entryPoints: [fileURLToPath(new URL('../src/edge.js', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', target: 'es2022',
  outfile: fileURLToPath(new URL('../edge/index.js', import.meta.url)),
  plugins: [npmExternal],
  banner: { js: '// RUSTEN API — gerado por scripts/build-edge.mjs. Não editar à mão.' },
  minify: process.argv.includes('--minify'),
  legalComments: 'none',
  lineLimit: 180,
  logLevel: 'info',
});

// Publicação sem reenviar o código à Supabase: o pacote vai junto com o site (rusten.lorler.com.br/edge/rusten-api.js)
// e a Edge Function é só uma carregadora pequena que baixa e executa a versão publicada.
const bundle = fs.readFileSync(new URL('../edge/index.js', import.meta.url));
const pub = new URL('../../frontend/public/edge/', import.meta.url);
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(new URL('rusten-api.js', pub), bundle);
const deps = Object.keys(pkg.dependencies).filter((d) => bundle.includes(`"npm:${d}@`) || bundle.includes(`'npm:${d}@`) || bundle.includes(`npm:${d}@`));
const loader = `// RUSTEN API — carregadora (gerada por scripts/build-edge.mjs). Publique como Edge Function "rusten-api" (verify_jwt = false).
// O código da API é publicado junto com o site; cada instância nova baixa a versão atual.
${deps.map((d) => `import 'npm:${d}@${version(d)}';`).join('\n')}

// Ordem: endereço configurado (secret RUSTEN_BUNDLE_URL), site na Cloudflare e, durante a transição, o site antigo.
const SOURCES = [Deno.env.get('RUSTEN_BUNDLE_URL'), 'https://rusten.lorler.com.br/edge/rusten-api.js', 'https://rusten.vercel.app/edge/rusten-api.js']
  .filter((u, i, a) => u && /^https:\\/\\//.test(u) && a.indexOf(u) === i);
let code = null;
const errors = [];
for (const url of SOURCES) {
  try {
    const res = await fetch(\`\${url}?t=\${Date.now()}\`, { signal: AbortSignal.timeout(8000) });
    if (res.ok && /javascript/.test(res.headers.get('content-type') || '')) { code = await res.text(); break; }
    errors.push(\`\${new URL(url).host}: \${res.status}\`);
  } catch (e) { errors.push(\`\${new URL(url).host}: \${e?.name || 'erro'}\`); }
}
if (!code) throw new Error(\`Não foi possível baixar a API (\${errors.join('; ')})\`);
await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));
`;
fs.writeFileSync(new URL('../edge/loader.ts', import.meta.url), loader);
console.log(`pacote publicado em frontend/public/edge/rusten-api.js (${(bundle.length / 1024).toFixed(0)} KB) e carregadora em edge/loader.ts`);

// Função com o pacote embutido para o site na Cloudflare ("rusten-api-cf"): inicia sem baixar nada de outro site.
// Publicar: npx supabase functions deploy rusten-api-cf --project-ref <ref> --no-verify-jwt --use-api
{
    const fnDir = new URL('../supabase/functions/rusten-api-cf/', import.meta.url);
  fs.mkdirSync(fnDir, { recursive: true });
  // Pacote como módulo comum ao lado da função (app.js): a Supabase compila uma vez na publicação e cada instância nova
  // só carrega o módulo — sem descompactar base64/gzip nem recompilar via data: URL a cada início (início ~40% mais rápido).
  fs.writeFileSync(new URL('app.js', fnDir), `// RUSTEN API (site na Cloudflare) — gerado por scripts/build-edge.mjs. Não edite: rode o build de novo.\n${bundle}`);
  fs.writeFileSync(new URL('index.ts', fnDir), `// RUSTEN API (site na Cloudflare) — gerado por scripts/build-edge.mjs. Não edite: rode o build de novo.
// Edge Function "rusten-api-cf" com verify_jwt = false (a API faz a própria autenticação). O código da API está em app.js.
import './app.js';
`);
  console.log(`supabase/functions/rusten-api-cf/index.ts (app.js ${((bundle.length) / 1024).toFixed(0)} KB) pronto.`);
}
