// Autenticação, contexto da requisição, permissões, auditoria e política de acesso da assinatura.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import jwt from 'jsonwebtoken';
import { q, HttpError, forbidden } from './core.js';
import { MODULES, MODULE_ROUTES } from './catalog.js';
import { compileModuleRules, moduleForRoute } from './moduleRules.js';
import { env } from './env.js';
import { refreshAccess } from './platform.js';

const isProd = env.NODE_ENV === 'production';
// Em Supabase Edge sem JWT_SECRET, deriva do segredo de serviço do projeto (nunca exposto ao navegador)
const rootSecret = env.JWT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY
  || (isProd ? null : 'dev-only-rusten-secret-not-for-production');
if (!rootSecret) throw new Error('JWT_SECRET é obrigatório em produção');
// F01/F03: em produção, chave curta, de exemplo ou repetitiva impede o início (o valor nunca vai para o log)
export function secretProblem(s) {
  if (!s) return 'ausente';
  if (['changeme', 'secret', 'jwt_secret', 'dev-only-rusten-secret-not-for-production'].includes(s)) return 'valor de exemplo';
  if (Buffer.byteLength(s, 'utf8') < 32) return 'curta (mínimo de 32 bytes aleatórios)';
  if (new Set(s).size < 10) return 'pouca variação de caracteres';
  return null;
}
if (isProd && secretProblem(rootSecret)) throw new Error(`JWT_SECRET inseguro (${secretProblem(rootSecret)}) — o servidor não inicia em produção.`);

// Chaves derivadas por finalidade (HKDF): vazamento de uma não compromete as outras
export const deriveKey = (purpose) =>
  Buffer.from(crypto.hkdfSync('sha256', rootSecret, 'rusten', purpose, 32));
const accessKey = deriveKey('access-token');

// F05 (mitigação): token de acesso curto; a renovação é automática e única entre abas
export const ACCESS_TTL_S = Number(env.ACCESS_TTL_S) || 15 * 60;
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
            c.name as company_name, c.segment, c.timezone, c.settings, c.access, c.access_updated_at, c.is_demo
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

      // situação da assinatura: a guardada, revalidada na central a cada 5 min (demonstração nunca consulta)
      const raw = await refreshAccess({ id: u.company_id, is_demo: u.is_demo, access: u.access, access_updated_at: u.access_updated_at });
      const ctx = {
        userId: u.id, companyId: u.company_id, unitId: u.unit_id, name: u.name, email: u.email,
        role: u.role_key, roleName: u.role_name, level: u.level, perms: new Set(u.permissions),
        company: { id: u.company_id, name: u.company_name, segment: u.segment, timezone: u.timezone, settings: u.settings, is_demo: u.is_demo },
        access: u.is_demo ? computeAccess(null, null, { demo: true }) : computeAccess(raw ?? u.access, u.access_updated_at),
        sessionId: payload.sid, terminalId: null,
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

/* Situação de acesso entregue pela central (resumo do ORBI: status, blocked, reason, plan, features, notices, trial...).
   A central já aplica a precedência: bloqueio administrativo > financeiro > teste > módulos do plano.
   Sem central (ou demonstração), tudo liberado. */
export const STATUS_LABEL = {
  ACTIVE: 'Ativa', TRIAL: 'Em teste', PAYMENT_PENDING: 'Aguardando pagamento', PAST_DUE: 'Pagamento pendente',
  SUSPENDED: 'Suspensa', CANCELED: 'Cancelada', EXPIRED: 'Expirada',
};
const BLOCK_TEXT = {
  ADMINISTRATIVO: 'O acesso desta empresa foi bloqueado pela administração da plataforma. Fale com o suporte.',
  TRIAL_EXPIRADO: 'O período de teste terminou. Contrate um plano para continuar operando — seus dados estão preservados.',
  CANCELAMENTO: 'A assinatura foi encerrada. Contrate novamente para voltar a operar — seus dados estão preservados.',
  FINANCEIRO: 'Acesso suspenso por pendência financeira. Regularize a assinatura — seus dados estão preservados.',
};
export function computeAccess(access, updatedAt, { demo = false } = {}) {
  const a = access || {};
  const allModules = Object.keys(MODULES);
  if (demo) return { allowed: true, state: 'DEMO', label: 'Demonstração', modules: allModules, warning: null, notices: [], managed: false, demo: true };
  if (!Object.keys(a).length || typeof a.blocked !== 'boolean') {
    return { allowed: true, state: 'sem_central', label: 'Sem central', modules: allModules, warning: null, notices: [], managed: false };
  }
  const f = a.features && typeof a.features === 'object' ? a.features : {};
  const known = allModules.filter((k) => k in f);
  const modules = known.length ? allModules.filter((k) => f[k] !== false) : allModules;
  const notices = Array.isArray(a.notices) ? a.notices.filter((n) => n && n.text).map((n) => ({ level: n.level === 'danger' ? 'danger' : 'warn', text: String(n.text) })) : [];
  const byAdmin = !!a.admin_blocked || a.reason === 'ADMINISTRATIVO';
  return {
    allowed: !a.blocked, state: a.status, label: STATUS_LABEL[a.status] || a.status, reasonCode: a.reason || null,
    reason: a.blocked ? (BLOCK_TEXT[byAdmin ? 'ADMINISTRATIVO' : a.reason] || BLOCK_TEXT.FINANCEIRO) : null,
    adminBlocked: byAdmin, modules, notices, warning: notices[0]?.text || null,
    plan: a.plan?.name || null, planId: a.plan?.id || null, cycle: a.cycle || null, validUntil: a.valid_until || null, trial: a.trial || null,
    support: a.support || null, supportChannel: a.support_channel || null, managed: true, updatedAt,
  };
}

// Portão da assinatura: bloqueada → 402 (só rotas de regularização); módulo fora do plano → 403
const SUB_RULES = compileModuleRules(Object.fromEntries(Object.entries(MODULE_ROUTES).map(([k, routes]) => [k, { routes }])));
export const requireAccess = (module) => (req, _res, next) => {
  const acc = req.ctx.access;
  if (!acc.allowed) return next(new HttpError(402, acc.reason, 'access_blocked', { state: acc.state }));
  if (module && !acc.modules.includes(module)) return next(forbidden('Módulo não incluído no plano', 'module_disabled'));
  // recurso de outro módulo dentro deste prefixo (ex.: importação por planilha dentro do cardápio)
  if (!module) {
    const sub = moduleForRoute(SUB_RULES, req.method, `${req.baseUrl || ''}${req.path || ''}`.replace(/^.*?\/api(?=\/)/, '') /* sem o prefixo da Edge Function e do /api */);
    if (sub && !acc.modules.includes(sub)) return next(forbidden(`Módulo não incluído no plano: ${MODULES[sub]}`, 'module_disabled'));
  }
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
