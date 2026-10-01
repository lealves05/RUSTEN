// Clientes: CPF, máscara de dados pessoais e fidelidade (extrato imutável com validade, resgate e reversão).
import { bad, conflict } from './core.js';

export const onlyDigits = (s) => String(s ?? '').replace(/\D/g, '');

export function validCpf(raw) {
  const c = onlyDigits(raw);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function normalizeCpf(raw, { required = false } = {}) {
  const c = onlyDigits(raw);
  if (!c) { if (required) throw bad('Informe o CPF'); return null; }
  if (!validCpf(c)) throw bad('CPF inválido', 'invalid_cpf');
  return c;
}

export const fmtCpf = (c) => (c ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : null);
const maskCpf = (c) => (c ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : null);
const maskPhone = (p) => (p ? p.replace(/\d(?=\d{4})/g, '*') : null);
const maskEmail = (e) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : null);

// Quem não tem "dados.pessoais" vê o cadastro mascarado (nome permanece, para atendimento)
export function presentCustomer(c, ctx) {
  if (!c) return c;
  const full = ctx.can('dados.pessoais');
  return {
    id: c.id, name: c.name, cpf: full ? fmtCpf(c.cpf) : maskCpf(c.cpf), phone: full ? c.phone : maskPhone(c.phone),
    email: full ? c.email : maskEmail(c.email), birthday: full ? c.birthday : null, address: full ? c.address : {},
    tags: c.tags, preferences: c.preferences, notes: c.notes, consent_whatsapp: c.consent_whatsapp, consent_email: c.consent_email,
    unsubscribed: !!c.unsubscribed_at, points: c.points, anonymized: !!c.anonymized_at, created_at: c.created_at, masked: !full,
    ...(c.visits != null ? { visits: c.visits, spent_cents: c.spent_cents, last_visit: c.last_visit } : {}),
  };
}

export const loyaltyConfig = (settings) => ({
  enabled: false, cents_per_point: 100, point_value_cents: 5, validity_days: 365, min_redeem: 100,
  ...(settings?.loyalty || {}),
});

async function addLedger(db, companyId, customerId, entry) {
  const r = await db.query(
    `insert into loyalty_ledger (company_id, customer_id, session_id, kind, points, expires_at, reason, reverses_id, payment_id, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [companyId, customerId, entry.session_id ?? null, entry.kind, entry.points, entry.expires_at ?? null, entry.reason ?? null,
      entry.reverses_id ?? null, entry.payment_id ?? null, entry.user_id ?? null]);
  await db.query('update customers set points = points + $3, updated_at = now() where id = $1 and company_id = $2', [customerId, companyId, entry.points]);
  return r.rows[0];
}

/* Validade: pontos ganhos vencidos que não foram consumidos (resgates e expirações consomem os mais antigos primeiro). */
export async function expirePoints(db, companyId, customerId) {
  const r = await db.query(
    `select
       coalesce(sum(l.points) filter (where (l.kind = 'ganho' or o.kind = 'ganho') and coalesce(l.expires_at, o.expires_at) < current_date), 0)::int as vencidos,
       coalesce(-sum(l.points) filter (where l.kind in ('resgate','expiracao') or (l.kind = 'ajuste' and l.points < 0) or o.kind = 'resgate'), 0)::int as usados
     from loyalty_ledger l left join loyalty_ledger o on o.id = l.reverses_id
     where l.company_id = $1 and l.customer_id = $2`, [companyId, customerId]);
  const { vencidos, usados } = r.rows[0];
  const expire = vencidos - usados;
  if (expire > 0) await addLedger(db, companyId, customerId, { kind: 'expiracao', points: -expire, reason: 'Pontos vencidos' });
}

// Ganho no encerramento do consumo: uma vez por consumo (índice único garante)
export async function earnPoints(db, ctx, session, itemsCents) {
  if (!session.customer_id) return null;
  const c = (await db.query('select settings from companies where id = $1', [ctx.companyId])).rows[0];
  const cfg = loyaltyConfig(c.settings);
  if (!cfg.enabled) return null;
  const pts = Math.floor(itemsCents / Math.max(1, cfg.cents_per_point));
  if (pts <= 0) return null;
  const prior = await db.query(`select 1 from loyalty_ledger where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = loyalty_ledger.id)`, [ctx.companyId, session.id]);
  if (prior.rows[0]) return null;
  const expires = new Date(Date.now() + cfg.validity_days * 86400000).toISOString().slice(0, 10);
  return addLedger(db, ctx.companyId, session.customer_id, { session_id: session.id, kind: 'ganho', points: pts, expires_at: expires,
    reason: `Consumo ${session.id}`, user_id: ctx.userId });
}

// Reabertura/cancelamento: reverte o ganho daquele consumo
export async function reverseEarn(db, ctx, sessionId, reason) {
  const g = (await db.query(`select * from loyalty_ledger l where company_id = $1 and session_id = $2 and kind = 'ganho'
    and not exists (select 1 from loyalty_ledger r where r.reverses_id = l.id)`, [ctx.companyId, sessionId])).rows[0];
  if (!g) return null;
  return addLedger(db, ctx.companyId, g.customer_id, { session_id: sessionId, kind: 'estorno', points: -g.points, reverses_id: g.id,
    reason, user_id: ctx.userId });
}

export async function redeemPoints(db, ctx, customerId, points, paymentId, sessionId) {
  const c = (await db.query('select points from customers where id = $1 and company_id = $2 for update', [customerId, ctx.companyId])).rows[0];
  if (!c) throw bad('Cliente não encontrado');
  if (c.points < points) throw conflict(`Saldo insuficiente: ${c.points} pontos`, 'insufficient_points');
  return addLedger(db, ctx.companyId, customerId, { session_id: sessionId, kind: 'resgate', points: -points, payment_id: paymentId,
    reason: `Resgate no consumo ${sessionId}`, user_id: ctx.userId });
}

// Estorno do pagamento feito com pontos devolve os pontos
export async function reverseRedeemByPayment(db, ctx, paymentId) {
  const r = (await db.query(`select * from loyalty_ledger l where company_id = $1 and payment_id = $2 and kind = 'resgate'
    and not exists (select 1 from loyalty_ledger x where x.reverses_id = l.id)`, [ctx.companyId, paymentId])).rows[0];
  if (!r) return null;
  return addLedger(db, ctx.companyId, r.customer_id, { session_id: r.session_id, kind: 'estorno', points: -r.points, reverses_id: r.id,
    reason: 'Pagamento com pontos estornado', user_id: ctx.userId });
}

export { addLedger };
