// Rotas públicas (sem login): cardápio digital, pedido online, acompanhamento, avaliação, descadastro e webhook do WhatsApp.
// Nada aqui dá acesso a consumos de salão, fechamento ou dados de outros clientes.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, notFound, conflict, safeEqual } from '../lib/core.js';
import { rateLimit } from '../lib/auth.js';
import { deliveryConfig, createDeliveryOrder, STATUS_LABEL, parseReviewToken } from '../lib/delivery.js';
import { parseUnsubscribe } from './marketing.js';
import { handleIncoming } from '../lib/agent.js';
import { sessionTotals } from '../lib/pdv.js';
import { confirmCharge, logEvent } from '../lib/infinitepay.js';

export const router = Router();

async function companyBySlug(slug) {
  if (!/^[a-z0-9-]{3,40}$/.test(String(slug))) throw notFound('Estabelecimento não encontrado');
  const c = (await q('select id, name, slug, phone, address, timezone, settings, is_demo from companies where slug = $1', [slug])).rows[0];
  if (!c) throw notFound('Estabelecimento não encontrado');
  return c;
}

router.get('/:slug/menu', h(async (req, res) => {
  const c = await companyBySlug(req.params.slug);
  const cfg = deliveryConfig(c.settings);
  if (!cfg.enabled) throw notFound('Cardápio digital desativado');
  const products = (await q(`select p.id, p.name, p.description, p.price_cents, p.allergens, p.category_id, c.name as category,
      coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
         'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                       from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id) from modifier_groups g where g.product_id = p.id), '[]') as groups
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and ('delivery' = any(p.channels) or 'cardapio_digital' = any(p.channels))
    order by c.sort nulls last, c.name, p.name`, [c.id])).rows;
  res.set('cache-control', 'public, max-age=30');
  res.json({ company: { name: c.name, slug: c.slug, phone: c.phone, address: c.address?.city ? `${c.address.street || ''} ${c.address.number || ''} — ${c.address.city}` : null },
    settings: { accepting: cfg.accepting, delivery: cfg.delivery, pickup: cfg.pickup, fee_cents: cfg.fee_cents, min_order_cents: cfg.min_order_cents,
      eta_minutes: cfg.eta_minutes, hours: cfg.hours, areas: cfg.areas, message: cfg.message, payment_methods: cfg.payment_methods },
    products });
}));

const orderSchema = z.object({
  mode: z.enum(['entrega', 'retirada']),
  customer_name: z.string().trim().min(2).max(80), phone: z.string().trim().min(10).max(20),
  address: z.object({ street: z.string().trim().max(120), number: z.string().trim().max(20), district: z.string().trim().max(80).optional(),
    complement: z.string().trim().max(80).optional(), reference: z.string().trim().max(120).optional() }).partial().optional(),
  payment_hint: z.enum(['dinheiro', 'pix', 'cartao']), change_for_cents: z.number().int().min(0).max(1000000).optional(),
  notes: z.string().trim().max(300).optional(),
  cart: z.array(z.object({ product_id: z.number().int(), qty: z.number().int().min(1).max(50), option_ids: z.array(z.number().int()).max(40).default([]),
    notes: z.string().trim().max(140).optional() })).min(1).max(40),
  client_key: z.string().regex(/^[A-Za-z0-9_-]{12,80}$/),
  website: z.string().max(0).optional(), // armadilha para robôs: campo invisível precisa vir vazio
});

router.post('/:slug/orders', h(async (req, res) => {
  const c = await companyBySlug(req.params.slug);
  const b = parse(orderSchema, req.body);
  // abuso: limite por IP e por telefone
  await rateLimit(`pub-order:${c.id}:${req.ip}`, 8, 900);
  await rateLimit(`pub-order-phone:${c.id}:${b.phone.replace(/\D/g, '')}`, 4, 900);
  const o = await tx((db) => createDeliveryOrder(db, c.id, { ...b, channel: 'site' }, null));
  res.status(o.replay ? 200 : 201).json({ number: o.number, token: o.public_token, status: o.status });
}));

