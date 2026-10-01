// Delivery (área interna): painel de pedidos, mudança de situação, entregador, comprovante e configuração do cardápio digital.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict } from '../lib/core.js';
import { need, audit, assertCan } from '../lib/auth.js';
import { deliveryConfig, createDeliveryOrder, FLOW, STATUS_LABEL } from '../lib/delivery.js';
import { reverseForItem } from '../lib/stock.js';
import { sessionTotals } from '../lib/pdv.js';

export const router = Router();

const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'loja';

router.get('/settings', need('delivery.gerenciar'), h(async (req, res) => {
  const c = (await q('select slug, name, settings from companies where id = $1', [req.ctx.companyId])).rows[0];
  res.json({ slug: c.slug, suggested_slug: c.slug || slugify(c.name), ...deliveryConfig(c.settings) });
}));

router.put('/settings', need('delivery.gerenciar', 'configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'use letras minúsculas, números e hífen (3 a 40)'),
    enabled: z.boolean(), accepting: z.boolean(), delivery: z.boolean(), pickup: z.boolean(),
    fee_cents: z.number().int().min(0).max(100000), min_order_cents: z.number().int().min(0).max(1000000), eta_minutes: z.number().int().min(5).max(300),
    hours: z.string().max(300).default(''), areas: z.string().max(500).default(''), message: z.string().max(300).default(''),
    payment_methods: z.array(z.enum(['dinheiro', 'pix', 'cartao'])).min(1),
  }), req.body);
  if (!b.delivery && !b.pickup) throw bad('Habilite entrega, retirada ou ambos');
  const { slug, ...cfg } = b;
  await tx(async (db) => {
    const taken = await db.query('select 1 from companies where slug = $1 and id <> $2', [slug, req.ctx.companyId]);
    if (taken.rows[0]) throw conflict('Este endereço já está em uso por outra empresa', 'slug_taken');
    await db.query(`update companies set slug = $2, settings = jsonb_set(settings, '{delivery}', $3::jsonb) where id = $1`, [req.ctx.companyId, slug, JSON.stringify(cfg)]);
    await audit(db, req.ctx, 'delivery.configuracao', { data: { slug, ...cfg } });
  });
  res.json({ ok: true });
}));

router.get('/orders', need('delivery.gerenciar'), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = 'd.company_id = $1';
  if (req.query.status === 'abertos') where += " and d.status not in ('entregue','cancelado')";
  else if (req.query.status === 'hoje') where += " and d.created_at > now() - interval '24 hours'";
  if (!req.ctx.can('delivery.gerenciar')) { params.push(req.ctx.userId); where += ` and d.courier_id = $${params.length}`; }
  const rows = (await q(`select d.*, u.name as courier_name, s.status as session_status,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') as items_cents,
      (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = d.session_id and p.status = 'confirmado') as paid_cents,
      s.delivery_fee_cents,
      (select json_agg(json_build_object('description', i.description, 'qty', i.qty, 'modifiers', i.modifiers, 'notes', i.notes, 'kitchen_status', i.kitchen_status, 'status', i.status) order by i.id)
         from order_items i where i.session_id = d.session_id) as items
    from delivery_orders d join consumption_sessions s on s.id = d.session_id left join users u on u.id = d.courier_id
    where ${where} order by case when d.status in ('entregue','cancelado') then 1 else 0 end, d.created_at desc limit 200`, params)).rows;
  res.json(rows);
}));

// Entregador vê só os pedidos atribuídos a ele (endereço com acesso restrito)
router.get('/my', need('delivery.entregar'), h(async (req, res) => {
  res.json((await q(`select d.id, d.number, d.status, d.customer_name, d.phone, d.address, d.payment_hint, d.change_for_cents, d.notes,
      (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = d.session_id and i.status = 'ativo') + s.delivery_fee_cents as total_cents
    from delivery_orders d join consumption_sessions s on s.id = d.session_id where d.company_id = $1 and d.courier_id = $2 and d.status in ('pronto','saiu') order by d.id`,
  [req.ctx.companyId, req.ctx.userId])).rows);
}));

const orderInput = z.object({
  mode: z.enum(['entrega', 'retirada']), channel: z.enum(['telefone', 'balcao']).default('telefone'),
  customer_name: z.string().trim().min(2).max(80), phone: z.string().trim().min(10).max(20),
  address: z.object({ street: z.string().max(120), number: z.string().max(20), district: z.string().max(80).optional(), complement: z.string().max(80).optional(), reference: z.string().max(120).optional() }).partial().optional(),
  payment_hint: z.enum(['dinheiro', 'pix', 'cartao']).optional(), change_for_cents: z.number().int().min(0).max(10000000).optional(),
  notes: z.string().max(300).optional(),
  cart: z.array(z.object({ product_id: z.number().int(), qty: z.number().int().min(1).max(50), option_ids: z.array(z.number().int()).max(40).default([]), notes: z.string().max(140).optional() })).min(1).max(60),
  client_key: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
});

