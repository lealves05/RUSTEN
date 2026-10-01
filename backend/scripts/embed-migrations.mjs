// Gera src/migrations.gen.js com as migrações SQL embutidas (a Edge Function não lê arquivos do disco).
// Rodar sempre que criar uma migração nova: node scripts/embed-migrations.mjs
import fs from 'node:fs';
const dir = new URL('../src/migrations/', import.meta.url);
const list = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
  .map((name) => ({ name, sql: fs.readFileSync(new URL(name, dir), 'utf8') }));
fs.writeFileSync(new URL('../src/migrations.gen.js', import.meta.url),
  `// Gerado por scripts/embed-migrations.mjs — não editar à mão.\nexport const MIGRATIONS = ${JSON.stringify(list, null, 1)};\n`);
console.log(`${list.length} migrações embutidas`);
