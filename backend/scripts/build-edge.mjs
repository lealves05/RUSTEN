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
