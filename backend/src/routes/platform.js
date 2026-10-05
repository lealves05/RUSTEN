// Central da plataforma (MASTER do ORBI) — contrato v1 (+ parâmetros v1.1) — e portal da assinatura da empresa.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, tx, h, parse, notFound, HttpError } from '../lib/core.js';
import { auth, audit, need } from '../lib/auth.js';
import {
  verifyHubRequest, tenantPayload, storeAccess, hubCall, refreshAccess, flushOutbox, platformConfig,
  FEATURES, PRODUCT_CODE, RUSTEN_VERSION, CONTRACT_VERSION,
} from '../lib/platform.js';
import { settingsManifest, getSystemParams, setSystemParams, getTenantParams, setTenantParams } from '../lib/params.js';
import { env } from '../lib/env.js';
import { normalizePlans } from '../lib/plans.js';

// =====================================================================
// Central → RUSTEN (/api/platform/v1): chamadas assinadas
// =====================================================================
export const platformRouter = Router();
platformRouter.use(verifyHubRequest);
platformRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

const central = { companyId: null, userId: null };
async function company(id) {
  if (!/^\d{1,18}$/.test(String(id))) throw notFound('Empresa não encontrada.');
  const { rows } = await q('select id, is_demo from companies where id = $1', [id]);
  if (!rows[0] || rows[0].is_demo) throw notFound('Empresa não encontrada.');
  return rows[0];
}

platformRouter.get('/manifest', (_req, res) => res.json({
  code: PRODUCT_CODE, name: 'RUSTEN', contract: CONTRACT_VERSION, contract_minor: 1, version: RUSTEN_VERSION,
  description: 'Gestão e PDV para bares e restaurantes: comandas, mesas, dupla leitura e caixa.',
  features: FEATURES,
  settings: settingsManifest(),
}));

platformRouter.get('/tenants', h(async (_req, res) => {
  const { rows } = await q('select id from companies where not is_demo order by id limit 5000');
  const items = [];
  for (const r of rows) {
    const t = await tenantPayload(r.id);
    if (t) { const { is_demo: _d, owner_email: _o, ...x } = t; items.push(x); }
  }
  res.json({ items });
}));

const ROLE_LABEL = (key, name) => name || key;
platformRouter.get('/tenants/:id', h(async (req, res) => {
  const c = await company(req.params.id);
  const { is_demo: _d, ...t } = await tenantPayload(c.id);
  const { rows: users } = await q(
    `select u.name, u.email, u.role_key as role, r.name as role_name, u.active,
            (select max(s.created_at) from user_sessions s where s.user_id = u.id) as last_login_at
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by u.role_key = 'owner' desc, u.name limit 200`, [c.id]);
  const { rows: units } = await q('select name, active from units where company_id = $1 order by id', [c.id]);
  res.json({ tenant: { ...t, users: { n: users.length, active: users.filter((u) => u.active).length,
    list: users.map(({ role_name: rn, ...u }) => ({ ...u, role_label: ROLE_LABEL(u.role, rn) })) }, units } });
}));

platformRouter.post('/tenants/:id/access', h(async (req, res) => {
  const c = await company(req.params.id);
  const d = parse(z.object({ access: z.object({ status: z.string(), blocked: z.boolean() }).passthrough() }), req.body);
  await storeAccess(c.id, d.access);
  await audit({ query: q }, { ...central, companyId: c.id }, 'central.situacao_recebida', { entity: 'company', entityId: c.id,
    data: { status: d.access.status, blocked: d.access.blocked } });
  res.json({ ok: true });
}));

/** A central pede uma nova senha para o responsável: senha provisória, exibida uma única vez ao administrador da central. */
platformRouter.post('/tenants/:id/owner-reset', h(async (req, res) => {
  const c = await company(req.params.id);
  const d = parse(z.object({ email: z.string().trim().toLowerCase().email().max(160).nullable().optional() }), req.body || {});
  const { rows } = await q("select id, email from users where company_id = $1 and role_key = 'owner' order by id limit 1", [c.id]);
  const owner = rows[0];
  if (!owner) throw new HttpError(404, 'Esta empresa não tem usuário responsável.', 'not_found');
  let email = owner.email;
  if (d.email && d.email !== owner.email.toLowerCase()) {
    const taken = await q('select 1 from users where lower(email) = $1 and id <> $2', [d.email, owner.id]);
    if (taken.rows[0]) throw new HttpError(409, 'Este e-mail já é usado por outro acesso.', 'email_taken');
    await q('update users set email = $1 where id = $2', [d.email, owner.id]);
    email = d.email;
  }
  const temp = `Rs-${crypto.randomBytes(6).toString('base64url')}-${crypto.randomInt(10, 99)}`;
  await q(`update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null, active = true
            where id = $1`, [owner.id, await bcrypt.hash(temp, 12)]);
  await q('update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [owner.id]);
  await audit({ query: q }, { ...central, companyId: c.id }, 'central.senha_provisoria', { entity: 'user', entityId: owner.id, data: { email } });
  res.json({ ok: true, user_id: String(owner.id), email, temporary_password: temp,
    message: 'Senha provisória criada. Oriente o responsável a trocá-la em Configurações › Meu acesso logo no primeiro acesso.' });
}));

// ---- Parâmetros (contrato v1.1): sistema e empresa ----
platformRouter.get('/settings', h(async (_req, res) => res.json({ values: await getSystemParams() })));
platformRouter.put('/settings', h(async (req, res) => {
  const values = await setSystemParams(req.body?.values);
  res.json({ values });
}));
platformRouter.get('/tenants/:id/settings', h(async (req, res) => {
  const c = await company(req.params.id);
  res.json({ values: await getTenantParams(c.id) });
}));
platformRouter.put('/tenants/:id/settings', h(async (req, res) => {
  const c = await company(req.params.id);
  const changed = await tx(async (db) => {
    const ch = await setTenantParams(db, c.id, req.body?.values);
    await audit(db, { ...central, companyId: c.id }, 'central.parametros_alterados', { entity: 'company', entityId: c.id,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 300) : null, data: ch });
    return ch;
  });
  res.json({ ok: true, changed, values: await getTenantParams(c.id) });
}));

