// Conta do cliente (crédito antecipado e fiado), sempre vinculada a um cliente com CPF.
// Saldo = soma dos lançamentos: positivo = crédito do cliente; negativo = fiado em aberto. Lançamentos nunca mudam.
import { bad, conflict, forbidden } from './core.js';

export const ACCOUNT_KINDS = { credito: 'Crédito lançado', uso_credito: 'Uso de crédito', fiado: 'Fiado', pagamento_fiado: 'Pagamento de fiado', estorno: 'Estorno', ajuste: 'Ajuste' };

export async function accountSummary(db, companyId, customerId) {
  const r = (await db.query(`select coalesce(sum(amount_cents),0)::bigint as balance,
      min(created_at) filter (where kind = 'fiado') as first_fiado, max(created_at) as last_entry
    from customer_account where company_id = $1 and customer_id = $2`, [companyId, customerId])).rows[0];
  const balance = Number(r.balance);
  // data do fiado mais antigo ainda em aberto (FIFO: pagamentos quitam os fiados mais velhos primeiro)
  let openSince = null;
  if (balance < 0) {
    const rows = (await db.query(`select amount_cents, created_at, kind from customer_account where company_id = $1 and customer_id = $2 order by id`, [companyId, customerId])).rows;
    let credit = rows.filter((x) => Number(x.amount_cents) > 0).reduce((s, x) => s + Number(x.amount_cents), 0);
    for (const x of rows) {
      if (Number(x.amount_cents) >= 0) continue;
      credit += Number(x.amount_cents);
      if (credit < 0) { openSince = x.created_at; break; }
    }
  }
  return { balance_cents: balance, credit_cents: Math.max(0, balance), debt_cents: Math.max(0, -balance), open_since: openSince, last_entry: r.last_entry };
}

/* Pagamento de consumo por "fiado" ou "saldo_cliente": exige cliente identificado com CPF; fiado respeita o limite. */
export async function chargeAccount(db, ctx, s, method, amount, paymentId) {
  if (!s.customer_id) throw conflict('Identifique o cliente pelo CPF na comanda para usar fiado ou crédito', 'customer_required');
  const c = (await db.query('select id, name, cpf, fiado_limit_cents, anonymized_at from customers where id = $1 and company_id = $2 for update', [s.customer_id, ctx.companyId])).rows[0];
  if (!c || c.anonymized_at) throw conflict('Cliente indisponível', 'customer_required');
  if (!c.cpf) throw conflict('Cadastre o CPF do cliente para lançar fiado ou usar crédito', 'cpf_required');
  const acc = await accountSummary(db, ctx.companyId, c.id);
  let overLimit = false;
  if (method === 'saldo_cliente') {
    if (amount > acc.credit_cents) throw conflict(`Crédito disponível: R$ ${(acc.credit_cents / 100).toFixed(2).replace('.', ',')}`, 'insufficient_credit');
  } else {
    const after = acc.balance_cents - amount;
    const limit = Number(c.fiado_limit_cents);
    if (-after > limit) {
      if (!ctx.can('pdv.autorizar')) {
        throw forbidden(`Fiado acima do limite do cliente (R$ ${(limit / 100).toFixed(2).replace('.', ',')}). Peça a um gerente ou receba de outra forma.`, 'fiado_limit');
      }
      overLimit = true;
    }
  }
  const kind = method === 'fiado' ? 'fiado' : 'uso_credito';
  const e = (await db.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, session_id, payment_id, over_limit, reason, user_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
  [ctx.companyId, c.id, kind, -amount, s.id, paymentId, overLimit, kind === 'fiado' ? `Consumo #${s.id}` : `Uso de crédito no consumo #${s.id}`, ctx.userId])).rows[0];
  return { entry_id: e.id, over_limit: overLimit, customer_id: c.id, balance_after: acc.balance_cents - amount };
}

// Estorno do pagamento da comanda devolve o lançamento na conta
export async function reverseAccountByPayment(db, ctx, paymentId, reason) {
  const e = (await db.query(`select * from customer_account a where company_id = $1 and payment_id = $2 and reverses_id is null
    and not exists (select 1 from customer_account x where x.reverses_id = a.id)`, [ctx.companyId, paymentId])).rows[0];
  if (!e) return null;
  await db.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, session_id, reverses_id, reason, user_id)
     values ($1,$2,'estorno',$3,$4,$5,$6,$7)`, [ctx.companyId, e.customer_id, -Number(e.amount_cents), e.session_id, e.id, reason || 'Estorno do pagamento', ctx.userId]);
  return e.id;
}

export const assertMoney = (method) => { if (!['dinheiro', 'pix', 'debito', 'credito'].includes(method)) throw bad('Forma de pagamento inválida'); };
