// Cadastro da empresa, login, renovação de sessão, saída e troca de senha.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { q, tx, h, parse, bad, HttpError, sha256, randomToken } from '../lib/core.js';
import { signAccess, auth, rateLimit, audit, REFRESH_TTL_DAYS, loadContext, computeAccess } from '../lib/auth.js';
import { DEFAULT_ROLES, PERMISSIONS, MODULES } from '../lib/catalog.js';
import { pdvSettings } from '../lib/pdv.js';
import { seedCompany } from '../lib/seed.js';
import { enqueueHub, hubConfigured, callHub } from '../lib/platform.js';

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
  if (process.env.ALLOW_SIGNUP === 'false') throw new HttpError(403, 'Novos cadastros estão temporariamente fechados', 'signup_closed');
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
        b.company.address ?? {}, { pdv: { mode: b.setup.mode }, plan_request: b.plan ?? null }],
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

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

// Planos públicos vêm da central; sem central, o cadastro segue com acesso inicial liberado
router.get('/plans', h(async (_req, res) => {
  if (!hubConfigured()) return res.json({ hub: false, plans: [] });
  try {
    const data = await callHub('GET', `/api/hub/v1/plans?product=rusten`);
    res.json({ hub: true, plans: data.plans || [], trial: data.trial ?? null, trial_days: data.trial_days ?? null, signup_open: data.signup_open ?? true });
  } catch {
    res.json({ hub: true, plans: [], unavailable: true });
  }
}));

router.post('/login', h(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().max(160), password: z.string().max(200) }), req.body);
  await rateLimit(`login:${req.ip}`, 30, 900);
  await rateLimit(`login-user:${b.email}`, 15, 900);
  const { rows } = await q('select * from users where lower(email) = $1', [b.email]);
  const u = rows[0];
  const ok = await bcrypt.compare(b.password, u?.password_hash || DUMMY_HASH); // tempo constante
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
  });
}));

export { loadContext, computeAccess };
