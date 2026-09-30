// Caixa: abertura por terminal/operador, sangria, suprimento, despesa, fechamento cego e reabertura.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict, businessDate } from '../lib/core.js';
import { need, audit, assertCan } from '../lib/auth.js';

export const router = Router();
const METHODS = ['dinheiro', 'pix', 'debito', 'credito', 'vale', 'outro'];

async function expected(db, cashId) {
  const c = (await db.query('select opening_cents from cash_sessions where id = $1', [cashId])).rows[0];
  const pays = (await db.query(
    `select method, coalesce(sum(amount_cents),0)::bigint as total from payments where cash_session_id = $1 and status = 'confirmado' group by method`, [cashId])).rows;
  const mov = (await db.query(
    `select kind, coalesce(sum(amount_cents),0)::bigint as total from cash_movements where cash_session_id = $1 group by kind`, [cashId])).rows;
  const byMethod = Object.fromEntries(METHODS.map((m) => [m, 0]));
  for (const p of pays) byMethod[p.method] = Number(p.total);
  const m = Object.fromEntries(mov.map((r) => [r.kind, Number(r.total)]));
  // Dinheiro esperado na gaveta: abertura + vendas em dinheiro + suprimentos − sangrias − despesas (troco já descontado do valor aplicado)
  byMethod.dinheiro = c.opening_cents + byMethod.dinheiro + (m.suprimento || 0) - (m.sangria || 0) - (m.despesa || 0);
  return { byMethod, opening: c.opening_cents, movements: m };
}

async function currentCash(req) {
  const params = [req.ctx.companyId];
  let where = "c.company_id = $1 and c.status = 'aberto'";
  if (req.ctx.terminalId) { params.push(req.ctx.terminalId); where += ` and c.terminal_id = $${params.length}`; }
  else { params.push(req.ctx.userId); where += ` and c.user_id = $${params.length} and c.terminal_id is null`; }
  return (await q(`select c.*, u.name as user_name from cash_sessions c join users u on u.id = c.user_id where ${where} order by c.id desc limit 1`, params)).rows[0];
}

router.get('/current', h(async (req, res) => {
  const c = await currentCash(req);
  if (!c) return res.json({ open: false });
  const showExpected = req.ctx.can('financeiro.visualizar');
  // Fechamento cego: operador sem acesso financeiro não vê o esperado
  res.json({ open: true, cash: { id: c.id, opened_at: c.opened_at, user_name: c.user_name, opening_cents: c.opening_cents, business_date: c.business_date },
    expected: showExpected ? await expected({ query: q }, c.id) : null });
}));

router.post('/open', need('caixa.abrir'), h(async (req, res) => {
  const b = parse(z.object({ opening_cents: z.number().int().min(0).max(10000000) }), req.body);
  const unitId = req.ctx.terminalUnitId || req.ctx.unitId || (await q('select id from units where company_id = $1 order by id limit 1', [req.ctx.companyId])).rows[0].id;
  if (!req.ctx.terminalId) {
    const t = await q('select 1 from terminals where company_id = $1 and active limit 1', [req.ctx.companyId]);
    if (t.rows[0]) throw bad('Identifique o terminal deste dispositivo antes de abrir o caixa', 'terminal_required');
  }
  if (await currentCash(req)) throw conflict('Já existe caixa aberto neste terminal', 'cash_open');
  const u = (await q('select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1', [unitId])).rows[0];
  const r = await q(`insert into cash_sessions (company_id, unit_id, terminal_id, user_id, opening_cents, business_date) values ($1,$2,$3,$4,$5,$6) returning id`,
    [req.ctx.companyId, unitId, req.ctx.terminalId, req.ctx.userId, b.opening_cents, businessDate(new Date(), u.timezone, u.day_cutoff)])
    .catch((e) => { if (e.code === '23505') throw conflict('Já existe caixa aberto neste terminal', 'cash_open'); throw e; });
  await audit({ query: q }, req.ctx, 'caixa.aberto', { entity: 'cash', entityId: r.rows[0].id, unitId, data: b });
  res.status(201).json({ id: r.rows[0].id });
}));

