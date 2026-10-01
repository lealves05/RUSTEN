/* Ligação do RUSTEN com a central da plataforma (MASTER do ORBI) — contrato v1, o mesmo do TORVEN.

   A central decide assinatura, período de teste, bloqueio e módulos de cada empresa, com a mesma base de cobrança
   de todos os sistemas. O RUSTEN guarda a última situação recebida (companies.access) e aplica o portão localmente;
   se a central ficar fora do ar, vale a última situação conhecida (falha da central nunca bloqueia ninguém).

   Assinatura nos dois sentidos, com o segredo do sistema cadastrado na central:
     X-Platform-Product · X-Platform-Timestamp (segundos) ·
     X-Platform-Signature = hex(HMAC-SHA256(segredo, `${ts}\n${MÉTODO}\n${rota}\n${sha256(corpo)}`))
   `rota` é relativa à base do contrato, com a query: /api/platform/v1 (central → RUSTEN) e /api/hub/v1 (RUSTEN → central).

   Configuração: PLATFORM_HUB_URL + PLATFORM_SECRET (+ PLATFORM_PRODUCT, padrão "rusten") nas variáveis de ambiente ou,
   na Edge Function, na tabela platform_config (platform_hub_url, platform_secret). Sem configuração, nada é bloqueado. */
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { q, sha256, HttpError } from './core.js';
import { MODULES } from './catalog.js';
import { env } from './env.js';

export const PRODUCT_CODE = 'rusten';
export const CONTRACT_VERSION = 1;
export const RUSTEN_VERSION = '2026.10';
const SKEW_S = 300;
const FRESH_MS = 5 * 60 * 1000;
let hubDownUntil = 0; // central fora do ar há pouco: não espera o tempo limite a cada requisição

// ---------------- configuração ----------------
let cfgCache = { at: 0, v: null };
export async function platformConfig() {
  if (Date.now() - cfgCache.at < 60000) return cfgCache.v;
  let hub = env.PLATFORM_HUB_URL || '';
  let secret = env.PLATFORM_SECRET || '';
  let product = env.PLATFORM_PRODUCT || '';
  if (!hub || !secret) {
    try {
      const { rows } = await q(`select key, value from platform_config where key in ('platform_hub_url','platform_secret','platform_product')`);
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      hub ||= m.platform_hub_url || ''; secret ||= m.platform_secret || ''; product ||= m.platform_product || '';
    } catch { /* tabela ainda não criada */ }
  }
  const v = hub && secret ? { hub: hub.replace(/\/+$/, ''), secret, product: product || PRODUCT_CODE } : null;
  cfgCache = { at: Date.now(), v };
  return v;
}
export const clearPlatformConfig = () => { cfgCache.at = 0; };
export const hubConfigured = async () => !!(await platformConfig());

export const signPayload = (secret, ts, method, route, body) =>
  crypto.createHmac('sha256', secret).update(`${ts}\n${String(method).toUpperCase()}\n${route}\n${sha256(body || '')}`).digest('hex');

// ---------------- RUSTEN → central ----------------
export async function hubCall(method, route, payload, timeoutMs = 10000) {
  const cfg = await platformConfig();
  if (!cfg) throw new HttpError(503, 'A assinatura ainda não está configurada nesta instalação. Fale com o suporte.', 'platform_not_configured');
  if (!/^https:\/\//.test(cfg.hub) && env.NODE_ENV === 'production') throw new HttpError(503, 'Endereço da central deve usar HTTPS', 'platform_not_configured');
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  let res;
  try {
    res = await fetch(`${cfg.hub}/api/hub/v1${route}`, {
      method, signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', 'X-Platform-Product': cfg.product, 'X-Platform-Timestamp': String(ts),
        'X-Platform-Signature': signPayload(cfg.secret, ts, method, route, body) },
      body: body || undefined,
    });
  } catch {
    throw new HttpError(503, 'A central de assinaturas não respondeu. Tente novamente em instantes.', 'platform_unavailable');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 401 ? 502 : res.status, data?.error || `Central: erro ${res.status}`, data?.code || 'hub_error');
  return data;
}

/** Dados da empresa enviados à central (sem senhas, tokens nem dados sensíveis). */
export async function tenantPayload(companyId) {
  const { rows } = await q(
    `select c.id, c.name, c.email, c.phone, c.document, c.created_at, c.is_demo,
            (select u.name from users u where u.company_id = c.id and u.role_key = 'owner' order by u.id limit 1) as owner_name,
            (select u.email from users u where u.company_id = c.id and u.role_key = 'owner' order by u.id limit 1) as owner_email,
            greatest(c.last_access_at, (select max(s.created_at) from user_sessions s join users u on u.id = s.user_id where u.company_id = c.id)) as last_access_at,
            (select count(*)::int from users where company_id = c.id and active) as users,
            (select count(*)::int from units where company_id = c.id and active) as units,
            (select count(*)::int from terminals where company_id = c.id and active) as terminals,
            (select count(*)::int from dining_tables where company_id = c.id and active) as tables,
            (select count(*)::int from consumption_sessions where company_id = c.id and opened_at > now() - interval '30 days') as consumptions_30d,
            (select coalesce(sum(amount_cents),0)::bigint from payments where company_id = c.id and status = 'confirmado'
               and created_at > now() - interval '30 days') as revenue_30d_cents
       from companies c where c.id = $1`, [companyId]);
  const c = rows[0];
  if (!c) return null;
  return {
    remote_id: String(c.id), name: c.name, email: c.owner_email || c.email, phone: c.phone, document: c.document,
    owner_name: c.owner_name, owner_email: c.owner_email, created_at: c.created_at, last_access_at: c.last_access_at, is_demo: c.is_demo,
    metrics: { users: c.users, units: c.units, terminals: c.terminals, tables: c.tables, consumptions_30d: c.consumptions_30d,
      revenue_30d: Number(c.revenue_30d_cents) / 100 },
  };
}

