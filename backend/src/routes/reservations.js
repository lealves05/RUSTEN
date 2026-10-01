// Reservas de mesa: lista do dia, registro pela equipe, confirmação dos pedidos do agente, chegada e não comparecimento.
import { Router } from 'express';
import { z } from 'zod';
import { q, h, parse, bad, notFound } from '../lib/core.js';
import { need, audit } from '../lib/auth.js';
import { onlyDigits } from '../lib/customers.js';

export const router = Router();

router.get('/', need('salao.visualizar'), h(async (req, res) => {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.day)) ? req.query.day : null;
  const tz = req.ctx.company.timezone;
  const params = [req.ctx.companyId, tz];
  let where = 'r.company_id = $1';
  if (day) { params.push(day); where += ` and (r.starts_at at time zone $2)::date = $${params.length}`; } else where += " and r.starts_at > now() - interval '3 hours'";
  res.json((await q(`select r.*, t.number as table_number from reservations r left join dining_tables t on t.id = r.table_id where ${where} order by r.starts_at limit 200`, params)).rows);
}));

router.post('/', need('salao.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ customer_name: z.string().trim().min(2).max(80), phone: z.string().trim().max(20).optional(), people: z.number().int().min(1).max(100),
    starts_at: z.string().datetime({ offset: true }), table_id: z.number().int().nullable().optional(), notes: z.string().max(300).optional() }), req.body);
  if (new Date(b.starts_at).getTime() < Date.now() - 3600000) throw bad('Horário já passou');
  if (b.table_id) { const t = await q('select 1 from dining_tables where id = $1 and company_id = $2', [b.table_id, req.ctx.companyId]); if (!t.rows[0]) throw bad('Mesa inválida'); }
  const unit = req.ctx.unitId || (await q('select id from units where company_id = $1 order by id limit 1', [req.ctx.companyId])).rows[0].id;
  const r = await q(`insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, table_id, notes, status, source)
    values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmada','equipe') returning id`,
  [req.ctx.companyId, unit, b.customer_name, b.phone ? onlyDigits(b.phone) : null, b.people, b.starts_at, b.table_id ?? null, b.notes ?? null]);
  await audit({ query: q }, req.ctx, 'reserva.criada', { entity: 'reservation', entityId: r.rows[0].id, data: { people: b.people, starts_at: b.starts_at } });
  res.status(201).json({ id: r.rows[0].id });
}));

router.post('/:id/status', need('salao.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['confirmada', 'cancelada', 'chegou', 'nao_compareceu']), table_id: z.number().int().nullable().optional() }), req.body);
  const r = await q('update reservations set status = $3, table_id = coalesce($4, table_id) where id = $1 and company_id = $2 returning id, table_id',
    [Number(req.params.id), req.ctx.companyId, b.status, b.table_id ?? null]);
  if (!r.rows[0]) throw notFound('Reserva não encontrada');
  if (b.status === 'confirmada' && r.rows[0].table_id) await q("update dining_tables set status = 'reservada' where id = $1 and status = 'livre'", [r.rows[0].table_id]);
  await audit({ query: q }, req.ctx, `reserva.${b.status}`, { entity: 'reservation', entityId: r.rows[0].id });
  res.json({ ok: true });
}));