// Acompanhamento pelo link secreto do pedido (sem telefone/endereço)
router.get('/orders/:token', h(async (req, res) => {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(req.params.token)) throw notFound('Pedido não encontrado');
  const o = (await q(`select d.id, d.number, d.status, d.mode, d.eta_minutes, d.created_at, d.updated_at, d.session_id, d.customer_name, c.name as company, c.slug
    from delivery_orders d join companies c on c.id = d.company_id where d.public_token = $1`, [req.params.token])).rows[0];
  if (!o) throw notFound('Pedido não encontrado');
  const items = (await q(`select description, qty, modifiers, total_cents from order_items where session_id = $1 and status = 'ativo' order by id`, [o.session_id])).rows;
  const events = (await q('select status, created_at from delivery_events where order_id = $1 order by id', [o.id])).rows;
  const t = await sessionTotals({ query: q }, o.session_id);
  res.set('cache-control', 'no-store');
  res.json({ number: o.number, status: o.status, label: STATUS_LABEL[o.status], mode: o.mode, eta_minutes: o.eta_minutes, created_at: o.created_at,
    first_name: o.customer_name.split(' ')[0], company: o.company, slug: o.slug, items, totals: { items: t.items, delivery_fee: t.deliveryFee, total: t.total },
    events: events.map((e) => ({ status: e.status, label: STATUS_LABEL[e.status], at: e.created_at })) });
}));

// Avaliação pós-consumo
router.get('/review/:token', h(async (req, res) => {
  const sid = parseReviewToken(req.params.token);
  if (!sid) throw notFound('Link inválido');
  const s = (await q(`select s.id, s.company_id, c.name as company, (select 1 from reviews r where r.session_id = s.id) as done
    from consumption_sessions s join companies c on c.id = s.company_id where s.id = $1 and s.status = 'encerrada'`, [sid])).rows[0];
  if (!s) throw notFound('Link inválido');
  res.json({ company: s.company, already: !!s.done });
}));
router.post('/review/:token', h(async (req, res) => {
  const sid = parseReviewToken(req.params.token);
  if (!sid) throw notFound('Link inválido');
  await rateLimit(`pub-review:${req.ip}`, 10, 3600);
  const b = parse(z.object({ score: z.number().int().min(1).max(5), comment: z.string().trim().max(600).optional() }), req.body);
  const s = (await q("select id, company_id, customer_id from consumption_sessions where id = $1 and status = 'encerrada'", [sid])).rows[0];
  if (!s) throw notFound('Link inválido');
  await q('insert into reviews (company_id, session_id, customer_id, score, comment) values ($1,$2,$3,$4,$5)', [s.company_id, s.id, s.customer_id, b.score, b.comment || null])
    .catch((e) => { if (e.code === '23505') throw conflict('Este consumo já foi avaliado. Obrigado!', 'already_reviewed'); throw e; });
  res.status(201).json({ ok: true });
}));

// Descadastro de campanhas (registro do consentimento retirado)
router.post('/unsubscribe/:token', h(async (req, res) => {
  const id = parseUnsubscribe(req.params.token);
  if (!id) throw notFound('Link inválido');
  const r = await q(`update customers set consent_whatsapp = false, consent_email = false, unsubscribed_at = now(), updated_at = now() where id = $1 returning company_id`, [id]);
  if (r.rows[0]) await q(`insert into audit_events (company_id, action, entity, entity_id, data) values ($1,'cliente.descadastro','customer',$2,'{"origem":"link"}')`, [r.rows[0].company_id, String(id)]);
  res.json({ ok: true });
}));

