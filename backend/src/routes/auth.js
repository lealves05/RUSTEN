// Cadastro da empresa, login, renovação de sessão, saída e troca de senha.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, tx, h, parse, bad, HttpError, sha256, randomToken, businessDate } from '../lib/core.js';
import { signAccess, auth, rateLimit, audit, REFRESH_TTL_DAYS, loadContext, computeAccess } from '../lib/auth.js';
import { DEFAULT_ROLES, PERMISSIONS, MODULES } from '../lib/catalog.js';
import { pdvSettings } from '../lib/pdv.js';
import { seedCompany, seedDemoActivity } from '../lib/seed.js';
import { enqueueHub, platformConfig, hubCall, registerCompany, flushOutbox } from '../lib/platform.js';
import { getSystemParams } from '../lib/params.js';
import { env } from '../lib/env.js';

export const router = Router();

const COMMON = ['12345678', 'senha123', 'password', 'qwerty', '123456789', 'rusten123', 'abc12345'];
export function checkPassword(p) {
  if (p.length < 10) throw bad('A senha precisa ter pelo menos 10 caracteres');
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) throw bad('A senha precisa ter letras e números');
  if (COMMON.some((c) => p.toLowerCase().includes(c))) throw bad('Senha muito comum');
}

const SEGMENTS = ['bar', 'restaurante', 'lanchonete', 'cafeteria', 'pub', 'food_truck', 'hamburgueria', 'pizzaria', 'padaria', 'outro'];

const registerSchema = z.object({
  company: z.object({
    name: z.string().trim().min(2).max(120),
    segment: z.enum(SEGMENTS).default('restaurante'),
    document: z.string().trim().max(20).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email().max(160).optional(),
    address: z.object({ street: z.string().max(160).optional(), city: z.string().max(80).optional(), state: z.string().max(2).optional(), zip: z.string().max(10).optional() }).partial().optional(),
  }),
  owner: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(160),
    password: z.string().min(1).max(200),
  }),
  accept_terms: z.literal(true, { message: 'É preciso aceitar os termos' }),
  plan: z.object({ code: z.string().max(60).optional(), cycle: z.enum(['mensal', 'anual']).optional(), trial: z.boolean().optional() }).optional(),
  setup: z.object({
    unit_name: z.string().trim().max(80).optional(),
    tables: z.number().int().min(0).max(300).default(10),
    cards: z.number().int().min(0).max(2000).default(50),
    mode: z.enum(['manual', 'continua', 'dupla']).default('manual'),
    demo: z.boolean().default(false),
    day_cutoff: z.number().int().min(0).max(12).default(5),
  }).default({}),
});