// Pedido por telefone/balcão registrado pela equipe (já entra confirmado)
router.post('/orders', need('delivery.gerenciar'), h(async (req, res) => {
  const b = parse(orderInput, req.body);
  const o = await tx((db) => createDeliveryOrder(db, req.ctx.companyId, b, req.ctx));
  await audit({ query: q }, req.ctx, 'delivery.pedido_interno', { entity: 'delivery', entityId: o.id, data: { number: o.number, mode: b.mode } });
  res.status(o.replay ? 200 : 201).json(o);
}));

router.post('/orders/:id/status', h(async (req, res) => {
  const b = parse(z.object({ to: z.enum(['confirmado', 'em_preparo', 'pronto', 'saiu', 'entregue', 'cancelado']), reason: z.string().trim().max(200).optional(),
    proof: z.string().trim().max(200).optional(), eta_minutes: z.number().int().min(5).max(300).optional() }), req.body);
  const out = await tx(async (db) => {
    const o = (await db.query('select * from delivery_orders where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!o) throw notFound('Pedido não encontrado');
    // entregador só registra saída e entrega dos pedidos dele; o restante é da gestão
    if (['saiu', 'entregue'].includes(b.to) && !req.ctx.can('delivery.gerenciar')) {
      assertCan(req.ctx, 'delivery.entregar');
      if (Number(o.courier_id) !== Number(req.ctx.userId)) throw conflict('Pedido atribuído a outro entregador');
    } else assertCan(req.ctx, 'delivery.gerenciar');
    if (o.status === b.to) return { ok: true, replay: true };
    if (!FLOW[o.status].includes(b.to)) throw conflict(`Não é possível ir de "${STATUS_LABEL[o.status]}" para "${STATUS_LABEL[b.to]}"`, 'invalid_transition');
    if (b.to === 'saiu' && o.mode !== 'entrega') throw bad('Pedido de retirada não sai para entrega');
    if (b.to === 'cancelado' && !b.reason) throw bad('Informe o motivo do cancelamento');
    if (b.to === 'confirmado') await db.query(`update order_items set sent_at = now() where session_id = $1 and kitchen_status = 'novo' and sent_at is null and status = 'ativo'`, [o.session_id]);
    if (b.to === 'cancelado') {
      const t = await sessionTotals(db, o.session_id);
      if (t.paid > 0) throw conflict('Há pagamento confirmado: estorne antes de cancelar', 'has_payments');
      const items = (await db.query(`select id, kitchen_status from order_items where session_id = $1 and status = 'ativo'`, [o.session_id])).rows;
      for (const it of items) if (['novo', 'aceito', 'nao_produz'].includes(it.kitchen_status)) await reverseForItem(db, req.ctx, it.id, `Delivery cancelado: ${b.reason}`);
      await db.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
          kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where session_id = $1 and status = 'ativo'`,
      [o.session_id, `Delivery cancelado: ${b.reason}`, req.ctx.userId]);
      await db.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2 where id = $1", [o.session_id, req.ctx.userId]);
    }
    if (b.to === 'entregue') {
      const t = await sessionTotals(db, o.session_id);
      if (t.balance > 0 && !b.proof) throw conflict(`Saldo de R$ ${(t.balance / 100).toFixed(2).replace('.', ',')} em aberto: registre o pagamento ou informe o comprovante`, 'balance_pending');
    }
    await db.query(`update delivery_orders set status = $2, cancel_reason = coalesce($3, cancel_reason), proof = coalesce($4, proof),
        eta_minutes = coalesce($5, eta_minutes), updated_at = now() where id = $1`, [o.id, b.to, b.to === 'cancelado' ? b.reason : null, b.proof ?? null, b.eta_minutes ?? null]);
    await db.query('insert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)',
      [req.ctx.companyId, o.id, b.to, req.ctx.userId, b.reason || b.proof || null]);
    await audit(db, req.ctx, `delivery.${b.to}`, { entity: 'delivery', entityId: o.id, reason: b.reason, data: { from: o.status } });
    return { ok: true, status: b.to };
  });
  res.json(out);
}));

router.post('/orders/:id/courier', need('delivery.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ courier_id: z.number().int().nullable() }), req.body);
  if (b.courier_id) {
    const u = (await q('select 1 from users where id = $1 and company_id = $2 and active', [b.courier_id, req.ctx.companyId])).rows[0];
    if (!u) throw bad('Entregador inválido');
  }
  const r = await q('update delivery_orders set courier_id = $3, updated_at = now() where id = $1 and company_id = $2 returning id', [Number(req.params.id), req.ctx.companyId, b.courier_id]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, 'delivery.entregador', { entity: 'delivery', entityId: r.rows[0].id, data: b });
  res.json({ ok: true });
}));

router.get('/couriers', need('delivery.gerenciar'), h(async (req, res) => {
  res.json((await q(`select u.id, u.name, u.role_key from users u join roles r on r.company_id = u.company_id and r.key = u.role_key
    where u.company_id = $1 and u.active and 'delivery.entregar' = any(r.permissions) order by u.name`, [req.ctx.companyId])).rows);
}));
