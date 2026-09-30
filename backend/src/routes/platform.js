// Rotas chamadas pela central (contrato v1) e rotas da empresa para consultar a própria assinatura.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q, h, parse, notFound, randomToken } from '../lib/core.js';
import { auth, audit, need } from '../lib/auth.js';
import { MODULES } from '../lib/catalog.js';
import { verifyPlatform, tenantSummary, applyAccess, flushOutbox, callHub, hubConfigured, PRODUCT_CODE } from '../lib/platform.js';

export const platformRouter = Router();
platformRouter.use(verifyPlatform);

platformRouter.get('/manifest', (_req, res) => {
  res.json({
    product: PRODUCT_CODE, name: 'RUSTEN', description: 'Gestão para bares e restaurantes', contract: 'v1',
    modules: Object.entries(MODULES).map(([key, name]) => ({ key, name })),
    billing_page: '/configuracoes/assinatura',
  });
});

platformRouter.get('/tenants', h(async (_req, res) => {
  const { rows } = await q('select id from companies order by id');
  const out = [];
  for (const r of rows) out.push(await tenantSummary({ query: q }, r.id));
  res.json({ tenants: out });
}));

platformRouter.get('/tenants/:id', h(async (req, res) => {
  const t = await tenantSummary({ query: q }, Number(req.params.id));
  if (!t) throw notFound('Empresa não encontrada');
  const users = await q('select id, name, email, role_key, active, created_at from users where company_id = $1 order by id', [Number(req.params.id)]);
  res.json({ ...t, users: users.rows });
}));

platformRouter.post('/tenants/:id/access', h(async (req, res) => {
  const id = Number(req.params.id);
  const ok = await applyAccess(id, req.body?.access ?? req.body);
  if (!ok) throw notFound('Empresa não encontrada');
  await audit({ query: q }, { companyId: id }, 'central.situacao_recebida', { entity: 'company', entityId: id, data: req.body?.access ?? req.body });
  res.json({ ok: true });
}));

// Senha provisória para o responsável: encerra as sessões existentes; exibida uma vez na central
platformRouter.post('/tenants/:id/owner-reset', h(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await q("select id, email from users where company_id = $1 and role_key = 'owner' and active order by id limit 1", [id]);
  if (!rows[0]) throw notFound('Responsável não encontrado');
  const temp = `Rst${randomToken(9)}9`;
  await q('update users set password_hash = $2, password_changed_at = now(), failed_attempts = 0, locked_until = null where id = $1',
    [rows[0].id, await bcrypt.hash(temp, 12)]);
  await q('update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [rows[0].id]);
  await audit({ query: q }, { companyId: id }, 'central.senha_provisoria', { entity: 'user', entityId: rows[0].id });
  res.json({ email: rows[0].email, temporary_password: temp });
}));

// Rotina periódica (Render Cron / Vercel Cron) para reenviar eventos à central
export const cronRouter = Router();
cronRouter.get('/platform', h(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'não autorizado' });
  res.json(await flushOutbox(50));
}));

// Para a empresa: situação da assinatura e verificação ("Já paguei, verificar") — funciona mesmo bloqueada
export const accessRouter = Router();
accessRouter.use(auth());
accessRouter.get('/', (req, res) => res.json({ access: req.ctx.access, hub: hubConfigured() }));
accessRouter.post('/verify', need('assinatura.gerenciar'), h(async (req, res) => {
  if (!hubConfigured()) return res.json({ access: req.ctx.access, hub: false });
  const data = await callHub('GET', `/api/hub/v1/tenants/${PRODUCT_CODE}:${req.ctx.companyId}/access`);
  if (data?.access) await applyAccess(req.ctx.companyId, data.access);
  await audit({ query: q }, req.ctx, 'assinatura.verificacao');
  res.json({ ok: true, refreshed: !!data?.access });
}));
accessRouter.post('/billing/:action', need('assinatura.gerenciar'), h(async (req, res) => {
  const action = parse(z.enum(['checkout', 'renew', 'change-plan', 'cancel']), req.params.action);
  const data = await callHub('POST', `/api/hub/v1/tenants/${PRODUCT_CODE}:${req.ctx.companyId}/billing/${action}`, req.body || {});
  await audit({ query: q }, req.ctx, `assinatura.${action}`);
  res.json(data);
}));
accessRouter.get('/billing', need('assinatura.gerenciar'), h(async (req, res) => {
  if (!hubConfigured()) return res.json({ hub: false });
  res.json(await callHub('GET', `/api/hub/v1/tenants/${PRODUCT_CODE}:${req.ctx.companyId}/billing`));
}));
