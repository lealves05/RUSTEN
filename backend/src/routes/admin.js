// Administração da empresa: usuários, perfis, unidades, terminais, configurações, auditoria e autorização gerencial.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q, tx, h, parse, bad, forbidden, notFound, conflict, sha256, randomToken, csvCell } from '../lib/core.js';
import { need, audit, rateLimit } from '../lib/auth.js';
import { PERMISSIONS } from '../lib/catalog.js';
import { validatePdvLayer, pdvSettings, mergePdv } from '../lib/pdv.js';
import { checkPassword } from './auth.js';
import { enqueueHub } from '../lib/platform.js';

export const router = Router();

// ---- Usuários (hierarquia: ninguém cria/edita/concede acima do próprio nível) ----
async function roleLevel(companyId, key) {
  const r = await q('select level from roles where company_id = $1 and key = $2', [companyId, key]);
  if (!r.rows[0]) throw bad('Perfil inexistente');
  return r.rows[0].level;
}

router.get('/users', need('usuarios.gerenciar'), h(async (req, res) => {
  const { rows } = await q(
    `select u.id, u.name, u.email, u.role_key, r.name as role_name, r.level, u.unit_id, u.active, u.created_at,
            u.locked_until > now() as locked
       from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
      where u.company_id = $1 order by r.level desc, u.name`, [req.ctx.companyId]);
  res.json(rows);
}));

const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().max(200).optional(),
  role_key: z.string().max(40),
  unit_id: z.number().int().nullable().optional(),
  active: z.boolean().optional(),
});

router.post('/users', need('usuarios.gerenciar'), h(async (req, res) => {
  const b = parse(userSchema, req.body);
  if ((await roleLevel(req.ctx.companyId, b.role_key)) > req.ctx.level) throw forbidden('Não é possível criar usuário com perfil acima do seu');
  if (!b.password) throw bad('Informe a senha inicial');
  checkPassword(b.password);
  if (b.unit_id) await ownUnit(req.ctx.companyId, b.unit_id);
  const ex = await q('select 1 from users where lower(email) = $1', [b.email]);
  if (ex.rows[0]) throw conflict('E-mail já cadastrado');
  const r = await q(`insert into users (company_id, name, email, password_hash, role_key, unit_id) values ($1,$2,$3,$4,$5,$6) returning id`,
    [req.ctx.companyId, b.name, b.email, await bcrypt.hash(b.password, 12), b.role_key, b.unit_id ?? null]);
  await audit({ query: q }, req.ctx, 'usuario.criado', { entity: 'user', entityId: r.rows[0].id, data: { role: b.role_key } });
  await enqueueHub({ query: q }, req.ctx.companyId, 'tenant.updated');
  res.status(201).json({ id: r.rows[0].id });
}));

router.put('/users/:id', need('usuarios.gerenciar'), h(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(userSchema.partial(), req.body);
  const cur = await q(`select u.*, r.level from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                       where u.id = $1 and u.company_id = $2`, [id, req.ctx.companyId]);
  const u = cur.rows[0];
  if (!u) throw notFound('Usuário não encontrado');
  if (u.level > req.ctx.level || (u.level === req.ctx.level && u.id !== req.ctx.userId && req.ctx.role !== 'owner'))
    throw forbidden('Não é possível alterar usuário de nível igual ou superior');
  if (b.role_key && (await roleLevel(req.ctx.companyId, b.role_key)) > req.ctx.level) throw forbidden('Perfil acima do seu');
  if (u.role_key === 'owner' && b.role_key && b.role_key !== 'owner') {
    const owners = await q("select count(*)::int n from users where company_id = $1 and role_key = 'owner' and active", [req.ctx.companyId]);
    if (owners.rows[0].n <= 1) throw bad('A empresa precisa de ao menos um proprietário ativo');
  }
  if (b.unit_id) await ownUnit(req.ctx.companyId, b.unit_id);
  let hash = null;
  if (b.password) { checkPassword(b.password); hash = await bcrypt.hash(b.password, 12); }
  await q(`update users set name = coalesce($3, name), email = coalesce($4, email), role_key = coalesce($5, role_key),
             unit_id = case when $6::boolean then $7 else unit_id end, active = coalesce($8, active),
             password_hash = coalesce($9, password_hash),
             password_changed_at = case when $9 is not null then now() else password_changed_at end
           where id = $1 and company_id = $2`,
  [id, req.ctx.companyId, b.name ?? null, b.email ?? null, b.role_key ?? null, 'unit_id' in b, b.unit_id ?? null, b.active ?? null, hash]);
  if (b.active === false || hash) await q('update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null', [id]);
  await audit({ query: q }, req.ctx, 'usuario.alterado', { entity: 'user', entityId: id, data: { ...b, password: b.password ? 'alterada' : undefined } });
  res.json({ ok: true });
}));

