// Conta do cliente: lançar crédito, receber fiado, ajustes gerenciais, estornos, limite de fiado e lista de contas em aberto.
// Dinheiro que entra (crédito e pagamento de fiado) vai para o caixa aberto do terminal, na forma escolhida.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict } from '../lib/core.js';
import { need, audit } from '../lib/auth.js';
import { accountSummary, ACCOUNT_KINDS } from '../lib/account.js';
import { presentCustomer } from '../lib/customers.js';

export const router = Router();
const money = z.number().int().positive().max(100000000);
const key = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const brl = (c) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

async function openCash(db, ctx) {
  const params = [ctx.companyId]; let where = "company_id = $1 and status = 'aberto'";
  if (ctx.terminalId) { params.push(ctx.terminalId); where += ` and terminal_id = $${params.length}`; }
  else { params.push(ctx.userId); where += ` and user_id = $${params.length} and terminal_id is null`; }
  return (await db.query(`select id from cash_sessions where ${where} order by id desc limit 1 for update`, params)).rows[0];
}

async function lockCustomer(db, ctx, id) {
  const c = (await db.query('select * from customers where id = $1 and company_id = $2 for update', [id, ctx.companyId])).rows[0];
  if (!c) throw notFound('Cliente não encontrado');
  if (c.anonymized_at) throw conflict('Cliente anonimizado');
  return c;
}

// Contas com saldo (fiado em aberto ou crédito disponível)
router.get('/open', need('clientes.visualizar'), h(async (req, res) => {
  const rows = (await q(`select c.id, c.name, c.cpf, c.phone, c.fiado_limit_cents, a.balance, a.last_entry,
       (select min(x.created_at) from customer_account x where x.company_id = c.company_id and x.customer_id = c.id and x.kind = 'fiado') as first_fiado
     from customers c join (select customer_id, sum(amount_cents)::bigint as balance, max(created_at) as last_entry from customer_account where company_id = $1 group by customer_id) a
       on a.customer_id = c.id
     where c.company_id = $1 and a.balance <> 0 order by a.balance`, [req.ctx.companyId])).rows;
  const items = rows.map((r) => ({ ...presentCustomer(r, req.ctx), balance_cents: Number(r.balance), fiado_limit_cents: Number(r.fiado_limit_cents), last_entry: r.last_entry, first_fiado: r.first_fiado }));
  res.json({ items, debt_cents: items.filter((x) => x.balance_cents < 0).reduce((s, x) => s - x.balance_cents, 0),
    credit_cents: items.filter((x) => x.balance_cents > 0).reduce((s, x) => s + x.balance_cents, 0) });
}));

router.get('/customers/:id', need('clientes.visualizar'), h(async (req, res) => {
  const id = Number(req.params.id);
  const c = (await q('select * from customers where id = $1 and company_id = $2', [id, req.ctx.companyId])).rows[0];
  if (!c) throw notFound('Cliente não encontrado');
  const entries = (await q(`select a.id, a.kind, a.amount_cents, a.method, a.session_id, a.payment_id, a.reverses_id, a.over_limit, a.reason, a.created_at, u.name as user_name,
       exists(select 1 from customer_account x where x.reverses_id = a.id) as reversed
     from customer_account a left join users u on u.id = a.user_id where a.company_id = $1 and a.customer_id = $2 order by a.id desc limit 200`, [req.ctx.companyId, id])).rows;
  res.json({ customer: presentCustomer(c, req.ctx), has_cpf: !!c.cpf, fiado_limit_cents: Number(c.fiado_limit_cents),
    ...(await accountSummary({ query: q }, req.ctx.companyId, id)),
    entries: entries.map((e) => ({ ...e, amount_cents: Number(e.amount_cents), label: ACCOUNT_KINDS[e.kind] })) });
}));

// Dinheiro entrando: crédito antecipado ou pagamento de fiado
async function moneyIn(req, res, kind) {
  const b = parse(z.object({ amount_cents: money, method: z.enum(['dinheiro', 'pix', 'debito', 'credito']), reason: z.string().trim().max(200).optional(), idempotency_key: key }), req.body);
  const id = Number(req.params.id);
  const prev = (await q('select id from customer_account where company_id = $1 and idempotency_key = $2', [req.ctx.companyId, b.idempotency_key])).rows[0];
  if (prev) return res.json({ id: prev.id, replay: true, ...(await accountSummary({ query: q }, req.ctx.companyId, id)) });
  const out = await tx(async (db) => {
    const c = await lockCustomer(db, req.ctx, id);
    if (!c.cpf) throw conflict('Cadastre o CPF do cliente antes de lançar na conta', 'cpf_required');
    const cash = await openCash(db, req.ctx);
    if (!cash) throw conflict('Abra o caixa antes de receber', 'cash_closed');
    const acc = await accountSummary(db, req.ctx.companyId, id);
    if (kind === 'pagamento_fiado') {
      if (!acc.debt_cents) throw conflict('Este cliente não tem fiado em aberto', 'no_debt');
      if (b.amount_cents > acc.debt_cents) throw bad(`Valor maior que o fiado em aberto (${brl(acc.debt_cents)}). Para deixar crédito, use "Lançar crédito".`, 'over_debt');
    }
    const e = (await db.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, method, cash_session_id, reason, idempotency_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [req.ctx.companyId, id, kind, b.amount_cents, b.method, cash.id, b.reason || null, b.idempotency_key, req.ctx.userId])).rows[0];
    await audit(db, req.ctx, kind === 'credito' ? 'cliente.credito_lancado' : 'cliente.fiado_recebido', { entity: 'customer', entityId: id, reason: b.reason,
      data: { lancamento: e.id, valor_cents: b.amount_cents, forma: b.method, caixa: cash.id, saldo_antes: acc.balance_cents, saldo_depois: acc.balance_cents + b.amount_cents } });
    return { id: e.id, ...(await accountSummary(db, req.ctx.companyId, id)) };
  });
  res.status(201).json(out);
}
router.post('/customers/:id/credit', need('pdv.receber', 'clientes.visualizar'), h((req, res) => moneyIn(req, res, 'credito')));
router.post('/customers/:id/settle', need('pdv.receber', 'clientes.visualizar'), h((req, res) => moneyIn(req, res, 'pagamento_fiado')));

