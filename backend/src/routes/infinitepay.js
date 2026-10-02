// InfinitePay: configuração (InfiniteTag), cobrança da comanda por link/QR, acompanhamento em tempo real e painel de conferência.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict } from '../lib/core.js';
import { need, audit, rateLimit } from '../lib/auth.js';
import { lockSession, assertUnitScope, sessionTotals } from '../lib/pdv.js';
import { ipConfig, normalizeHandle, createLink, newOrderNsu, logEvent, confirmCharge } from '../lib/infinitepay.js';
import { env } from '../lib/env.js';

export const router = Router();

const httpsUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || (env.NODE_ENV !== 'production' && x.protocol === 'http:') ? x.origin + x.pathname.replace(/\/+$/, '') : null; } catch { return null; } };
// endereço público da API (para o webhook) e do site (para o retorno do cliente)
const apiBase = (req, hint) => httpsUrl(env.PUBLIC_API_URL || '') || httpsUrl(hint || '') || `${req.protocol}://${req.get('host')}`;
const appBase = (req) => httpsUrl(env.APP_URL || '') || httpsUrl(req.get('origin') || '') || 'https://rusten.vercel.app';

router.get('/settings', need('pdv.receber'), h(async (req, res) => {
  const c = (await q('select settings from companies where id = $1', [req.ctx.companyId])).rows[0];
  res.json(ipConfig(c.settings));
}));

router.put('/settings', need('configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ enabled: z.boolean(), handle: z.string().trim().max(60) }), req.body);
  const handle = normalizeHandle(b.handle);
  if (b.enabled && !/^[a-z0-9][a-z0-9_.-]{1,39}$/.test(handle)) throw bad('Informe a InfiniteTag (seu usuário na InfinitePay, sem o $)');
  const value = { enabled: b.enabled, handle };
  await q(`update companies set settings = jsonb_set(settings, '{infinitepay}', $2::jsonb) where id = $1`, [req.ctx.companyId, JSON.stringify(value)]);
  await audit({ query: q }, req.ctx, 'infinitepay.configurada', { data: value });
  res.json(value);
}));