router.post('/:id/movements', h(async (req, res) => {
  const b = parse(z.object({ kind: z.enum(['sangria', 'suprimento', 'despesa']), amount_cents: z.number().int().positive().max(10000000), reason: z.string().trim().min(3).max(200) }), req.body);
  assertCan(req.ctx, b.kind === 'suprimento' ? 'caixa.suprimento' : 'caixa.sangria');
  const out = await tx(async (db) => {
    const c = (await db.query("select * from cash_sessions where id = $1 and company_id = $2 for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound('Caixa não encontrado');
    if (c.status !== 'aberto') throw conflict('Caixa fechado');
    if (b.kind !== 'suprimento') {
      const e = await expected(db, c.id);
      if (b.amount_cents > e.byMethod.dinheiro) throw bad('Valor maior que o dinheiro esperado na gaveta');
    }
    const r = await db.query('insert into cash_movements (company_id, cash_session_id, kind, amount_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6) returning id',
      [req.ctx.companyId, c.id, b.kind, b.amount_cents, b.reason, req.ctx.userId]);
    await audit(db, req.ctx, `caixa.${b.kind}`, { entity: 'cash', entityId: c.id, reason: b.reason, data: { amount_cents: b.amount_cents } });
    return { id: r.rows[0].id };
  });
  res.status(201).json(out);
}));

router.post('/:id/close', need('caixa.fechar'), h(async (req, res) => {
  const b = parse(z.object({
    counted: z.object(Object.fromEntries(METHODS.map((m) => [m, z.number().int().min(0).max(100000000).default(0)]))),
    notes: z.record(z.string(), z.number().int().min(0).max(100000)).optional(), // contador de cédulas/moedas
    justification: z.string().trim().max(300).optional(),
  }), req.body);
  const out = await tx(async (db) => {
    const c = (await db.query('select * from cash_sessions where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound('Caixa não encontrado');
    if (c.status !== 'aberto') throw conflict('Caixa já fechado');
    const e = await expected(db, c.id);
    const diffByMethod = Object.fromEntries(METHODS.map((m) => [m, (b.counted[m] || 0) - (e.byMethod[m] || 0)]));
    const diff = Object.values(diffByMethod).reduce((s, v) => s + v, 0);
    if (Object.values(diffByMethod).some((v) => v !== 0) && !b.justification)
      throw bad('Há diferença na conferência: informe a justificativa', 'justification_required');
    await db.query(`update cash_sessions set status = 'fechado', closed_at = now(), closed_by = $2, counted = $3, expected = $4,
                      difference_cents = $5, justification = $6 where id = $1`,
    [c.id, req.ctx.userId, { ...b.counted, notes: b.notes ?? null }, e.byMethod, diff, b.justification ?? null]);
    await audit(db, req.ctx, 'caixa.fechado', { entity: 'cash', entityId: c.id, reason: b.justification, data: { difference_cents: diff, by_method: diffByMethod } });
    return { ok: true, expected: e.byMethod, counted: b.counted, difference_cents: diff, by_method: diffByMethod };
  });
  res.json(out);
}));

router.post('/:id/reopen', need('caixa.reabrir'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  await tx(async (db) => {
    const c = (await db.query('select * from cash_sessions where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound();
    if (c.status !== 'fechado') throw conflict('Caixa não está fechado');
    if (new Date(c.closed_at) < new Date(Date.now() - 48 * 3600 * 1000)) throw bad('Reabertura permitida até 48 horas após o fechamento');
    const other = c.terminal_id ? await db.query("select 1 from cash_sessions where terminal_id = $1 and status = 'aberto'", [c.terminal_id]) : { rows: [] };
    if (other.rows[0]) throw conflict('Já existe outro caixa aberto neste terminal');
    await db.query("update cash_sessions set status = 'aberto', closed_at = null, closed_by = null where id = $1", [c.id]);
    await audit(db, req.ctx, 'caixa.reaberto', { entity: 'cash', entityId: c.id, reason: b.reason, data: { previous: { counted: c.counted, difference_cents: c.difference_cents, closed_at: c.closed_at } } });
  });
  res.json({ ok: true });
}));

router.get('/', need('financeiro.visualizar'), h(async (req, res) => {
  res.json((await q(`select c.id, c.status, c.opened_at, c.closed_at, c.business_date, c.opening_cents, c.difference_cents, c.justification,
                            u.name as user_name, t.name as terminal_name
                       from cash_sessions c join users u on u.id = c.user_id left join terminals t on t.id = c.terminal_id
                      where c.company_id = $1 order by c.id desc limit 100`, [req.ctx.companyId])).rows);
}));

router.get('/:id/report', need('financeiro.visualizar'), h(async (req, res) => {
  const c = (await q('select * from cash_sessions where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!c) throw notFound();
  const mov = (await q('select m.kind, m.amount_cents, m.reason, m.created_at, u.name user_name from cash_movements m left join users u on u.id = m.user_id where cash_session_id = $1 order by m.id', [c.id])).rows;
  res.json({ cash: c, expected: await expected({ query: q }, c.id), movements: mov });
}));