// Ajuste gerencial (perdão de dívida, correção de lançamento antigo): não mexe no caixa
router.post('/customers/:id/adjust', need('clientes.gerenciar', 'pdv.autorizar'), h(async (req, res) => {
  const b = parse(z.object({ amount_cents: z.number().int().refine((n) => n !== 0 && Math.abs(n) <= 100000000), reason: z.string().trim().min(10, 'Explique o ajuste (mín. 10 caracteres)').max(300) }), req.body);
  const id = Number(req.params.id);
  const out = await tx(async (db) => {
    await lockCustomer(db, req.ctx, id);
    const acc = await accountSummary(db, req.ctx.companyId, id);
    const e = (await db.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, reason, user_id) values ($1,$2,'ajuste',$3,$4,$5) returning id`,
      [req.ctx.companyId, id, b.amount_cents, b.reason, req.ctx.userId])).rows[0];
    await audit(db, req.ctx, 'cliente.conta_ajustada', { entity: 'customer', entityId: id, reason: b.reason, data: { lancamento: e.id, valor_cents: b.amount_cents, saldo_antes: acc.balance_cents, saldo_depois: acc.balance_cents + b.amount_cents } });
    return { id: e.id, ...(await accountSummary(db, req.ctx.companyId, id)) };
  });
  res.status(201).json(out);
}));

// Estorno de crédito, pagamento de fiado ou ajuste (o de consumo é estornado pelo pagamento da comanda)
router.post('/entries/:id/reverse', need('financeiro.estornar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(5).max(200) }), req.body);
  const out = await tx(async (db) => {
    const e = (await db.query('select * from customer_account where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!e) throw notFound('Lançamento não encontrado');
    if (!['credito', 'pagamento_fiado', 'ajuste'].includes(e.kind)) throw conflict('Este lançamento é estornado pelo pagamento da comanda (Receber › estornar)');
    await lockCustomer(db, req.ctx, e.customer_id);
    if (e.cash_session_id) {
      const cs = (await db.query('select status from cash_sessions where id = $1', [e.cash_session_id])).rows[0];
      if (cs?.status !== 'aberto') throw conflict('O caixa deste recebimento já foi fechado: registre um ajuste na conta com o motivo', 'cash_closed');
    }
    const acc = await accountSummary(db, req.ctx.companyId, e.customer_id);
    if (e.kind === 'credito' && acc.balance_cents - Number(e.amount_cents) < 0 && acc.balance_cents >= 0)
      throw conflict('Parte deste crédito já foi usada: estorne o uso antes ou registre um ajuste', 'credit_used');
    await db.query(`insert into customer_account (company_id, customer_id, kind, amount_cents, method, cash_session_id, reverses_id, reason, user_id)
       values ($1,$2,'estorno',$3,$4,$5,$6,$7,$8)`, [req.ctx.companyId, e.customer_id, -Number(e.amount_cents), e.method, e.cash_session_id, e.id, b.reason, req.ctx.userId])
      .catch((x) => { if (x.code === '23505') throw conflict('Lançamento já estornado'); throw x; });
    await audit(db, req.ctx, 'cliente.conta_estorno', { entity: 'customer', entityId: e.customer_id, reason: b.reason, data: { lancamento: e.id, valor_cents: -Number(e.amount_cents) } });
    return accountSummary(db, req.ctx.companyId, e.customer_id);
  });
  res.json(out);
}));

router.put('/customers/:id/limit', need('clientes.gerenciar', 'pdv.autorizar'), h(async (req, res) => {
  const b = parse(z.object({ fiado_limit_cents: z.number().int().min(0).max(100000000) }), req.body);
  const r = await q('update customers set fiado_limit_cents = $3, updated_at = now() where id = $1 and company_id = $2 returning id', [Number(req.params.id), req.ctx.companyId, b.fiado_limit_cents]);
  if (!r.rows[0]) throw notFound('Cliente não encontrado');
  await audit({ query: q }, req.ctx, 'cliente.limite_fiado', { entity: 'customer', entityId: r.rows[0].id, data: b });
  res.json({ ok: true });
}));
