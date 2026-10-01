// Salão (mesas) e cartões de comanda físicos.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict } from '../lib/core.js';
import { need, audit } from '../lib/auth.js';
import { createTables, createCards } from '../lib/seed.js';
import { assertUnitScope } from '../lib/pdv.js';

export const router = Router();

const unitOf = (req) => Number(req.query.unit_id || req.body?.unit_id) || req.ctx.terminalUnitId || req.ctx.unitId;
async function defaultUnit(req) {
  const u = unitOf(req);
  if (u) { assertUnitScope(req.ctx, u); return u; }
  return (await q('select id from units where company_id = $1 and active order by id limit 1', [req.ctx.companyId])).rows[0]?.id;
}

router.get('/tables', need('salao.visualizar'), h(async (req, res) => {
  const unitId = await defaultUnit(req);
  const showMoney = req.ctx.can('pdv.receber') || req.ctx.can('financeiro.visualizar') || req.ctx.can('pdv.lancar');
  const { rows } = await q(
    `select t.id, t.number, t.area, t.capacity, t.status, t.pos_x, t.pos_y, t.active,
            (select code from scan_codes s where s.company_id = t.company_id and s.entity = 'MESA' and s.entity_id = t.id limit 1) as code,
            (select count(*)::int from consumption_sessions s where s.table_id = t.id and s.status in ('aberta','em_fechamento')) as open_sessions,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status in ('novo','aceito','preparando')) as preparing,
            (select count(*)::int from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo' and i.kitchen_status = 'pronto') as ready,
            (select string_agg(coalesce(s.customer_name, ''), ', ') filter (where s.customer_name is not null) from consumption_sessions s
              where s.table_id = t.id and s.status in ('aberta','em_fechamento')) as customer_names
            ${showMoney ? `, (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
              where s.table_id = t.id and s.status in ('aberta','em_fechamento') and i.status = 'ativo') as consumed_cents` : ''}
       from dining_tables t where t.company_id = $1 and t.unit_id = $2 and t.active order by t.number`, [req.ctx.companyId, unitId]);
  res.json({ unitId, tables: rows });
}));

router.post('/tables', need('salao.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ from: z.number().int().min(1).max(9999), count: z.number().int().min(1).max(200), area: z.string().max(40).default('Salão'), capacity: z.number().int().min(1).max(50).default(4) }), req.body);
  const unitId = await defaultUnit(req);
  const ids = await tx(async (db) => {
    const created = await createTables(db, req.ctx.companyId, unitId, b.from, b.count);
    if (created.length) await db.query('update dining_tables set area = $2, capacity = $3 where id = any($1)', [created, b.area, b.capacity]);
    await audit(db, req.ctx, 'mesas.criadas', { unitId, data: { from: b.from, count: created.length } });
    return created;
  });
  res.status(201).json({ created: ids.length });
}));

router.put('/tables/:id', need('salao.visualizar'), h(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['livre', 'ocupada', 'reservada', 'conta', 'limpeza']).optional(), area: z.string().max(40).optional(),
    capacity: z.number().int().min(1).max(50).optional(), pos_x: z.number().int().min(0).max(40).optional(), pos_y: z.number().int().min(0).max(40).optional(),
    active: z.boolean().optional() }), req.body);
  const structural = ['area', 'capacity', 'pos_x', 'pos_y', 'active'].some((k) => k in b);
  if (structural && !req.ctx.can('salao.gerenciar')) throw bad('Sem permissão para alterar a estrutura do salão');
  if (b.status && !req.ctx.can('salao.gerenciar') && !req.ctx.can('pdv.lancar')) throw bad('Sem permissão para mudar a situação da mesa');
  if (b.status === 'livre') {
    const open = await q("select 1 from consumption_sessions where table_id = $1 and company_id = $2 and status in ('aberta','em_fechamento')", [Number(req.params.id), req.ctx.companyId]);
    if (open.rows[0]) throw conflict('Mesa com consumo aberto não pode ser liberada');
  }
  const r = await q(`update dining_tables set status = coalesce($3,status), area = coalesce($4,area), capacity = coalesce($5,capacity),
                       pos_x = coalesce($6,pos_x), pos_y = coalesce($7,pos_y), active = coalesce($8,active) where id = $1 and company_id = $2 returning unit_id`,
  [Number(req.params.id), req.ctx.companyId, b.status ?? null, b.area ?? null, b.capacity ?? null, b.pos_x ?? null, b.pos_y ?? null, b.active ?? null]);
  if (!r.rows[0]) throw notFound('Mesa não encontrada');
  await audit({ query: q }, req.ctx, 'mesa.alterada', { entity: 'table', entityId: req.params.id, data: b });
  res.json({ ok: true });
}));