// Rotina periódica (cron externo) para reenviar cadastros pendentes à central
export const cronRouter = Router();
cronRouter.get('/platform', h(async (req, res) => {
  const secret = env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'não autorizado' });
  res.json(await flushOutbox(50));
}));

// =====================================================================
// Portal da assinatura (/api/access) — repassa à central as ações do proprietário/administrador
// Funciona mesmo com a empresa bloqueada (regularização).
// =====================================================================
export const accessRouter = Router();
accessRouter.use(auth());
const rid = (req) => encodeURIComponent(req.ctx.companyId);
const actor = (req) => ({ user_email: req.ctx.email, user_name: req.ctx.name });
const demoGuard = (req, _res, next) => {
  if (req.ctx.company.is_demo) return next(new HttpError(400, 'Na demonstração não há assinatura. Ative sua conta para contratar.', 'demo'));
  next();
};

accessRouter.get('/', h(async (req, res) => res.json({ access: req.ctx.access, hub: !!(await platformConfig()) })));

accessRouter.get('/billing', h(async (req, res) => {
  if (req.ctx.company.is_demo || !(await platformConfig())) return res.json({ access: req.ctx.access, hub: false, demo: !!req.ctx.company.is_demo });
  if (!req.ctx.can('assinatura.gerenciar')) return res.json({ access: req.ctx.access, restricted: true, hub: true });
  const out = await hubCall('GET', `/tenants/${rid(req)}/billing`);
  if (out.access) await storeAccess(req.ctx.companyId, out.access);
  res.json({ ...out, plans: normalizePlans(out.plans), hub: true });
}));

accessRouter.post('/billing/checkout', need('assinatura.gerenciar'), demoGuard, h(async (req, res) => {
  const d = parse(z.object({ plan_id: z.string().uuid(), cycle: z.enum(['MONTHLY', 'ANNUAL']) }), req.body);
  const out = await hubCall('POST', `/tenants/${rid(req)}/billing/checkout`, { ...d, ...actor(req) });
  await audit({ query: q }, req.ctx, 'assinatura.contratacao', { data: { plan_id: d.plan_id, cycle: d.cycle } });
  res.status(201).json(out);
}));
accessRouter.post('/billing/renew', need('assinatura.gerenciar'), demoGuard, h(async (req, res) => {
  const out = await hubCall('POST', `/tenants/${rid(req)}/billing/renew`, actor(req));
  await audit({ query: q }, req.ctx, 'assinatura.renovacao');
  res.status(201).json(out);
}));
accessRouter.post('/billing/change-plan', need('assinatura.gerenciar'), demoGuard, h(async (req, res) => {
  const d = parse(z.object({ plan_id: z.string().uuid() }), req.body);
  const out = await hubCall('POST', `/tenants/${rid(req)}/billing/change-plan`, { ...d, ...actor(req) });
  await refreshAccess({ id: req.ctx.companyId }, { fresh: true });
  await audit({ query: q }, req.ctx, 'assinatura.troca_plano', { data: d });
  res.json(out);
}));
accessRouter.post('/billing/cancel', need('assinatura.gerenciar'), demoGuard, h(async (req, res) => {
  parse(z.object({ confirm: z.literal(true, { message: 'confirme o cancelamento' }) }), req.body);
  if (req.ctx.role !== 'owner') throw new HttpError(403, 'Só o proprietário pode cancelar a assinatura.', 'forbidden');
  const out = await hubCall('POST', `/tenants/${rid(req)}/billing/cancel`, { confirm: true, ...actor(req) });
  await refreshAccess({ id: req.ctx.companyId }, { fresh: true });
  await audit({ query: q }, req.ctx, 'assinatura.cancelamento');
  res.json(out);
}));
/** "Já paguei, verificar" e retorno da página de pagamento: consulta a situação atualizada. */
accessRouter.post('/verify', h(async (req, res) => {
  const access = await refreshAccess({ id: req.ctx.companyId, is_demo: req.ctx.company.is_demo }, { fresh: true });
  await audit({ query: q }, req.ctx, 'assinatura.verificacao');
  res.json({ ok: true, refreshed: !!access });
}));