// Cobrar a comanda (ou parte dela) por link de pagamento: Pix ou cartão, no celular do cliente
router.post('/charges', need('pdv.receber'), h(async (req, res) => {
  const b = parse(z.object({ session_id: z.number().int(), amount_cents: z.number().int().positive().max(100000000), api_base: z.string().max(300).optional() }), req.body);
  await rateLimit(`ip-charge:${req.ctx.companyId}`, 120, 3600);
  const prep = await tx(async (db) => {
    const co = (await db.query('select name, settings from companies where id = $1', [req.ctx.companyId])).rows[0];
    const cfg = ipConfig(co.settings);
    if (!cfg.enabled || !cfg.handle) throw conflict('Ative a InfinitePay em Configurações › Integrações', 'infinitepay_off');
    const s = await lockSession(db, req.ctx.companyId, b.session_id);
    assertUnitScope(req.ctx, s.unit_id);
    if (!['aberta', 'em_fechamento'].includes(s.status)) throw conflict('Consumo encerrado', 'session_not_open');
    const t = await sessionTotals(db, s.id);
    if (b.amount_cents > t.balance) throw bad('Valor maior que o saldo da comanda', 'over_balance');
    const open = (await db.query(`select id from infinitepay_charges where session_id = $1 and status = 'pendente' and amount_cents = $2 and created_at > now() - interval '30 minutes' order by id desc limit 1`, [s.id, b.amount_cents])).rows[0];
    if (open) return { reuse: open.id };
    const label = (await db.query(`select coalesce('Comanda ' || c.number, 'Mesa ' || t.number, s.label, 'Consumo #' || s.id) as l from consumption_sessions s
       left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id where s.id = $1`, [s.id])).rows[0].l;
    const cu = s.customer_id ? (await db.query('select name, email, phone from customers where id = $1', [s.customer_id])).rows[0] : null;
    const cash = req.ctx.terminalId
      ? (await db.query("select id from cash_sessions where company_id = $1 and terminal_id = $2 and status = 'aberto' limit 1", [req.ctx.companyId, req.ctx.terminalId])).rows[0]
      : (await db.query("select id from cash_sessions where company_id = $1 and user_id = $2 and terminal_id is null and status = 'aberto' limit 1", [req.ctx.companyId, req.ctx.userId])).rows[0];
    const orderNsu = newOrderNsu(req.ctx.companyId);
    const token = crypto.randomBytes(18).toString('hex');
    const c = (await db.query(`insert into infinitepay_charges (company_id, session_id, cash_session_id, order_nsu, token, amount_cents, description, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [req.ctx.companyId, s.id, cash?.id ?? null, orderNsu, token, b.amount_cents, `${label} — ${co.name}`.slice(0, 120), req.ctx.userId])).rows[0];
    return { c, cfg, customer: cu };
  });
  if (prep.reuse) return res.json(await loadCharge(req, prep.reuse));
  const { c, cfg, customer } = prep;
  const phone = String(customer?.phone || '').replace(/\D/g, '');
  try {
    const link = await createLink({ handle: cfg.handle, amount: Number(c.amount_cents), description: c.description, orderNsu: c.order_nsu,
      webhookUrl: `${apiBase(req, b.api_base)}/api/public/infinitepay/webhook/${c.token}`,
      redirectUrl: `${appBase(req)}/pagamento/concluido?c=${c.token}`,
      customer: customer ? { name: customer.name || undefined, email: customer.email || undefined, phone_number: phone.length >= 10 ? `+55${phone.slice(-11)}` : undefined } : null });
    await q('update infinitepay_charges set link_url = $2 where id = $1', [c.id, link.url]);
    await logEvent({ query: q }, c, 'link_criado', { url: link.url });
    await audit({ query: q }, req.ctx, 'infinitepay.cobranca', { entity: 'infinitepay', entityId: c.id, data: { comanda: c.session_id, valor_cents: Number(c.amount_cents) } });
  } catch (e) {
    await q("update infinitepay_charges set status = 'erro', note = $2 where id = $1", [c.id, String(e.message).slice(0, 300)]);
    await logEvent({ query: q }, c, 'erro', { erro: e.message }, false);
    throw e;
  }
  res.status(201).json(await loadCharge(req, c.id));
}));

async function loadCharge(req, id) {
  const r = (await q(`select c.id, c.session_id, c.order_nsu, c.amount_cents, c.description, c.link_url, c.status, c.capture_method, c.installments,
      c.paid_amount_cents, c.receipt_url, c.payment_id, c.confirmed_by, c.note, c.created_at, c.paid_at, u.name as user_name
    from infinitepay_charges c left join users u on u.id = c.created_by where c.id = $1 and c.company_id = $2`, [id, req.ctx.companyId])).rows[0];
  if (!r) throw notFound('Cobrança não encontrada');
  return { ...r, amount_cents: Number(r.amount_cents), paid_amount_cents: r.paid_amount_cents == null ? null : Number(r.paid_amount_cents) };
}

// Acompanhamento (a tela consulta a cada poucos segundos). Se o retorno já trouxe os códigos, confere na InfinitePay.
router.get('/charges/:id', need('pdv.receber'), h(async (req, res) => {
  const id = Number(req.params.id);
  const c = (await q('select id, status, transaction_nsu, invoice_slug, created_at from infinitepay_charges where id = $1 and company_id = $2', [id, req.ctx.companyId])).rows[0];
  if (!c) throw notFound('Cobrança não encontrada');
  if (c.status === 'pendente' && c.transaction_nsu && c.invoice_slug) await confirmCharge(tx, id, {}, 'consulta').catch(() => {});
  res.json(await loadCharge(req, id));
}));

router.post('/charges/:id/cancel', need('pdv.receber'), h(async (req, res) => {
  const r = await q(`update infinitepay_charges set status = 'cancelado', canceled_at = now() where id = $1 and company_id = $2 and status in ('pendente','erro') returning id`,
    [Number(req.params.id), req.ctx.companyId]);
  if (!r.rows[0]) throw conflict('Esta cobrança não está pendente');
  await audit({ query: q }, req.ctx, 'infinitepay.cancelada', { entity: 'infinitepay', entityId: r.rows[0].id });
  res.json({ ok: true, note: 'O link deixa de aparecer aqui. Se o cliente pagar mesmo assim, o pagamento chega como "para conferir".' });
}));

// Informar os códigos do comprovante (quando o webhook não chegou): confere na InfinitePay e lança
router.post('/charges/:id/confirm', need('pdv.receber'), h(async (req, res) => {
  const b = parse(z.object({ transaction_nsu: z.string().trim().min(6).max(120), invoice_slug: z.string().trim().min(3).max(120) }), req.body);
  const id = Number(req.params.id);
  const c = (await q('select id from infinitepay_charges where id = $1 and company_id = $2', [id, req.ctx.companyId])).rows[0];
  if (!c) throw notFound('Cobrança não encontrada');
  await confirmCharge(tx, id, b, 'consulta');
  res.json(await loadCharge(req, id));
}));

// Painel: cobranças, totais por forma e situação, para conferir com o extrato do app da InfinitePay
router.get('/charges', need('financeiro.visualizar'), h(async (req, res) => {
  const p = [req.ctx.companyId]; let w = 'c.company_id = $1';
  if (req.query.from) { p.push(String(req.query.from)); w += ` and c.created_at >= $${p.length}::date`; }
  if (req.query.to) { p.push(String(req.query.to)); w += ` and c.created_at < $${p.length}::date + 1`; }
  if (req.query.status) { p.push(String(req.query.status)); w += ` and c.status = $${p.length}`; }
  const rows = (await q(`select c.id, c.session_id, c.order_nsu, c.amount_cents::bigint, c.description, c.status, c.capture_method, c.installments, c.paid_amount_cents,
      c.receipt_url, c.transaction_nsu, c.confirmed_by, c.note, c.created_at, c.paid_at, u.name as user_name
    from infinitepay_charges c left join users u on u.id = c.created_by where ${w} order by c.id desc limit 500`, p)).rows
    .map((r) => ({ ...r, amount_cents: Number(r.amount_cents), paid_amount_cents: r.paid_amount_cents == null ? null : Number(r.paid_amount_cents) }));
  const sum = (f) => rows.filter(f).reduce((s, r) => s + r.amount_cents, 0);
  res.json({ items: rows, totals: { pago: sum((r) => r.status === 'pago'), pix: sum((r) => r.status === 'pago' && r.capture_method === 'pix'),
    cartao: sum((r) => r.status === 'pago' && r.capture_method && r.capture_method !== 'pix'), pendente: sum((r) => r.status === 'pendente'),
    divergente: sum((r) => r.status === 'divergente'), count: rows.length } });
}));

router.get('/charges/:id/events', need('financeiro.visualizar'), h(async (req, res) => {
  res.json((await q('select kind, ok, payload, created_at from infinitepay_events where charge_id = $1 and company_id = $2 order by id', [Number(req.params.id), req.ctx.companyId])).rows);
}));