// ---- Cartões de comanda ----
router.get('/cards', need('pdv.lancar'), h(async (req, res) => {
  const unitId = await defaultUnit(req);
  const { rows } = await q(
    `select c.id, c.number, c.status, c.block_reason,
            (select code from scan_codes s where s.company_id = c.company_id and s.entity = 'COMANDA' and s.entity_id = c.id order by s.id limit 1) as code,
            s.id as session_id, s.customer_name, s.opened_at, s.status as session_status, t.number as table_number,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count,
            (select coalesce(sum(i.total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents
       from tab_cards c
       left join lateral (select * from consumption_sessions s where s.card_id = c.id and s.status in ('aberta','em_fechamento') order by s.id desc limit 1) s on true
       left join dining_tables t on t.id = s.table_id
      where c.company_id = $1 and c.unit_id = $2 order by c.number`, [req.ctx.companyId, unitId]);
  res.json({ unitId, cards: rows });
}));

router.post('/cards', need('comandas.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ from: z.number().int().min(1).max(999999), count: z.number().int().min(1).max(1000) }), req.body);
  const unitId = await defaultUnit(req);
  const created = await tx(async (db) => {
    const prefix = (await db.query("select coalesce(settings->'pdv'->>'card_prefix','CMD-') p from companies where id = $1", [req.ctx.companyId])).rows[0].p;
    const c = await createCards(db, req.ctx.companyId, unitId, b.from, b.count, prefix);
    await audit(db, req.ctx, 'comandas.geradas', { unitId, data: { from: b.from, count: c.length } });
    return c;
  });
  res.status(201).json({ created });
}));

router.post('/cards/:id/block', need('comandas.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  const r = await q("update tab_cards set status = 'bloqueado', block_reason = $3 where id = $1 and company_id = $2 returning id", [Number(req.params.id), req.ctx.companyId, b.reason]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, 'comanda.bloqueada', { entity: 'card', entityId: req.params.id, reason: b.reason });
  res.json({ ok: true });
}));

router.post('/cards/:id/unblock', need('comandas.gerenciar'), h(async (req, res) => {
  const r = await q("update tab_cards set status = 'ativo', block_reason = null where id = $1 and company_id = $2 returning id", [Number(req.params.id), req.ctx.companyId]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, 'comanda.desbloqueada', { entity: 'card', entityId: req.params.id });
  res.json({ ok: true });
}));

// Cartão perdido: bloqueia o antigo e passa a MESMA sessão para um cartão livre
router.post('/cards/:id/replace', need('comandas.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ new_card_id: z.number().int(), reason: z.string().trim().min(3).max(200) }), req.body);
  await tx(async (db) => {
    const old = (await db.query('select * from tab_cards where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    const neu = (await db.query('select * from tab_cards where id = $1 and company_id = $2 for update', [b.new_card_id, req.ctx.companyId])).rows[0];
    if (!old || !neu) throw notFound('Cartão não encontrado');
    if (neu.status !== 'ativo') throw bad('O novo cartão está bloqueado');
    if (old.unit_id !== neu.unit_id) throw bad('Cartões de unidades diferentes');
    const busy = await db.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento')", [neu.id]);
    if (busy.rows[0]) throw conflict('O novo cartão já tem consumo em aberto');
    await db.query("update tab_cards set status = 'bloqueado', block_reason = $2 where id = $1", [old.id, `Substituído pelo ${neu.number}: ${b.reason}`]);
    const s = await db.query("update consumption_sessions set card_id = $2, version = version + 1 where card_id = $1 and status in ('aberta','em_fechamento') returning id", [old.id, neu.id]);
    await audit(db, req.ctx, 'comanda.substituida', { entity: 'card', entityId: old.id, reason: b.reason, data: { new_card: neu.id, session: s.rows[0]?.id ?? null } });
  });
  res.json({ ok: true });
}));
