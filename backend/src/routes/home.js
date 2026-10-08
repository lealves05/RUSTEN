// Painel inicial e busca global.
import { Router } from 'express';
import { q, h, businessDate } from '../lib/core.js';

export const router = Router();

router.get('/dashboard', h(async (req, res) => {
  const c = req.ctx;
  const unit = (await q('select id, day_cutoff from units where company_id = $1 and ($2::bigint is null or id = $2) order by id limit 1',
    [c.companyId, c.terminalUnitId || c.unitId || null])).rows[0];
  const day = businessDate(new Date(), c.company.timezone, unit?.day_cutoff ?? 5);
  const money = c.can('financeiro.visualizar');
  const r = (await q(
    `select
       (select coalesce(sum(i.total_cents),0)::bigint from order_items i join consumption_sessions s on s.id = i.session_id
         where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' and s.status <> 'cancelada') as consumed_cents,
       -- recebido de fato: fiado não é dinheiro e o uso de crédito já entrou quando o crédito foi lançado
       ((select coalesce(sum(amount_cents),0)::bigint from payments where company_id = $1 and business_date = $2 and status = 'confirmado' and method not in ('fiado','saldo_cliente'))
        + (select coalesce(sum(a.amount_cents),0)::bigint from customer_account a join cash_sessions cs on cs.id = a.cash_session_id
            where a.company_id = $1 and cs.business_date = $2 and a.method is not null)) as received_cents,
       (select coalesce(sum(amount_cents),0)::bigint from payments where company_id = $1 and business_date = $2 and status = 'confirmado' and method = 'fiado') as fiado_cents,
       (select count(*)::int from consumption_sessions where company_id = $1 and status in ('aberta','em_fechamento')) as open_sessions,
       (select count(*)::int from dining_tables where company_id = $1 and active and status in ('ocupada','conta')) as busy_tables,
       (select count(*)::int from dining_tables where company_id = $1 and active) as total_tables,
       (select count(*)::int from order_items where company_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','preparando')) as preparing,
       (select count(*)::int from cash_sessions where company_id = $1 and business_date = $2 and status = 'fechado' and difference_cents <> 0) as cash_differences,
       (select count(*)::int from cash_sessions where company_id = $1 and status = 'aberto') as open_cash,
       (select count(*)::int from products where company_id = $1 and demo) as demo_products`, [c.companyId, day])).rows[0];
  const byHour = money ? (await q(
    `select extract(hour from p.created_at at time zone $3)::int as hour, sum(p.amount_cents)::bigint as cents
       from payments p where p.company_id = $1 and p.business_date = $2 and p.status = 'confirmado' and p.method not in ('fiado','saldo_cliente') group by 1 order by 1`,
    [c.companyId, day, c.company.timezone])).rows : null;
  const top = (await q(
    `select i.description, sum(i.qty)::numeric as qty ${money ? ', sum(i.total_cents)::bigint as cents' : ''}
       from order_items i join consumption_sessions s on s.id = i.session_id
      where s.company_id = $1 and s.business_date = $2 and i.status = 'ativo' group by 1 order by 2 desc limit 5`, [c.companyId, day])).rows;
  if (!money) { delete r.consumed_cents; delete r.received_cents; delete r.fiado_cents; delete r.cash_differences; }
  res.json({ business_date: day, ...r, by_hour: byHour, top, access: c.access,
    pending_modules: [] });
}));

router.get('/search', h(async (req, res) => {
  const term = String(req.query.q || '').trim().slice(0, 60);
  if (term.length < 2) return res.json([]);
  const c = req.ctx;
  const like = `%${term}%`;
  const out = [];
  if (c.can('cardapio.visualizar')) {
    const p = await q(`select id, name from products where company_id = $1 and (name ilike $2 or sku = $3) order by name limit 6`, [c.companyId, like, term]);
    out.push(...p.rows.map((r) => ({ type: 'produto', id: r.id, label: r.name, to: `/cardapio?produto=${r.id}` })));
  }
  if (c.can('pdv.lancar')) {
    const n = Number(term.replace(/\D/g, ''));
    if (n) {
      const s = await q(`select s.id, c.number card, t.number tbl, s.status from consumption_sessions s left join tab_cards c on c.id = s.card_id
                          left join dining_tables t on t.id = s.table_id
                          where s.company_id = $1 and (c.number = $2 or t.number = $2 or s.id = $2) and s.status in ('aberta','em_fechamento') limit 6`, [c.companyId, n]);
      out.push(...s.rows.map((r) => ({ type: 'consumo', id: r.id, label: r.card ? `Comanda ${r.card}` : r.tbl ? `Mesa ${r.tbl}` : `Consumo ${r.id}`, to: `/pdv?sessao=${r.id}` })));
    }
    const sc = await q(`select s.id, s.customer_name, s.label from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')
                         and (s.customer_name ilike $2 or s.label ilike $2) limit 5`, [c.companyId, like]);
    out.push(...sc.rows.map((r) => ({ type: 'consumo', id: r.id, label: r.customer_name || r.label, to: `/pdv?sessao=${r.id}` })));
  }
  if (c.can('usuarios.gerenciar')) {
    const u = await q('select id, name from users where company_id = $1 and name ilike $2 limit 4', [c.companyId, like]);
    out.push(...u.rows.map((r) => ({ type: 'usuario', id: r.id, label: r.name, to: '/configuracoes/usuarios' })));
  }
  res.json(out);
}));