// ---- Perfis ----
router.get('/roles', need('usuarios.gerenciar'), h(async (req, res) => {
  const { rows } = await q('select key, name, level, permissions, system from roles where company_id = $1 order by level desc', [req.ctx.companyId]);
  res.json({ roles: rows, catalog: PERMISSIONS });
}));

router.put('/roles/:key', need('usuarios.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), permissions: z.array(z.string()).max(200).optional(),
    level: z.number().int().min(1).max(99).optional() }), req.body);
  const r = (await q('select * from roles where company_id = $1 and key = $2', [req.ctx.companyId, req.params.key])).rows[0];
  if (!r) throw notFound('Perfil não encontrado');
  if (r.key === 'owner') throw forbidden('O perfil Proprietário não pode ser alterado');
  if (r.level >= req.ctx.level) throw forbidden('Só é possível alterar perfis abaixo do seu nível');
  if (b.level && b.level >= req.ctx.level) throw forbidden('Nível acima do seu');
  if (b.permissions) {
    const invalid = b.permissions.find((p) => !(p in PERMISSIONS));
    if (invalid) throw bad(`Permissão inválida: ${invalid}`);
    const notOwned = b.permissions.find((p) => !req.ctx.can(p));
    if (notOwned) throw forbidden(`Você não pode conceder o que não tem: ${notOwned}`);
  }
  await q('update roles set name = coalesce($3,name), permissions = coalesce($4,permissions), level = coalesce($5,level) where company_id = $1 and key = $2',
    [req.ctx.companyId, r.key, b.name ?? null, b.permissions ?? null, b.level ?? null]);
  await audit({ query: q }, req.ctx, 'perfil.alterado', { entity: 'role', entityId: r.key, data: { before: r.permissions, after: b.permissions } });
  res.json({ ok: true });
}));