router.post('/register', h(async (req, res) => {
  const sys = await getSystemParams();
  if (env.ALLOW_SIGNUP === 'false' || sys.signup_enabled === false) throw new HttpError(403, 'Novos cadastros estão temporariamente fechados', 'signup_closed');
  await rateLimit(`register:${req.ip}`, 10, 3600);
  const b = parse(registerSchema, req.body);
  checkPassword(b.owner.password);
  const exists = await q('select 1 from users where lower(email) = $1', [b.owner.email]);
  if (exists.rows[0]) throw new HttpError(409, 'Este e-mail já está cadastrado. Use "Entrar" ou recupere a senha.', 'email_taken');
  const hash = await bcrypt.hash(b.owner.password, 12);

  const out = await tx(async (db) => {
    const c = await db.query(
      `insert into companies (name, segment, document, phone, email, address, settings)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [b.company.name, b.company.segment, b.company.document ?? null, b.company.phone ?? null, b.company.email ?? b.owner.email,
        b.company.address ?? {}, { pdv: { mode: b.setup.mode, service_fee_bp: Math.round(Number(sys.default_service_fee ?? 10) * 100) }, plan_request: b.plan ?? null }],
    );
    const companyId = c.rows[0].id;
    for (const r of DEFAULT_ROLES) {
      await db.query('insert into roles (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)',
        [companyId, r.key, r.name, r.level, r.permissions]);
    }
    const u = await db.query(
      `insert into users (company_id, name, email, password_hash, role_key) values ($1,$2,$3,$4,'owner') returning id`,
      [companyId, b.owner.name, b.owner.email, hash]);
    const ctx = { companyId, userId: u.rows[0].id };
    await seedCompany(db, companyId, b.setup);
    await audit(db, ctx, 'empresa.cadastrada', { entity: 'company', entityId: companyId, data: { segment: b.company.segment, plan: b.plan ?? null } });
    await enqueueHub(db, companyId, 'tenant.created');
    return { companyId, userId: u.rows[0].id };
  });
  // cadastro na central sem atrasar o cliente além de 4 s; se falhar, a outbox reenvia depois
  try { if (await registerCompany(out.companyId, 4000)) await q("update platform_outbox set sent_at = now() where company_id = $1 and sent_at is null", [out.companyId]); }
  catch { /* fica na outbox */ }
  const tokens = await startSession({ id: out.userId, company_id: out.companyId }, req);
  res.status(201).json(tokens);
}));

async function startSession(user, req) {
  const sid = crypto.randomUUID();
  const refresh = randomToken(48);
  await q(`insert into user_sessions (id, user_id, refresh_hash, expires_at, ip)
           values ($1,$2,$3, now() + make_interval(days => $4), $5)`,
  [sid, user.id, sha256(refresh), REFRESH_TTL_DAYS, req.ip]);
  return { access_token: signAccess(user, sid), refresh_token: `${sid}.${refresh}` };
}

// Hash fictício para tempo constante no login (calculado na primeira vez, não na inicialização)
let DUMMY_HASH;
const dummyHash = () => (DUMMY_HASH ||= bcrypt.hashSync('dummy-password-for-timing', 12));

// Dados públicos do cadastro: planos da central, regra de teste e padrões da instalação
router.get('/plans', h(async (_req, res) => {
  const sys = await getSystemParams();
  const base = { signup_open: env.ALLOW_SIGNUP !== 'false' && sys.signup_enabled !== false, demo_enabled: sys.demo_enabled !== false,
    defaults: { mode: sys.default_mode, tables: sys.default_tables, cards: sys.default_cards, day_cutoff: sys.default_day_cutoff } };
  if (!(await platformConfig())) return res.json({ ...base, hub: false, plans: [] });
  try {
    const data = await hubCall('GET', '/plans', undefined, 5000);
    res.json({ ...base, hub: true, plans: data.plans || [], trial_default: data.trial_default || null,
      signup_open: base.signup_open && data.signup_enabled !== false });
  } catch {
    res.json({ ...base, hub: true, plans: [], unavailable: true });
  }
}));

// ---------- Demonstração: empresa de exemplo, sem central e apagada depois de alguns dias ----------
router.post('/demo', h(async (req, res) => {
  const sys = await getSystemParams();
  if (sys.demo_enabled === false) throw new HttpError(403, 'A demonstração está desativada no momento.', 'demo_disabled');
  await rateLimit(`demo:${req.ip}`, 10, 3600);
  // demonstrações abandonadas são apagadas
  const old = await q("select id from companies where is_demo and created_at < now() - make_interval(days => $1) limit 20", [Number(sys.demo_days) || 7]);
  for (const r of old.rows) await tx((db) => db.query('select purge_demo_company($1)', [r.id])).catch(() => {});
  const rand = randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, 'x');
  const out = await tx(async (db) => {
    const c = await db.query(
      `insert into companies (name, segment, email, settings, is_demo) values ('Bar Demonstração', 'bar', null, $1, true) returning id, timezone`,
      [{ pdv: { mode: 'manual', service_fee_bp: 1000 } }]);
    const companyId = c.rows[0].id;
    for (const r of DEFAULT_ROLES) {
      await db.query('insert into roles (company_id, key, name, level, permissions, system) values ($1,$2,$3,$4,$5,true)',
        [companyId, r.key, r.name, r.level, r.permissions]);
    }
    const u = await db.query(
      `insert into users (company_id, name, email, password_hash, role_key) values ($1,'Visitante',$2,$3,'owner') returning id`,
      [companyId, `demo-${rand}@demo.rusten.app`, await bcrypt.hash(randomToken(24), 8)]);
    const { unitId } = await seedCompany(db, companyId, { unit_name: 'Matriz', tables: 12, cards: 30, demo: true, day_cutoff: 5 });
    await seedDemoActivity(db, companyId, unitId, u.rows[0].id, businessDate(new Date(), c.rows[0].timezone, 5));
    await audit(db, { companyId, userId: u.rows[0].id }, 'demonstracao.criada', { entity: 'company', entityId: companyId });
    return { companyId, userId: u.rows[0].id };
  });
  res.status(201).json(await startSession({ id: out.userId, company_id: out.companyId }, req));
}));

/** Converte a demonstração em uso normal: empresa, responsável, e-mail e senha (mantendo ou apagando o movimento de exemplo). */
router.post('/activate', auth(), h(async (req, res) => {
  const b = parse(z.object({
    company_name: z.string().trim().min(2).max(120),
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(160),
    password: z.string().min(1).max(200),
    phone: z.string().trim().max(30).optional(),
    keep_data: z.boolean().default(false),
    accept_terms: z.literal(true, { message: 'É preciso aceitar os termos' }),
  }), req.body);
  if (req.ctx.role !== 'owner') throw new HttpError(403, 'Só o proprietário pode ativar o sistema.', 'forbidden');
  if (!req.ctx.company.is_demo) throw bad('Esta empresa já está em uso normal.');
  const sys = await getSystemParams();
  if (env.ALLOW_SIGNUP === 'false' || sys.signup_enabled === false) throw new HttpError(403, 'Novos cadastros estão temporariamente fechados', 'signup_closed');
  checkPassword(b.password);
  const taken = await q('select 1 from users where lower(email) = $1 and id <> $2', [b.email, req.ctx.userId]);
  if (taken.rows[0]) throw new HttpError(409, 'Este e-mail já está cadastrado. Use "Entrar" ou recupere a senha.', 'email_taken');
  const cid = req.ctx.companyId;
  await tx(async (db) => {
    if (!b.keep_data) {
      // apaga o movimento e o cardápio de exemplo; mantém unidade, terminal, mesas e cartões
      await db.query('delete from payments where company_id = $1', [cid]);
      await db.query('delete from cash_movements where company_id = $1', [cid]);
      await db.query('delete from cash_sessions where company_id = $1', [cid]);
      await db.query('delete from order_items where company_id = $1', [cid]);
      await db.query('delete from consumption_sessions where company_id = $1', [cid]);
      await db.query("update dining_tables set status = 'livre' where company_id = $1", [cid]);
      await db.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo)", [cid]);
      await db.query('delete from modifier_groups where company_id = $1 and product_id in (select id from products where company_id = $1 and demo)', [cid]);
      await db.query('delete from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo)', [cid]);
      await db.query('delete from products where company_id = $1 and demo', [cid]);
      await db.query('delete from categories where company_id = $1 and demo', [cid]);
    }
    await db.query('update companies set name = $2, phone = coalesce($3, phone), email = $4, is_demo = false, created_at = now() where id = $1',
      [cid, b.company_name, b.phone ?? null, b.email]);
    await db.query('update users set name = $2, email = $3, password_hash = $4, password_changed_at = now() where id = $1',
      [req.ctx.userId, b.name, b.email, await bcrypt.hash(b.password, 12)]);
    await db.query('update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [req.ctx.userId]);
    await audit(db, req.ctx, 'demonstracao.ativada', { entity: 'company', entityId: cid, data: { keep_data: b.keep_data } });
    await enqueueHub(db, cid, 'tenant.created');
  });
  try { await flushOutbox(5); } catch { /* reenviada depois */ }
  // a troca de senha encerrou a sessão da demonstração: abre uma nova já como conta real
  res.json(await startSession({ id: req.ctx.userId, company_id: cid }, req));
}));

router.post('/login', h(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().max(160), password: z.string().max(200) }), req.body);
  await rateLimit(`login:${req.ip}`, 30, 900);
  await rateLimit(`login-user:${b.email}`, 15, 900);
  const { rows } = await q('select * from users where lower(email) = $1', [b.email]);
  const u = rows[0];
  const ok = await bcrypt.compare(b.password, u?.password_hash || dummyHash()); // tempo constante
  const fail = new HttpError(401, 'E-mail ou senha incorretos', 'bad_credentials');
  if (!u || !u.active) throw fail;
  if (u.locked_until && new Date(u.locked_until) > new Date())
    throw new HttpError(423, 'Conta bloqueada temporariamente por tentativas inválidas. Tente em 15 minutos.', 'locked');
  if (!ok) {
    await q(`update users set failed_attempts = failed_attempts + 1,
               locked_until = case when failed_attempts + 1 >= 8 then now() + interval '15 minutes' else locked_until end
             where id = $1`, [u.id]);
    await audit({ query: q }, { companyId: u.company_id, userId: u.id }, 'login.falhou', { entity: 'user', entityId: u.id });
    throw fail;
  }
  await q('update users set failed_attempts = 0, locked_until = null where id = $1', [u.id]);
  await q('update companies set last_access_at = now() where id = $1', [u.company_id]);
  await audit({ query: q }, { companyId: u.company_id, userId: u.id }, 'login', { entity: 'user', entityId: u.id });
  res.json(await startSession(u, req));
}));

router.post('/refresh', h(async (req, res) => {
  const raw = String(req.body?.refresh_token || '');
  const [sid, secret] = raw.split('.');
  if (!sid || !secret || !/^[0-9a-f-]{36}$/.test(sid)) throw new HttpError(401, 'Sessão inválida', 'unauthenticated');
  const out = await tx(async (db) => {
    const { rows } = await db.query(
      `select s.*, u.company_id, u.active from user_sessions s join users u on u.id = s.user_id where s.id = $1 for update of s`, [sid]);
    const s = rows[0];
    if (!s || s.revoked_at || new Date(s.expires_at) < new Date() || !s.active) throw new HttpError(401, 'Sessão expirada', 'unauthenticated');
    if (s.refresh_hash !== sha256(secret)) {
      // reuso de token antigo: possível roubo → encerra todas as sessões do usuário
      await db.query('update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [s.user_id]);
      await audit(db, { companyId: s.company_id, userId: s.user_id }, 'sessao.reuso_detectado', { entity: 'user', entityId: s.user_id });
      return null;
    }
    const next = randomToken(48);
    await db.query('update user_sessions set refresh_hash = $2, rotated_at = now() where id = $1', [sid, sha256(next)]);
    return { access_token: signAccess({ id: s.user_id, company_id: s.company_id }, sid), refresh_token: `${sid}.${next}` };
  });
  if (!out) throw new HttpError(401, 'Sessão encerrada por segurança. Entre novamente.', 'unauthenticated');
  res.json(out);
}));

router.post('/logout', auth(), h(async (req, res) => {
  const all = req.body?.all === true;
  if (all) await q('update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [req.ctx.userId]);
  else await q('update user_sessions set revoked_at = now() where id = $1', [req.ctx.sessionId]);
  res.json({ ok: true });
}));

router.post('/password', auth(), h(async (req, res) => {
  const b = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), req.body);
  checkPassword(b.next);
  const { rows } = await q('select password_hash from users where id = $1', [req.ctx.userId]);
  if (!(await bcrypt.compare(b.current, rows[0].password_hash))) throw bad('Senha atual incorreta');
  await q('update users set password_hash = $2, password_changed_at = now() where id = $1', [req.ctx.userId, await bcrypt.hash(b.next, 12)]);
  await q('update user_sessions set revoked_at = now() where user_id = $1 and id <> $2 and revoked_at is null', [req.ctx.userId, req.ctx.sessionId]);
  await audit({ query: q }, req.ctx, 'senha.alterada', { entity: 'user', entityId: req.ctx.userId });
  res.json({ ok: true });
}));

// Dados da sessão: usuário, empresa, permissões, módulos, situação da assinatura e PDV efetivo
router.get('/me', auth(), h(async (req, res) => {
  const c = req.ctx;
  const units = await q('select id, name, day_cutoff from units where company_id = $1 and active order by id', [c.companyId]);
  const unitId = c.terminalUnitId || c.unitId || units.rows[0]?.id;
  res.json({
    user: { id: c.userId, name: c.name, email: c.email, role: c.role, roleName: c.roleName, level: c.level, unitId: c.unitId },
    company: c.company,
    permissions: [...c.perms],
    access: c.access,
    units: units.rows,
    unitId,
    terminalId: c.terminalId,
    pdv: await pdvSettings({ query: q }, c, unitId),
    catalog: { permissions: PERMISSIONS, modules: MODULES },
    notice: await systemNotice(),
  });
}));

async function systemNotice() {
  const sys = await getSystemParams();
  return sys.notice_text ? { text: sys.notice_text, level: sys.notice_level === 'warn' ? 'warn' : 'info' } : null;
}

export { loadContext, computeAccess };
