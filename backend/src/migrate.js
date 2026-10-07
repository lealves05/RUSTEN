// Aplica migrações SQL versionadas em ordem, cada uma numa transação, com trava para instâncias simultâneas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './lib/core.js';
import { env } from './lib/env.js';

const dir = import.meta.url.startsWith('file:') ? path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations') : 'migrations';

export async function migrate({ log = console.log } = {}) {
  // na Edge Function não há arquivos: usa as migrações embutidas (scripts/embed-migrations.mjs)
  const list = env.EDGE_RUNTIME
    ? (await import('./migrations.gen.js')).MIGRATIONS
    : fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort().map((name) => ({ name, sql: null }));
  const client = await pool.connect();
  let locked = false;
  try {
    // caminho rápido (cada instância nova da Edge Function passa por aqui): se todas as migrações deste pacote já
    // estão registradas, uma consulta basta — sem trava, sem DDL. Só com migração pendente segue o caminho completo.
    try {
      const names = list.map((m) => m.name);
      const { rows: [c] } = await client.query('select count(*)::int as n from schema_migrations where name = any($1::text[])', [names]);
      if (c.n === names.length) return;
    } catch { /* tabela de controle ainda não existe: caminho completo */ }
    await client.query('select pg_advisory_lock(424242)');
    locked = true;
    await client.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
    for (const { name: f, sql: embedded } of list) {
      if (done.has(f)) continue;
      const sql = embedded ?? fs.readFileSync(path.join(dir, f), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations(name) values ($1)', [f]);
        await client.query('commit');
        log(`migração aplicada: ${f}`);
      } catch (e) {
        await client.query('rollback');
        throw new Error(`falha na migração ${f}: ${e.message}`);
      }
    }
  } finally {
    if (locked) await client.query('select pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
}

if (!env.EDGE_RUNTIME && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1); });
}
