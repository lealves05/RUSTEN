/* Integração com a central (MASTER do ORBI) — contrato v1.
   Central → RUSTEN: /api/platform/v1/* assinadas. RUSTEN → central: /api/hub/v1/* assinadas.
   Assinatura: HMAC-SHA256 com o segredo do sistema sobre `${timestamp}.${nonce}.${MÉTODO}.${caminho}.${sha256(corpo)}`,
   janela de 5 minutos e nonce de uso único. Sem PLATFORM_SECRET a central fica desligada e nada é bloqueado. */
import crypto from 'node:crypto';
import { q, sha256, safeEqual, HttpError } from './core.js';

export const PRODUCT_CODE = 'rusten';
export const hubConfigured = () => !!(process.env.PLATFORM_SECRET && process.env.PLATFORM_HUB_URL);
const WINDOW_MS = 5 * 60 * 1000;

export function sign(secret, { method, path, body = '', ts = Date.now(), nonce = crypto.randomBytes(16).toString('hex') }) {
  const base = `${ts}.${nonce}.${method.toUpperCase()}.${path}.${sha256(body)}`;
  const sig = crypto.createHmac('sha256', secret).update(base).digest('hex');
  return { 'x-platform-timestamp': String(ts), 'x-platform-nonce': nonce, 'x-platform-signature': sig, 'x-platform-product': PRODUCT_CODE };
}

// Middleware para rotas chamadas pela central. Corpo cru guardado em req.rawBody (ver server.js).
export async function verifyPlatform(req, _res, next) {
  try {
    const secret = process.env.PLATFORM_SECRET;
    if (!secret) throw new HttpError(503, 'Central não configurada', 'platform_disabled');
    const ts = Number(req.headers['x-platform-timestamp']);
    const nonce = String(req.headers['x-platform-nonce'] || '');
    const sig = String(req.headers['x-platform-signature'] || '');
    if (!ts || Math.abs(Date.now() - ts) > WINDOW_MS) throw new HttpError(401, 'Assinatura expirada', 'bad_signature');
    if (!/^[a-zA-Z0-9_-]{16,64}$/.test(nonce)) throw new HttpError(401, 'Nonce inválido', 'bad_signature');
    const expected = sign(secret, { method: req.method, path: req.originalUrl.split('?')[0], body: req.rawBody || '', ts, nonce })['x-platform-signature'];
    if (!safeEqual(expected, sig)) throw new HttpError(401, 'Assinatura inválida', 'bad_signature');
    const r = await q('insert into platform_nonces (nonce) values ($1) on conflict do nothing returning nonce', [nonce]);
    if (!r.rows[0]) throw new HttpError(401, 'Requisição repetida', 'replay');
    await q("delete from platform_nonces where created_at < now() - interval '1 day'");
    next();
  } catch (e) { next(e); }
}

export async function callHub(method, path, payload) {
  if (!hubConfigured()) throw new HttpError(503, 'Central não configurada', 'platform_disabled');
  const base = new URL(process.env.PLATFORM_HUB_URL);
  if (base.protocol !== 'https:' && process.env.NODE_ENV === 'production') throw new Error('PLATFORM_HUB_URL deve usar HTTPS');
  const body = payload ? JSON.stringify(payload) : '';
  const res = await fetch(new URL(path, base), {
    method,
    headers: { 'content-type': 'application/json', ...sign(process.env.PLATFORM_SECRET, { method, path, body }) },
    body: body || undefined,
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  if (!res.ok) throw new HttpError(502, data?.error || `Central respondeu ${res.status}`, 'hub_error');
  return data;
}

export async function tenantSummary(db, companyId) {
  const { rows } = await db.query(
    `select c.id, c.name, c.segment, c.document, c.email, c.phone, c.created_at, c.last_access_at, c.access,
            (select json_build_object('name', u.name, 'email', u.email) from users u where u.company_id = c.id and u.role_key = 'owner' order by u.id limit 1) as owner,
            (select count(*)::int from units where company_id = c.id) as units,
            (select count(*)::int from users where company_id = c.id and active) as users,
            (select count(*)::int from terminals where company_id = c.id and active) as terminals
       from companies c where c.id = $1`, [companyId]);
  const c = rows[0];
  if (!c) return null;
  return { remote_id: String(c.id), product: PRODUCT_CODE, name: c.name, segment: c.segment, document: c.document,
    email: c.email, phone: c.phone, owner: c.owner, created_at: c.created_at, last_access_at: c.last_access_at,
    usage: { units: c.units, users: c.users, terminals: c.terminals }, access: c.access };
}

// Eventos para a central saem por outbox: o cadastro não depende da central estar no ar
export async function enqueueHub(db, companyId, kind, payload = {}) {
  if (!hubConfigured()) return;
  await db.query('insert into platform_outbox (company_id, kind, payload) values ($1,$2,$3)', [companyId, kind, payload]);
}

export async function flushOutbox(limit = 20) {
  if (!hubConfigured()) return { sent: 0, failed: 0 };
  const { rows } = await q(`select * from platform_outbox where sent_at is null and attempts < 20
                            order by id limit $1`, [limit]);
  let sent = 0; let failed = 0;
  for (const ev of rows) {
    try {
      if (ev.kind === 'tenant.created' || ev.kind === 'tenant.updated') {
        const summary = await tenantSummary({ query: q }, ev.company_id);
        const resp = await callHub('POST', '/api/hub/v1/tenants', summary);
        if (resp?.access) await applyAccess(ev.company_id, resp.access);
      }
      await q('update platform_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1', [ev.id]);
      sent++;
    } catch (e) {
      await q('update platform_outbox set attempts = attempts + 1, last_error = $2 where id = $1', [ev.id, String(e.message).slice(0, 300)]);
      failed++;
    }
  }
  return { sent, failed };
}

const ACCESS_KEYS = ['status', 'blocked', 'block_reason', 'admin_block', 'manual_release_until', 'paid_until', 'trial_ends_at',
  'grace_until', 'plan', 'cycle', 'modules', 'limits', 'warning', 'support'];
export async function applyAccess(companyId, access) {
  const clean = Object.fromEntries(Object.entries(access || {}).filter(([k]) => ACCESS_KEYS.includes(k)));
  const r = await q('update companies set access = $2, access_updated_at = now() where id = $1 returning id', [companyId, clean]);
  return !!r.rows[0];
}
