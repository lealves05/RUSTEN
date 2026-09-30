// Autenticação, contexto da requisição, permissões, auditoria e política de acesso da assinatura.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import jwt from 'jsonwebtoken';
import { q, HttpError, forbidden } from './core.js';
import { MODULES } from './catalog.js';
import { env } from './env.js';

const isProd = env.NODE_ENV === 'production';
// Em Supabase Edge sem JWT_SECRET, deriva do segredo de serviço do projeto (nunca exposto ao navegador)
const rootSecret = env.JWT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY
  || (isProd ? null : 'dev-only-rusten-secret-not-for-production');
if (!rootSecret) throw new Error('JWT_SECRET é obrigatório em produção');

// Chaves derivadas por finalidade (HKDF): vazamento de uma não compromete as outras
export const deriveKey = (purpose) =>
  Buffer.from(crypto.hkdfSync('sha256', rootSecret, 'rusten', purpose, 32));
const accessKey = deriveKey('access-token');

export const ACCESS_TTL_S = 12 * 3600;
export const REFRESH_TTL_DAYS = 30;

export function signAccess(user, sessionId) {
  return jwt.sign({ sub: String(user.id), cid: String(user.company_id), sid: sessionId }, accessKey, {
    expiresIn: ACCESS_TTL_S, algorithm: 'HS256',
  });
}

export async function loadContext(userId, companyId) {
  const { rows } = await q(
    `select u.id, u.company_id, u.unit_id, u.name, u.email, u.role_key, u.active, u.password_changed_at,
            r.name as role_name, r.level, r.permissions,
            c.name as company_name, c.segment, c.timezone, c.settings, c.access, c.access_updated_at
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
       join companies c on c.id = u.company_id
      where u.id = $1 and u.company_id = $2`,
    [userId, companyId],
  );
  return rows[0];
}

// Middleware principal: identidade, empresa (nunca vinda do cliente) e terminal
export function auth() {
  return async (req, _res, next) => {
    try {
      const hdr = req.headers.authorization || '';
      const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
      if (!token) throw new HttpError(401, 'Sessão expirada. Entre novamente.', 'unauthenticated');
      let payload;
      try {
        payload = jwt.verify(token, accessKey, { algorithms: ['HS256'] });
      } catch {
        throw new HttpError(401, 'Sessão expirada. Entre novamente.', 'unauthenticated');
      }
      const u = await loadContext(Number(payload.sub), Number(payload.cid));
      if (!u || !u.active) throw new HttpError(401, 'Usuário inativo', 'unauthenticated');
      const s = await q('select revoked_at from user_sessions where id = $1 and user_id = $2', [payload.sid, u.id]);
      if (!s.rows[0] || s.rows[0].revoked_at) throw new HttpError(401, 'Sessão encerrada', 'unauthenticated');
      if (payload.iat * 1000 < new Date(u.password_changed_at).getTime() - 1000)
        throw new HttpError(401, 'Senha alterada. Entre novamente.', 'unauthenticated');

      const ctx = {
        userId: u.id, companyId: u.company_id, unitId: u.unit_id, name: u.name, email: u.email,
        role: u.role_key, roleName: u.role_name, level: u.level, perms: new Set(u.permissions),
        company: { id: u.company_id, name: u.company_name, segment: u.segment, timezone: u.timezone, settings: u.settings },
        access: computeAccess(u.access, u.access_updated_at), sessionId: payload.sid, terminalId: null,
      };
      const tid = Number(req.headers['x-terminal-id']);
      if (tid) {
        const t = await q('select id, unit_id from terminals where id = $1 and company_id = $2 and active', [tid, ctx.companyId]);
        if (t.rows[0]) { ctx.terminalId = t.rows[0].id; ctx.terminalUnitId = t.rows[0].unit_id; }
      }
      ctx.can = (p) => ctx.perms.has(p);
      req.ctx = ctx;
      next();
    } catch (e) { next(e); }
  };
}

export const need = (...perms) => (req, _res, next) => {
  const missing = perms.find((p) => !req.ctx.can(p));
  if (missing) return next(forbidden(`Sem permissão: ${missing}`));
  next();
};

