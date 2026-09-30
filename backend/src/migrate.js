// Aplica migrações SQL versionadas em ordem, cada uma numa transação, com trava para instâncias simultâneas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './lib/core.js';
import { env } from './lib/env.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate({ log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(424242)');
    await client.query(`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
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
    await client.query('select pg_advisory_unlock(424242)').catch(() => {});
    client.release();
  }
}

if (!env.EDGE_RUNTIME && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e.message); process.exit(1); });
}