// ---- WhatsApp Cloud API (Meta): verificação e recebimento com assinatura X-Hub-Signature-256 ----
async function secrets(companyId) {
  return Object.fromEntries((await q("select key, value from company_secrets where company_id = $1 and key like 'wa_%'", [companyId])).rows.map((r) => [r.key, r.value]));
}
router.get('/whatsapp/:slug', h(async (req, res) => {
  const c = await companyBySlug(req.params.slug);
  const s = await secrets(c.id);
  if (req.query['hub.mode'] === 'subscribe' && s.wa_verify_token && safeEqual(String(req.query['hub.verify_token'] || ''), s.wa_verify_token)) {
    return res.type('text/plain').send(String(req.query['hub.challenge'] || '').slice(0, 200));
  }
  res.status(403).json({ error: 'Verificação recusada' });
}));
router.post('/whatsapp/:slug', h(async (req, res) => {
  const c = await companyBySlug(req.params.slug);
  const s = await secrets(c.id);
  if (!s.wa_app_secret) return res.status(403).json({ error: 'Integração não configurada' });
  const expected = `sha256=${crypto.createHmac('sha256', s.wa_app_secret).update(req.rawBody || '').digest('hex')}`;
  if (!safeEqual(String(req.headers['x-hub-signature-256'] || ''), expected)) return res.status(401).json({ error: 'Assinatura inválida' });
  const company = (await q('select id, name, slug, timezone, settings from companies where id = $1', [c.id])).rows[0];
  for (const entry of req.body?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      const names = Object.fromEntries((v.contacts || []).map((k) => [k.wa_id, k.profile?.name]));
      for (const m of v.messages || []) {
        const body = m.type === 'text' ? m.text?.body : m.type === 'button' ? m.button?.text : m.type === 'interactive' ? (m.interactive?.button_reply?.title || m.interactive?.list_reply?.title) : null;
        if (!body || !m.from) continue;
        await handleIncoming(company, { channel: 'whatsapp', contact: String(m.from).slice(0, 20), contactName: names[m.from] || null, body, externalId: m.id });
      }
    }
  }
  res.json({ ok: true });
}));

// ---- InfinitePay: webhook do pagamento e retorno do cliente (o token na URL identifica a cobrança) ----
// O aviso só vale depois de conferido na própria InfinitePay (payment_check). Erro de conferência → 400, e a InfinitePay reenvia.
async function chargeByToken(token) {
  if (!/^[0-9a-f]{36}$/.test(String(token))) return null;
  return (await q('select * from infinitepay_charges where token = $1', [token])).rows[0] || null;
}
router.post('/infinitepay/webhook/:token', h(async (req, res) => {
  const c = await chargeByToken(req.params.token);
  if (!c) return res.status(404).json({ ok: false });
  const b = req.body || {};
  await logEvent({ query: q }, c, 'webhook', b);
  if (b.order_nsu && String(b.order_nsu) !== c.order_nsu) return res.status(400).json({ ok: false, error: 'pedido não confere' });
  try {
    await confirmCharge(tx, c.id, { transaction_nsu: b.transaction_nsu, invoice_slug: b.invoice_slug, capture_method: b.capture_method, receipt_url: b.receipt_url }, 'webhook');
    res.json({ ok: true });
  } catch { res.status(400).json({ ok: false }); }
}));
router.post('/infinitepay/return', h(async (req, res) => {
  await rateLimit(`ip-return:${req.ip}`, 60, 600);
  const b = req.body || {};
  const c = await chargeByToken(b.c);
  if (!c) return res.status(404).json({ error: 'Pagamento não encontrado' });
  await logEvent({ query: q }, c, 'retorno', { ...b, c: undefined });
  let r = c;
  try { r = await confirmCharge(tx, c.id, { transaction_nsu: b.transaction_nsu, invoice_slug: b.slug, capture_method: b.capture_method, receipt_url: b.receipt_url }, 'retorno'); } catch { /* o webhook confirma depois */ }
  const co = (await q('select name from companies where id = $1', [c.company_id])).rows[0];
  res.json({ status: r.status === 'divergente' ? 'pago' : r.status, amount_cents: Number(c.amount_cents), description: c.description, company: co?.name, receipt_url: r.receipt_url || b.receipt_url || null });
}));
