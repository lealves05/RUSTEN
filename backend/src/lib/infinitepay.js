// Integração com a InfinitePay — Checkout Integrado (https://www.infinitepay.io/checkout-documentacao).
// O RUSTEN cria um link de pagamento (Pix ou cartão) com o valor da comanda; a InfinitePay avisa pelo webhook quando é pago
// e o cliente volta pelo redirecionamento. Nenhum aviso é aceito sem conferir na própria InfinitePay (payment_check),
// porque o webhook não é assinado. O pagamento entra na comanda como "integração" (não digitado pelo operador).
import crypto from 'node:crypto';
import { HttpError, businessDate } from './core.js';
import { audit } from './auth.js';
import { sessionTotals } from './pdv.js';
import { env } from './env.js';

const API = () => (env.INFINITEPAY_API_URL || 'https://api.checkout.infinitepay.io').replace(/\/+$/, '');
export const ipConfig = (settings) => ({ enabled: false, handle: '', ...(settings?.infinitepay || {}) });
export const normalizeHandle = (h) => String(h || '').trim().replace(/^\$/, '').toLowerCase();
export const METHOD_FROM_CAPTURE = (m) => (m === 'pix' ? 'pix' : 'credito');

async function call(path, body, timeoutMs = 12000) {
  let res;
  try {
    res = await fetch(`${API()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new HttpError(503, 'A InfinitePay não respondeu. Tente de novo em instantes ou receba de outra forma.', 'infinitepay_unavailable');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.errors?.[0]?.message || `erro ${res.status}`;
    throw new HttpError(502, `InfinitePay recusou: ${String(msg).slice(0, 160)}`, 'infinitepay_error', { status: res.status });
  }
  return data;
}

/** Cria o link de pagamento. Devolve { url, raw }. */
export async function createLink({ handle, amount, description, orderNsu, webhookUrl, redirectUrl, customer }) {
  const body = { handle, items: [{ quantity: 1, price: amount, description: description.slice(0, 120) }], order_nsu: orderNsu };
  if (webhookUrl) body.webhook_url = webhookUrl;
  if (redirectUrl) body.redirect_url = redirectUrl;
  if (customer && (customer.name || customer.email || customer.phone_number)) body.customer = customer;
  const raw = await call('/links', body);
  const url = raw?.url || raw?.link || raw?.checkout_url || raw?.data?.url || (typeof raw?.raw === 'string' && /^https?:\/\//.test(raw.raw) ? raw.raw : null);
  if (!url) throw new HttpError(502, 'A InfinitePay não devolveu o link de pagamento.', 'infinitepay_error');
  return { url, raw };
}

/** Confere na InfinitePay se a cobrança foi paga (exige transaction_nsu e slug, que chegam no webhook ou no retorno). */
export async function paymentCheck({ handle, orderNsu, transactionNsu, slug }) {
  return call('/payment_check', { handle, order_nsu: orderNsu, transaction_nsu: transactionNsu, slug }, 8000);
}

export const newOrderNsu = (companyId) => `RST${companyId}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`.toUpperCase();

export async function logEvent(db, charge, kind, payload, ok = true) {
  await db.query('insert into infinitepay_events (company_id, charge_id, kind, ok, payload) values ($1,$2,$3,$4,$5)',
    [charge.company_id, charge.id, kind, ok, JSON.stringify(payload ?? {})]).catch(() => {});
}

/**
 * Confirma a cobrança (idempotente): confere na InfinitePay e lança o pagamento na comanda.
 * `info` = { transaction_nsu, invoice_slug, capture_method, receipt_url }. Devolve a cobrança atualizada.
 * Lança erro (para o webhook responder 400 e a InfinitePay repetir) só quando a conferência não pôde ser feita.
 */
export async function confirmCharge(tx, chargeId, info, source, checkFn = paymentCheck) {
  return tx(async (db) => {
    const c = (await db.query('select * from infinitepay_charges where id = $1 for update', [chargeId])).rows[0];
    if (!c) throw new HttpError(404, 'Cobrança não encontrada');
    if (c.status === 'pago' || c.status === 'divergente') return c;
    const co = (await db.query('select settings, timezone from companies where id = $1', [c.company_id])).rows[0];
    const cfg = ipConfig(co.settings);
    const tnsu = String(info.transaction_nsu || c.transaction_nsu || '').slice(0, 120);
    const slug = String(info.invoice_slug || info.slug || c.invoice_slug || '').slice(0, 120);
    if (!tnsu || !slug) { await logEvent(db, c, source, { motivo: 'sem transaction_nsu/slug', info }, false); return c; }
    let chk;
    try { chk = await checkFn({ handle: cfg.handle, orderNsu: c.order_nsu, transactionNsu: tnsu, slug }); }
    catch (e) { await logEvent(db, c, 'consulta', { erro: e.message }, false); throw e; }
    await logEvent(db, c, 'consulta', chk, !!chk?.paid);
    await db.query('update infinitepay_charges set transaction_nsu = $2, invoice_slug = $3 where id = $1', [c.id, tnsu, slug]);
    if (!chk?.success || !chk?.paid) return { ...c, transaction_nsu: tnsu, invoice_slug: slug };
    const amount = Number(chk.amount ?? c.amount_cents);
    const method = METHOD_FROM_CAPTURE(chk.capture_method || info.capture_method);
    const base = { capture_method: chk.capture_method || info.capture_method || null, installments: chk.installments ?? null,
      paid_amount_cents: chk.paid_amount ?? null, receipt_url: String(info.receipt_url || c.receipt_url || '').slice(0, 500) || null };
    const ctx = { companyId: c.company_id, userId: c.created_by };
    // valor conferido diferente do cobrado: não lança, fica para conferência
    if (amount !== Number(c.amount_cents)) {
      const r = (await db.query(`update infinitepay_charges set status = 'divergente', capture_method = $2, installments = $3, paid_amount_cents = $4, receipt_url = $5,
          paid_at = now(), confirmed_by = $6, note = $7 where id = $1 returning *`,
      [c.id, base.capture_method, base.installments, base.paid_amount_cents, base.receipt_url, source, `Valor pago (${amount}) diferente do cobrado (${c.amount_cents})`])).rows[0];
      await audit(db, ctx, 'infinitepay.divergente', { entity: 'infinitepay', entityId: c.id, data: { cobrado: Number(c.amount_cents), pago: amount } });
      return r;
    }
    let paymentId = null; let note = null;
    const s = c.session_id ? (await db.query('select * from consumption_sessions where id = $1 for update', [c.session_id])).rows[0] : null;
    if (s && ['aberta', 'em_fechamento'].includes(s.status)) {
      const t = await sessionTotals(db, s.id);
      if (amount <= t.balance) {
        const u = (await db.query('select day_cutoff from units where id = $1', [s.unit_id])).rows[0];
        const p = (await db.query(`insert into payments (company_id, session_id, cash_session_id, method, amount_cents, source, business_date, idempotency_key, user_id)
            values ($1,$2,$3,$4,$5,'integracao',$6,$7,$8) on conflict (company_id, idempotency_key) do update set idempotency_key = excluded.idempotency_key returning id`,
        [c.company_id, s.id, c.cash_session_id, method, amount, businessDate(new Date(), co.timezone, u?.day_cutoff ?? 5), `ip-${c.order_nsu}`.slice(0, 80), c.created_by])).rows[0];
        paymentId = p.id;
        await db.query('update consumption_sessions set version = version + 1 where id = $1', [s.id]);
      } else note = 'Pago, mas o saldo da comanda já era menor: confira e devolva a diferença pelo app da InfinitePay.';
    } else if (c.session_id) note = 'Pago depois que a comanda foi encerrada ou cancelada: confira.';
    const status = paymentId || !c.session_id ? 'pago' : 'divergente';
    const r = (await db.query(`update infinitepay_charges set status = $2, capture_method = $3, installments = $4, paid_amount_cents = $5, receipt_url = $6,
        payment_id = $7, paid_at = now(), confirmed_by = $8, note = $9 where id = $1 returning *`,
    [c.id, status, base.capture_method, base.installments, base.paid_amount_cents, base.receipt_url, paymentId, source, note])).rows[0];
    await audit(db, ctx, status === 'pago' ? 'infinitepay.pago' : 'infinitepay.divergente', { entity: 'infinitepay', entityId: c.id,
      data: { comanda: c.session_id, valor_cents: amount, forma: base.capture_method, parcelas: base.installments, pagamento: paymentId, origem: source } });
    return r;
  });
}
