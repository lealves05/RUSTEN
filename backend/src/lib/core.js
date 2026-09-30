// Núcleo compartilhado: banco, erros, validação, dinheiro e datas comerciais.
import pg from 'pg';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { env } from './env.js';

pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number (centavos cabem com folga em 2^53)
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric (quantidades) → number
pg.types.setTypeParser(1082, (v) => v); // date como texto AAAA-MM-DD

const isLocal = (url) => /localhost|127\.0\.0\.1|\/tmp/.test(url || '');
const dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
export const pool = new pg.Pool({
  connectionString: dbUrl,
  ssl: dbUrl && !isLocal(dbUrl) ? { rejectUnauthorized: false } : undefined,
  max: Number(env.DB_POOL_MAX || 10),
});
// Esquema próprio (ex.: RUSTEN hospedado no mesmo projeto Supabase de outro sistema)
const schema = env.DB_SCHEMA;
if (schema) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('DB_SCHEMA inválido');
  pool.on('connect', (client) => { client.query(`set search_path to ${schema}, public`).catch(() => {}); });
}

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const bad = (msg, code = 'invalid') => new HttpError(400, msg, code);
export const forbidden = (msg = 'Sem permissão para esta ação', code = 'forbidden') => new HttpError(403, msg, code);
export const notFound = (msg = 'Não encontrado') => new HttpError(404, msg, 'not_found');
export const conflict = (msg, code = 'conflict', extra) => new HttpError(409, msg, code, extra);

export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    throw bad(`${i.path.join('.') || 'dados'}: ${i.message}`);
  }
  return r.data;
}

// Rotas assíncronas: erros vão para o tratador central
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Dinheiro sempre em centavos inteiros. Quantidade com até 3 casas.
export function lineTotal(unitCents, qty, modifiersCents = 0, discountCents = 0) {
  const qtyMilli = Math.round(Number(qty) * 1000);
  const gross = Math.round(((unitCents + modifiersCents) * qtyMilli) / 1000);
  return Math.max(0, gross - discountCents);
}

// Rateio determinístico: partes iguais, centavos restantes vão para as primeiras partes
export function splitCents(total, parts) {
  const base = Math.floor(total / parts);
  const rest = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

// Dia comercial: antes do horário de corte, conta no dia anterior (jornada que cruza a meia-noite)
export function businessDate(date, timezone = 'America/Sao_Paulo', cutoffHour = 5) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  let d = new Date(Date.UTC(+get('year'), +get('month') - 1, +get('day')));
  if (+get('hour') < cutoffHour) d = new Date(d.getTime() - 86400000);
  return d.toISOString().slice(0, 10);
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Neutraliza fórmulas em CSV (=, +, -, @, tab, CR)
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