router.post('/roles', need('usuarios.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60), level: z.number().int().min(1).max(99), permissions: z.array(z.string()).max(200) }), req.body);
  if (b.level >= req.ctx.level) throw forbidden('Nível acima do seu');
  const notOwned = b.permissions.find((p) => !(p in PERMISSIONS) || !req.ctx.can(p));
  if (notOwned) throw forbidden(`Permissão inválida ou não concedível: ${notOwned}`);
  const key = `custom_${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  await q('insert into roles (company_id, key, name, level, permissions) values ($1,$2,$3,$4,$5)', [req.ctx.companyId, key, b.name, b.level, b.permissions]);
  await audit({ query: q }, req.ctx, 'perfil.criado', { entity: 'role', entityId: key, data: b });
  res.status(201).json({ key });
}));

// ---- Unidades e terminais ----
async function ownUnit(companyId, unitId) {
  const r = await q('select id from units where id = $1 and company_id = $2', [unitId, companyId]);
  if (!r.rows[0]) throw bad('Unidade inválida');
}

router.get('/units', h(async (req, res) => {
  res.json((await q('select id, name, active, day_cutoff, settings from units where company_id = $1 order by id', [req.ctx.companyId])).rows);
}));
router.post('/units', need('configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80), day_cutoff: z.number().int().min(0).max(12).default(5) }), req.body);
  const r = await q('insert into units (company_id, name, day_cutoff) values ($1,$2,$3) returning id', [req.ctx.companyId, b.name, b.day_cutoff]);
  await audit({ query: q }, req.ctx, 'unidade.criada', { entity: 'unit', entityId: r.rows[0].id, data: b });
  res.status(201).json({ id: r.rows[0].id });
}));
router.put('/units/:id', need('configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(80).optional(), day_cutoff: z.number().int().min(0).max(12).optional(), active: z.boolean().optional() }), req.body);
  const r = await q('update units set name = coalesce($3,name), day_cutoff = coalesce($4,day_cutoff), active = coalesce($5,active) where id = $1 and company_id = $2 returning id',
    [Number(req.params.id), req.ctx.companyId, b.name ?? null, b.day_cutoff ?? null, b.active ?? null]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, 'unidade.alterada', { entity: 'unit', entityId: req.params.id, data: b });
  res.json({ ok: true });
}));

router.get('/terminals', h(async (req, res) => {
  res.json((await q('select id, unit_id, name, active, settings from terminals where company_id = $1 order by id', [req.ctx.companyId])).rows);
}));
router.post('/terminals', need('configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60), unit_id: z.number().int() }), req.body);
  await ownUnit(req.ctx.companyId, b.unit_id);
  const r = await q('insert into terminals (company_id, unit_id, name) values ($1,$2,$3) returning id', [req.ctx.companyId, b.unit_id, b.name]);
  await audit({ query: q }, req.ctx, 'terminal.criado', { entity: 'terminal', entityId: r.rows[0].id, data: b });
  res.status(201).json({ id: r.rows[0].id });
}));
router.put('/terminals/:id', need('configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), active: z.boolean().optional() }), req.body);
  const r = await q('update terminals set name = coalesce($3,name), active = coalesce($4,active) where id = $1 and company_id = $2 returning id',
    [Number(req.params.id), req.ctx.companyId, b.name ?? null, b.active ?? null]);
  if (!r.rows[0]) throw notFound();
  res.json({ ok: true });
}));

// ---- Configurações: empresa e PDV (empresa / unidade / terminal) ----
const companySchema = z.object({
  name: z.string().trim().min(2).max(120), segment: z.string().max(30), document: z.string().max(20).nullable(),
  phone: z.string().max(30).nullable(), email: z.string().email().max(160).nullable(), timezone: z.string().max(60),
  address: z.record(z.string(), z.string().max(160)),
  appearance: z.object({ theme: z.enum(['claro', 'escuro', 'auto']).optional(), density: z.enum(['confortavel', 'compacta']).optional(),
    menu: z.enum(['lateral', 'superior']).optional(), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }),
}).partial();

router.get('/settings', h(async (req, res) => {
  const c = (await q('select id, name, segment, document, phone, email, timezone, address, settings from companies where id = $1', [req.ctx.companyId])).rows[0];
  res.json(c);
}));
router.put('/settings', need('configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(companySchema, req.body);
  if (b.timezone) { try { new Intl.DateTimeFormat('pt-BR', { timeZone: b.timezone }); } catch { throw bad('Fuso horário inválido'); } }
  await q(`update companies set name = coalesce($2,name), segment = coalesce($3,segment), document = coalesce($4,document),
             phone = coalesce($5,phone), email = coalesce($6,email), timezone = coalesce($7,timezone), address = coalesce($8,address),
             settings = case when $9::jsonb is null then settings else jsonb_set(settings, '{appearance}', $9::jsonb) end
           where id = $1`,
  [req.ctx.companyId, b.name ?? null, b.segment ?? null, b.document ?? null, b.phone ?? null, b.email ?? null, b.timezone ?? null,
    b.address ?? null, b.appearance ? JSON.stringify(b.appearance) : null]);
  await audit({ query: q }, req.ctx, 'configuracoes.empresa', { entity: 'company', entityId: req.ctx.companyId, data: b });
  res.json({ ok: true });
}));

const pdvLayer = z.object({
  scanner_enabled: z.boolean(), mode: z.enum(['manual', 'continua', 'dupla']), double_read_mandatory: z.boolean(),
  allow_manual: z.boolean(), allow_manual_exception: z.boolean(), exception_requires_manager: z.boolean(),
  allow_mode_change: z.boolean(), product_timeout_s: z.number().int(), open_free_card_on_scan: z.boolean(),
  feedback_sound: z.boolean(), qty_per_scan: z.number().int().min(1).max(100), max_qty_per_scan: z.number().int().min(1).max(100),
  terminator: z.enum(['Enter', 'Tab']), kitchen_send: z.enum(['imediato', 'lote']), require_open_cash: z.boolean(),
  service_fee_bp: z.number().int().min(0).max(3000), card_prefix: z.string().regex(/^[A-Z0-9-]{1,8}$/),
}).partial();

router.get('/pdv-settings', h(async (req, res) => {
  const unitId = Number(req.query.unit_id) || req.ctx.terminalUnitId || req.ctx.unitId || null;
  const c = await q('select settings->\'pdv\' as s from companies where id = $1', [req.ctx.companyId]);
  const u = unitId ? await q('select settings->\'pdv\' as s from units where id = $1 and company_id = $2', [unitId, req.ctx.companyId]) : { rows: [] };
  const tid = Number(req.query.terminal_id) || req.ctx.terminalId;
  const t = tid ? await q('select settings->\'pdv\' as s from terminals where id = $1 and company_id = $2', [tid, req.ctx.companyId]) : { rows: [] };
  res.json({ company: c.rows[0]?.s || {}, unit: u.rows[0]?.s || {}, terminal: t.rows[0]?.s || {},
    effective: mergePdv(c.rows[0]?.s, u.rows[0]?.s, t.rows[0]?.s) });
}));

router.put('/pdv-settings/:level', need('configuracoes.gerenciar'), h(async (req, res) => {
  const level = parse(z.enum(['company', 'unit', 'terminal']), req.params.level);
  const b = parse(pdvLayer, req.body?.settings);
  validatePdvLayer(b);
  const id = Number(req.body?.id);
  await tx(async (db) => {
    let before;
    if (level === 'company') {
      before = (await db.query("select settings->'pdv' s, settings from companies where id = $1 for update", [req.ctx.companyId])).rows[0];
      const merged = { ...(before.s || {}), ...b };
      validatePdvLayer(merged);
      await db.query("update companies set settings = jsonb_set(settings, '{pdv}', $2::jsonb) where id = $1", [req.ctx.companyId, JSON.stringify(merged)]);
    } else {
      const table = level === 'unit' ? 'units' : 'terminals';
      before = (await db.query(`select settings->'pdv' s from ${table} where id = $1 and company_id = $2 for update`, [id, req.ctx.companyId])).rows[0];
      if (!before) throw notFound();
      const merged = { ...(before.s || {}), ...b };
      validatePdvLayer(merged);
      await db.query(`update ${table} set settings = jsonb_set(settings, '{pdv}', $3::jsonb) where id = $1 and company_id = $2`, [id, req.ctx.companyId, JSON.stringify(merged)]);
    }
    await audit(db, req.ctx, 'pdv.configuracao', { entity: level, entityId: id || req.ctx.companyId, data: { before: before?.s || {}, after: b } });
  });
  res.json({ ok: true, effective: await pdvSettings({ query: q }, req.ctx, req.ctx.terminalUnitId || req.ctx.unitId) });
}));

// ---- Auditoria ----
router.get('/audit', need('auditoria.visualizar'), h(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const params = [req.ctx.companyId];
  let where = 'a.company_id = $1';
  if (req.query.action) { params.push(`${String(req.query.action)}%`); where += ` and a.action like $${params.length}`; }
  if (req.query.entity) { params.push(String(req.query.entity)); where += ` and a.entity = $${params.length}`; }
  if (req.query.entity_id) { params.push(String(req.query.entity_id)); where += ` and a.entity_id = $${params.length}`; }
  params.push(limit, offset);
  const { rows } = await q(
    `select a.id, a.action, a.entity, a.entity_id, a.reason, a.data, a.created_at, a.terminal_id, a.unit_id, u.name as user_name
       from audit_events a left join users u on u.id = a.user_id
      where ${where} order by a.id desc limit $${params.length - 1} offset $${params.length}`, params);
  if (req.query.format === 'csv') {
    res.type('text/csv; charset=utf-8').attachment('auditoria.csv');
    return res.send(['data;usuario;acao;entidade;id;motivo', ...rows.map((r) =>
      [r.created_at.toISOString(), r.user_name, r.action, r.entity, r.entity_id, r.reason].map(csvCell).join(';'))].join('\n'));
  }
  res.json(rows);
}));

/* ---- Autorização gerencial ----
   O gerente se identifica com e-mail e senha no próprio terminal; gera uma autorização individual,
   de uso único, válida por 2 minutos, para UMA ação. Nada de PIN compartilhado. */
router.post('/authorizations', h(async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().max(160), password: z.string().max(200),
    action: z.enum(['excecao_dupla_leitura', 'cancelar_item', 'desconto', 'alterar_preco', 'reabrir_comanda', 'cancelar_venda', 'taxa_servico']),
    reason: z.string().trim().min(3).max(300) }), req.body);
  await rateLimit(`auth-mgr:${req.ctx.companyId}:${b.email}`, 5, 600);
  const requiredPerm = { excecao_dupla_leitura: 'pdv.excecao_dupla_leitura', cancelar_item: 'pdv.cancelar_item', desconto: 'pdv.desconto',
    alterar_preco: 'pdv.alterar_preco', reabrir_comanda: 'pdv.reabrir_comanda', cancelar_venda: 'pdv.cancelar_venda', taxa_servico: 'pdv.taxa_servico' }[b.action];
  const { rows } = await q(`select u.id, u.password_hash, r.permissions from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
                             where lower(u.email) = $1 and u.company_id = $2 and u.active`, [b.email, req.ctx.companyId]);
  const m = rows[0];
  const ok = m && (await bcrypt.compare(b.password, m.password_hash));
  if (!ok || !m.permissions.includes('pdv.autorizar') || !m.permissions.includes(requiredPerm)) {
    await audit({ query: q }, req.ctx, 'autorizacao.negada', { data: { action: b.action, email: b.email } });
    throw forbidden('Autorização recusada: credenciais inválidas ou sem permissão para autorizar esta ação');
  }
  const token = randomToken(24);
  await q(`insert into manager_authorizations (company_id, requested_by, authorized_by, action, scope, token_hash, expires_at)
           values ($1,$2,$3,$4,$5,$6, now() + interval '2 minutes')`,
  [req.ctx.companyId, req.ctx.userId, m.id, b.action, { reason: b.reason, terminal: req.ctx.terminalId }, sha256(token)]);
  await audit({ query: q }, req.ctx, 'autorizacao.concedida', { reason: b.reason, data: { action: b.action, authorized_by: m.id } });
  res.json({ authorization: token, expires_in: 120 });
}));

// Consome a autorização (uso único) — chamado dentro da transação da ação autorizada
export async function consumeAuthorization(db, ctx, token, action) {
  if (!token) throw forbidden('Esta ação exige autorização de um gerente', 'authorization_required');
  const { rows } = await db.query(
    `update manager_authorizations set used_at = now()
      where token_hash = $1 and company_id = $2 and requested_by = $3 and action = $4 and used_at is null and expires_at > now()
      returning authorized_by, scope`, [sha256(token), ctx.companyId, ctx.userId, action]);
  if (!rows[0]) throw forbidden('Autorização gerencial inválida, expirada ou já utilizada');
  return rows[0];
}