export async function storeAccess(companyId, access) {
  await q('update companies set access = $2, access_updated_at = now() where id = $1', [companyId, access || {}]);
}

/** Cadastra (ou atualiza) a empresa na central e guarda a situação recebida. Demonstrações nunca são cadastradas. */
export async function registerCompany(companyId, timeoutMs = 10000) {
  if (!(await platformConfig())) return null;
  const t = await tenantPayload(companyId);
  if (!t || t.is_demo) return null;
  const { is_demo: _d, owner_email: _o, ...payload } = t;
  const out = await hubCall('POST', '/tenants', payload, timeoutMs);
  if (out?.access) await storeAccess(companyId, out.access);
  return out?.access || null;
}

/**
 * Atualiza a situação guardada quando tiver mais de 5 min (ou sempre, com fresh). Devolve a situação bruta da central,
 * ou null quando não há central configurada / empresa de demonstração. Falha da central mantém a última situação.
 */
export async function refreshAccess(company, { fresh = false } = {}) {
  if (!company || company.is_demo) return null;
  const cfg = await platformConfig();
  if (!cfg) return null;
  const age = company.access_updated_at ? Date.now() - new Date(company.access_updated_at).getTime() : Infinity;
  const has = company.access && Object.keys(company.access).length;
  if (!fresh && has && age < FRESH_MS) return company.access;
  if (!fresh && Date.now() < hubDownUntil) return has ? company.access : null;
  try {
    const out = await hubCall('GET', `/tenants/${encodeURIComponent(company.id)}/access`, undefined, 4000);
    await storeAccess(company.id, out.access);
    return out.access;
  } catch (e) {
    if (e.status === 404) { try { return await registerCompany(company.id, 4000); } catch { /* segue com a última situação */ } }
    else hubDownUntil = Date.now() + 60000;
    return has ? company.access : null;
  }
}

// Eventos para a central saem por outbox: o cadastro da empresa não depende da central estar no ar
export async function enqueueHub(db, companyId, kind, payload = {}) {
  if (!(await platformConfig())) return;
  await db.query('insert into platform_outbox (company_id, kind, payload) values ($1,$2,$3)', [companyId, kind, payload]);
}

export async function flushOutbox(limit = 20) {
  if (!(await platformConfig())) return { sent: 0, failed: 0 };
  const { rows } = await q('select * from platform_outbox where sent_at is null and attempts < 20 order by id limit $1', [limit]);
  let sent = 0; let failed = 0;
  for (const ev of rows) {
    try {
      if (ev.kind === 'tenant.created' || ev.kind === 'tenant.updated') await registerCompany(ev.company_id);
      await q('update platform_outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1', [ev.id]);
      sent++;
    } catch (e) {
      await q('update platform_outbox set attempts = attempts + 1, last_error = $2 where id = $1', [ev.id, String(e.message).slice(0, 300)]);
      failed++;
    }
  }
  return { sent, failed };
}

// ---------------- central → RUSTEN ----------------
/** Aceita só chamadas assinadas pela central com o segredo deste sistema (janela de 5 min, sem repetição). */
export async function verifyHubRequest(req, _res, next) {
  try {
    const cfg = await platformConfig();
    const deny = () => new HttpError(401, 'Chamada da central não autenticada.', 'bad_signature');
    if (!cfg) throw new HttpError(503, 'Ligação com a central não configurada.', 'platform_not_configured');
    const ts = Number(req.headers['x-platform-timestamp']);
    const sig = String(req.headers['x-platform-signature'] || '');
    if (String(req.headers['x-platform-product'] || '') !== cfg.product || !Number.isFinite(ts) || !/^[0-9a-f]{64}$/.test(sig)) throw deny();
    if (Math.abs(Date.now() / 1000 - ts) > SKEW_S) throw deny();
    const want = signPayload(cfg.secret, ts, req.method, req.url, req.rawBody || '');
    if (!crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) throw deny();
    // a mesma assinatura não é aceita duas vezes dentro da janela
    const r = await q('insert into platform_nonces (nonce) values ($1) on conflict do nothing returning nonce', [sig]);
    if (!r.rows[0]) throw new HttpError(401, 'Chamada repetida.', 'replay');
    await q("delete from platform_nonces where created_at < now() - interval '1 day'");
    next();
  } catch (e) { next(e); }
}

export const FEATURES = MODULES; // módulos que a central pode ligar/desligar por plano ou empresa
