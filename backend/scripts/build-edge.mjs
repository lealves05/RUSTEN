// Gera edge/index.js (API inteira num arquivo) para a Supabase Edge Function "rusten-api".
// Pacotes npm ficam externos como "npm:pacote@versão" (o Deno os instala); built-ins "node:*" também.
import { build } from 'esbuild';
import fs from 'node:fs';

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
  entryPoints: [new URL('../src/edge.js', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', target: 'es2022',
  outfile: new URL('../edge/index.js', import.meta.url).pathname,
  plugins: [npmExternal],
  banner: { js: '// RUSTEN API — gerado por scripts/build-edge.mjs. Não editar à mão.' },
  minify: process.argv.includes('--minify'),
  legalComments: 'none',
  lineLimit: 180,
  logLevel: 'info',
});

// Publicação sem reenviar o código à Supabase: o pacote vai junto com o site (rusten.vercel.app/edge/rusten-api.js)
// e a Edge Function é só uma carregadora pequena que baixa e executa a versão publicada.
const bundle = fs.readFileSync(new URL('../edge/index.js', import.meta.url));
const pub = new URL('../../frontend/public/edge/', import.meta.url);
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(new URL('rusten-api.js', pub), bundle);
const deps = Object.keys(pkg.dependencies).filter((d) => bundle.includes(`"npm:${d}@`) || bundle.includes(`'npm:${d}@`) || bundle.includes(`npm:${d}@`));
const loader = `// RUSTEN API — carregadora (gerada por scripts/build-edge.mjs). Publique como Edge Function "rusten-api" (verify_jwt = false).
// O código da API é publicado junto com o site; cada instância nova baixa a versão atual.
${deps.map((d) => `import 'npm:${d}@${version(d)}';`).join('\n')}

const BUNDLE = Deno.env.get('RUSTEN_BUNDLE_URL') || 'https://rusten.vercel.app/edge/rusten-api.js';
const res = await fetch(\`\${BUNDLE}?t=\${Date.now()}\`);
if (!res.ok) throw new Error(\`Não foi possível baixar a API (\${res.status})\`);
await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(await res.text()));
`;
fs.writeFileSync(new URL('../edge/loader.ts', import.meta.url), loader);
console.log(`pacote publicado em frontend/public/edge/rusten-api.js (${(bundle.length / 1024).toFixed(0)} KB) e carregadora em edge/loader.ts`);
