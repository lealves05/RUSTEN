// Delivery e retirada: criação do pedido (site, WhatsApp, telefone) com preço e disponibilidade validados no servidor.
import crypto from 'node:crypto';
import { bad, conflict, notFound, lineTotal, randomToken } from './core.js';
import { openSession } from '../routes/pdv.js';
import { consumeForItem } from './stock.js';
import { onlyDigits } from './customers.js';
import { deriveKey } from './auth.js';

export const deliveryConfig = (settings) => ({
  enabled: false, accepting: true, delivery: true, pickup: true, fee_cents: 0, min_order_cents: 0, eta_minutes: 45,
  hours: '', areas: '', payment_methods: ['dinheiro', 'pix', 'cartao'], message: '',
  ...(settings?.delivery || {}),
});

export const FLOW = {
  recebido: ['confirmado', 'cancelado'],
  confirmado: ['em_preparo', 'pronto', 'cancelado'],
  em_preparo: ['pronto', 'cancelado'],
  pronto: ['saiu', 'entregue', 'cancelado'],
  saiu: ['entregue', 'cancelado'],
  entregue: [],
  cancelado: [],
};
export const STATUS_LABEL = { recebido: 'Recebido', confirmado: 'Confirmado', em_preparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado' };

// Contexto de sistema para pedidos públicos (sem usuário): nunca concede permissões além do necessário
export const systemCtx = (companyId) => ({ companyId, userId: null, unitId: null, terminalId: null, level: 0, can: (p) => ['pdv.abrir_comanda', 'delivery.gerenciar'].includes(p) });

/* Monta as linhas do pedido a partir do cardápio vigente. `channel` decide quais produtos estão disponíveis. */
export async function priceCart(db, companyId, cart, { channel = 'delivery' } = {}) {
  if (!Array.isArray(cart) || !cart.length) throw bad('Carrinho vazio');
  const ids = [...new Set(cart.map((c) => Number(c.product_id)))];
  const prods = Object.fromEntries((await db.query(`select * from products where company_id = $1 and id = any($2)`, [companyId, ids])).rows.map((p) => [p.id, p]));
  const lines = [];
  for (const c of cart) {
    const p = prods[Number(c.product_id)];
    if (!p || !p.active) throw conflict(`Produto indisponível${p ? `: ${p.name}` : ''}`, 'product_unavailable');
    if (channel !== 'interno' && !p.channels.includes('delivery') && !p.channels.includes('cardapio_digital')) throw conflict(`${p.name} não está disponível para delivery`, 'product_unavailable');
    if (p.kind === 'weight') throw conflict(`${p.name} é vendido por peso e não pode ser pedido online`, 'product_unavailable');
    const qty = Number(c.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw bad('Quantidade inválida');
    const optionIds = (c.option_ids || []).map(Number);
    const groups = (await db.query(
      `select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active where g.product_id = $1 group by g.id order by g.sort, g.id`, [p.id])).rows;
    const chosen = [];
    for (const g of groups) {
      const sel = g.options.filter((o) => optionIds.includes(o.id));
      if (sel.length < g.min_select) throw bad(`${p.name}: escolha ${g.min_select} em "${g.name}"`, 'options_required');
      if (sel.length > g.max_select) throw bad(`${p.name}: no máximo ${g.max_select} em "${g.name}"`);
      for (const o of sel) chosen.push({ group: g.name, id: o.id, name: o.name, price_cents: o.price_cents });
    }
    if (chosen.length !== new Set(optionIds).size) throw bad('Opção inválida');
    const mods = chosen.reduce((s, o) => s + o.price_cents, 0);
    lines.push({ product: p, qty, chosen, mods, notes: c.notes ? String(c.notes).slice(0, 140) : null, total: lineTotal(p.price_cents, qty, mods, 0) });
  }
  return { lines, subtotal: lines.reduce((s, l) => s + l.total, 0) };
}

export async function createDeliveryOrder(db, companyId, input, actor) {
  const co = (await db.query('select id, name, settings from companies where id = $1', [companyId])).rows[0];
  if (!co) throw notFound();
  const cfg = deliveryConfig(co.settings);
  const internal = input.channel === 'telefone' || input.channel === 'balcao';
  if (!internal && (!cfg.enabled || !cfg.accepting)) throw conflict('O estabelecimento não está recebendo pedidos agora', 'closed');
  if (input.mode === 'entrega' && !cfg.delivery) throw bad('Entrega indisponível: escolha retirada');
  if (input.mode === 'retirada' && !cfg.pickup) throw bad('Retirada indisponível');
  if (input.mode === 'entrega' && (!input.address?.street || !input.address?.number)) throw bad('Informe rua e número para entrega');
  const phone = onlyDigits(input.phone);
  if (phone.length < 10) throw bad('Telefone com DDD é obrigatório');
  const dup = (await db.query('select id, public_token, number from delivery_orders where company_id = $1 and client_key = $2', [companyId, input.client_key])).rows[0];
  if (dup) return { replay: true, ...dup };

  const { lines, subtotal } = await priceCart(db, companyId, input.cart, { channel: internal ? 'interno' : 'delivery' });
  if (!internal && subtotal < cfg.min_order_cents) throw bad(`Pedido mínimo de R$ ${(cfg.min_order_cents / 100).toFixed(2).replace('.', ',')}`, 'min_order');
  const fee = input.mode === 'entrega' ? cfg.fee_cents : 0;
  const cust = (await db.query(`select id from customers where company_id = $1 and anonymized_at is null and regexp_replace(coalesce(phone,''),'\\D','','g') = $2 limit 1`, [companyId, phone])).rows[0];
  const ctx = actor || systemCtx(companyId);
  const number = Number((await db.query('select coalesce(max(number),0)+1 as n from delivery_orders where company_id = $1', [companyId])).rows[0].n);
  const session = await openSession(db, { ...ctx, companyId }, { kind: 'delivery', label: `Delivery #${number}`, customer_name: input.customer_name,
    customer_id: cust?.id, delivery_fee_cents: fee });
  for (const [i, l] of lines.entries()) {
    const item = (await db.query(
      `insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents,
         total_cents, notes, sector_id, kitchen_status, launch_mode, user_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13,'delivery',$14,$15) returning *`,
      [companyId, session.id, l.product.id, l.product.name, l.qty, l.product.unit, l.product.price_cents, JSON.stringify(l.chosen), l.mods, l.total,
        l.notes, l.product.sector_id, l.product.sector_id ? 'novo' : 'nao_produz', ctx.userId, `dlv${session.id}x${i}`])).rows[0];
    await consumeForItem(db, { ...ctx, companyId }, item, l.product, l.chosen.map((o) => o.id));
  }
  const token = randomToken(18);
  const o = (await db.query(
    `insert into delivery_orders (company_id, unit_id, session_id, number, public_token, channel, mode, customer_id, customer_name, phone, address,
       payment_hint, change_for_cents, notes, eta_minutes, client_key, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
    [companyId, session.unit_id, session.id, number, token, input.channel, input.mode, cust?.id ?? null, input.customer_name, phone, input.address || {},
      input.payment_hint ?? null, input.change_for_cents ?? null, input.notes ?? null, cfg.eta_minutes, input.client_key,
      internal ? 'confirmado' : 'recebido'])).rows[0];
  if (internal) await db.query(`update order_items set sent_at = now() where session_id = $1 and kitchen_status = 'novo'`, [session.id]);
  await db.query('insert into delivery_events (company_id, order_id, status, user_id, note) values ($1,$2,$3,$4,$5)',
    [companyId, o.id, o.status, ctx.userId, `Pedido via ${input.channel}`]);
  return { ...o, subtotal, fee, total: subtotal + fee };
}

// Link de avaliação pós-consumo: id do consumo + assinatura (não adivinhável, não expõe dados)
const reviewKey = () => deriveKey('review-link');
export const reviewToken = (sessionId) => `${sessionId}.${crypto.createHmac('sha256', reviewKey()).update(String(sessionId)).digest('base64url').slice(0, 16)}`;
export function parseReviewToken(token) {
  const [id, sig] = String(token || '').split('.');
  if (!/^\d+$/.test(id || '') || !sig) return null;
  return reviewToken(id) === `${id}.${sig}` ? Number(id) : null;
}