export function assertCan(ctx, perm) {
  if (!ctx.can(perm)) throw forbidden(`Sem permissão: ${perm}`);
}

export async function audit(db, ctx, action, { entity, entityId, reason, data, unitId } = {}) {
  await db.query(
    `insert into audit_events (company_id, unit_id, terminal_id, user_id, action, entity, entity_id, reason, data)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ctx.companyId, unitId ?? ctx.terminalUnitId ?? ctx.unitId ?? null, ctx.terminalId ?? null, ctx.userId ?? null,
      action, entity ?? null, entityId != null ? String(entityId) : null, reason ?? null, scrub(data ?? {})],
  );
}

const SECRET_KEYS = /pass|senha|token|secret|segredo|hash|card_number|cvv/i;
export function scrub(obj) {
  if (Array.isArray(obj)) return obj.map(scrub);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[omitido]' : scrub(v)]));
  }
  return obj;
}

/* Política de acesso (seção 19.7). Os campos vêm da central; aplicamos a precedência também aqui:
   1 bloqueio administrativo  2 liberação manual  3 período pago  4 teste  5 carência  6 bloqueio. */
export function computeAccess(access, updatedAt, now = new Date()) {
  const a = access || {};
  const allModules = Object.keys(MODULES);
  if (!Object.keys(a).length) {
    return { allowed: true, state: 'sem_central', modules: allModules, warning: null, managed: false };
  }
  const modules = Array.isArray(a.modules) && a.modules.length ? a.modules : allModules;
  const base = { modules, plan: a.plan ?? null, managed: true, updatedAt, support: a.support ?? null };
  const after = (d) => d === 'indefinido' || (d && new Date(d) > now);
  if (a.admin_block?.active || a.blocked === true) {
    return { ...base, allowed: false, state: 'bloqueio_administrativo', reason: a.admin_block?.reason || a.block_reason || 'Acesso bloqueado pela administração' };
  }
  if (after(a.manual_release_until)) return { ...base, allowed: true, state: 'liberacao_manual', warning: a.warning ?? null };
  if (after(a.paid_until)) return { ...base, allowed: true, state: 'ativa', warning: a.warning ?? null };
  if (a.trial_ends_at === 'ilimitado' || after(a.trial_ends_at)) return { ...base, allowed: true, state: 'teste', trialEndsAt: a.trial_ends_at, warning: a.warning ?? null };
  if (a.grace_until && after(a.grace_until)) {
    return { ...base, allowed: true, state: 'carencia', graceUntil: a.grace_until,
      warning: a.warning || `Pagamento pendente. O acesso será bloqueado em ${new Date(a.grace_until).toLocaleDateString('pt-BR')}.` };
  }
  // Formato simples da central: situação já calculada
  if (!('paid_until' in a) && !('trial_ends_at' in a) && ['active', 'ativa', 'trial', 'teste', 'grace', 'carencia'].includes(a.status)) {
    return { ...base, allowed: true, state: a.status, warning: a.warning ?? null };
  }
  return { ...base, allowed: false, state: 'vencida', reason: a.block_reason || 'Assinatura vencida. Regularize para continuar operando.' };
}

// Portão da assinatura: bloqueada → 402 (só rotas de regularização); módulo fora do plano → 403
export const requireAccess = (module) => (req, _res, next) => {
  const acc = req.ctx.access;
  if (!acc.allowed) return next(new HttpError(402, acc.reason, 'access_blocked', { state: acc.state }));
  if (module && !acc.modules.includes(module)) return next(forbidden('Módulo não incluído no plano', 'module_disabled'));
  next();
};

// Limite de tentativas persistido no banco (vale entre instâncias)
export async function rateLimit(key, max, windowS) {
  const { rows } = await q(
    `insert into rate_limits(key, count, reset_at) values ($1, 1, now() + make_interval(secs => $2))
     on conflict (key) do update set
       count = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2) else rate_limits.reset_at end
     returning count`,
    [key, windowS],
  );
  if (rows[0].count > max) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.', 'rate_limited');
}
