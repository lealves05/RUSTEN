/* Relatórios gerenciais. Bases (documentadas também na tela):
   - Período pelo DIA COMERCIAL (respeita o horário de corte da unidade).
   - Faturamento = consumo (itens ativos) + taxa de serviço + taxa de entrega dos consumos ENCERRADOS no período.
   - Recebimentos = pagamentos confirmados no período (data comercial do pagamento), por forma.
   - Ticket médio = faturamento ÷ consumos encerrados.
   - CMV = custo dos insumos baixados na venda (custo médio do momento); sem baixa registrada, custo cadastrado/teórico × quantidade.
   - Margem = (consumo − CMV) ÷ consumo.
   Valores financeiros só para "financeiro.visualizar"; CMV/margem só para "relatorios.cmv" — também nas exportações. */
import { Router } from 'express';
import { z } from 'zod';
import { q, h, parse, bad, csvCell } from '../lib/core.js';
import { need, audit } from '../lib/auth.js';

export const router = Router();

const range = (query) => {
  const b = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), unit_id: z.coerce.number().int().optional() }), query);
  if (b.from > b.to) throw bad('Data inicial depois da final');
  if ((new Date(b.to) - new Date(b.from)) / 86400000 > 400) throw bad('Período máximo de 400 dias');
  return b;
};

async function build(ctx, r) {
  const fin = ctx.can('financeiro.visualizar');
  const cmv = ctx.can('relatorios.cmv');
  const tz = ctx.company.timezone;
  const P = [ctx.companyId, r.from, r.to];
  let unitF = '';
  if (r.unit_id) { P.push(r.unit_id); unitF = ` and s.unit_id = $${P.length}`; }
  const S = `s.company_id = $1 and s.business_date between $2 and $3${unitF}`;
  const closed = `${S} and s.status = 'encerrada'`;
  const ITEM = `from order_items i join consumption_sessions s on s.id = i.session_id where ${closed} and i.status = 'ativo'`;

  const sum = (await q(`with x as (
      select s.id, s.service_fee_bp, s.delivery_fee_cents, (select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo') as items
      from consumption_sessions s where ${closed})
    select count(*)::int as sessions, coalesce(sum(items),0)::bigint as items_cents,
      coalesce(sum(round(items * service_fee_bp / 10000.0)),0)::bigint as service_fee_cents, coalesce(sum(delivery_fee_cents),0)::bigint as delivery_fee_cents from x`, P)).rows[0];
  const revenue = Number(sum.items_cents) + Number(sum.service_fee_cents) + Number(sum.delivery_fee_cents);
  const payments = (await q(`select p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total, coalesce(sum(p.change_cents),0)::bigint as change
    from payments p join consumption_sessions s on s.id = p.session_id where p.company_id = $1 and p.business_date between $2 and $3${unitF} and p.status = 'confirmado' group by p.method order by total desc`, P)).rows;
  const open = (await q(`select count(*)::int as n, coalesce(sum((select coalesce(sum(total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo')
      - (select coalesce(sum(amount_cents),0) from payments p where p.session_id = s.id and p.status = 'confirmado')),0)::bigint as balance
    from consumption_sessions s where s.company_id = $1 and s.status in ('aberta','em_fechamento')${r.unit_id ? ' and s.unit_id = $2' : ''}`, r.unit_id ? [ctx.companyId, r.unit_id] : [ctx.companyId])).rows[0];

  const byDay = (await q(`select s.business_date as day, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM} group by 1 order by 1`, P)).rows;
  const byHour = (await q(`select extract(hour from i.created_at at time zone '${tz.replace(/'/g, '')}')::int as hour, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM} group by 1 order by 1`, P)).rows;
  const byProduct = (await q(`select i.product_id, max(i.description) as name, max(c.name) as category, sum(i.qty)::float as qty, sum(i.total_cents)::bigint as items_cents,
      sum(coalesce((select -sum(m.qty * m.unit_cost_cents) from stock_movements m where m.ref_type = 'order_item' and m.ref_id = i.id and m.kind = 'venda'),
        p.cost_cents * i.qty))::bigint as cost_cents
    ${ITEM.replace('where', 'join products p on p.id = i.product_id left join categories c on c.id = p.category_id where')} group by i.product_id order by items_cents desc`, P)).rows;
  const byCategory = Object.values(byProduct.reduce((acc, p) => { const k = p.category || 'Sem categoria'; acc[k] ||= { name: k, qty: 0, items_cents: 0, cost_cents: 0 };
    acc[k].qty += p.qty; acc[k].items_cents += Number(p.items_cents); acc[k].cost_cents += Number(p.cost_cents); return acc; }, {})).sort((a, b) => b.items_cents - a.items_cents);
  // curva ABC: A até 80% do faturamento, B até 95%, C o restante
  const totalItems = byProduct.reduce((s, p) => s + Number(p.items_cents), 0) || 1;
  let acc = 0;
  for (const p of byProduct) { acc += Number(p.items_cents); p.abc = acc / totalItems <= 0.8 ? 'A' : acc / totalItems <= 0.95 ? 'B' : 'C'; }
  const byUser = (await q(`select u.name, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM.replace('where', 'left join users u on u.id = i.user_id where')} group by u.name order by items_cents desc`, P)).rows;
  const byTable = (await q(`select t.number, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents,
      round(avg(extract(epoch from (s.closed_at - s.opened_at)) / 60)::numeric)::int as avg_minutes
    ${ITEM.replace('where', 'join dining_tables t on t.id = s.table_id where')} group by t.number order by t.number`, P)).rows;
  const byChannel = (await q(`select s.kind as channel, count(distinct s.id)::int as sessions, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM} group by 1 order by 3 desc`, P)).rows;
  const byTerminal = (await q(`select coalesce(tm.name, 'Sem terminal') as name, count(*)::int as items, coalesce(sum(i.total_cents),0)::bigint as items_cents ${ITEM.replace('where', 'left join terminals tm on tm.id = i.terminal_id where')} group by 1 order by 3 desc`, P)).rows;
  const modes = (await q(`select i.launch_mode, count(*)::int as n from order_items i join consumption_sessions s on s.id = i.session_id where ${S} group by 1`, P)).rows;
  const control = (await q(`select
      count(*) filter (where i.status = 'cancelado')::int as canceled_items, coalesce(sum(i.total_cents) filter (where i.status = 'cancelado'),0)::bigint as canceled_cents,
      coalesce(sum(i.discount_cents) filter (where i.status = 'ativo'),0)::bigint as discounts_cents, count(*) filter (where i.discount_cents > 0)::int as discounted_items
    from order_items i join consumption_sessions s on s.id = i.session_id where ${S}`, P)).rows[0];
  const auditCounts = (await q(`select action, count(*)::int as n from audit_events where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1
      and action in ('consumo.reaberto','consumo.cancelado','pdv.itens_transferidos','pdv.mesa_trocada','autorizacao.concedida','autorizacao.negada','leitura.desconhecida','pdv.excecao_manual','pagamento.estornado','pdv.taxa_servico')
    group by action`, [ctx.companyId, r.from, r.to])).rows;
  const kitchen = (await q(`select ps.name as sector, count(*)::int as items, round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
    from order_items i join consumption_sessions s on s.id = i.session_id join production_sectors ps on ps.id = i.sector_id
    where ${S} and i.ready_at is not null and i.sent_at is not null group by ps.name order by ps.name`, P)).rows;
  const delivery = (await q(`select count(*)::int as orders, count(*) filter (where d.status = 'cancelado')::int as canceled,
      round(avg(extract(epoch from (e.created_at - d.created_at)) / 60)::numeric)::int as avg_minutes_to_deliver
    from delivery_orders d join consumption_sessions s on s.id = d.session_id
    left join lateral (select created_at from delivery_events where order_id = d.id and status = 'entregue' order by id limit 1) e on true where ${S}`, P)).rows[0];
  const stock = (await q(`select coalesce(sum(-m.qty * m.unit_cost_cents) filter (where m.kind = 'perda'),0)::bigint as losses_cents,
      coalesce(sum(m.qty * m.unit_cost_cents) filter (where m.kind = 'inventario'),0)::bigint as inventory_diff_cents
    from stock_movements m where m.company_id = $1 and m.created_at >= $2::date and m.created_at < $3::date + 1`, [ctx.companyId, r.from, r.to])).rows[0];
  const customers = (await q(`select count(distinct s.customer_id)::int as identified,
      count(distinct s.customer_id) filter (where exists (select 1 from consumption_sessions o where o.customer_id = s.customer_id and o.status = 'encerrada' and o.business_date < $2))::int as returning
    from consumption_sessions s where ${closed} and s.customer_id is not null`, P)).rows[0];
  const loyalty = (await q(`select coalesce(sum(points) filter (where kind = 'ganho'),0)::int as earned, coalesce(-sum(points) filter (where kind = 'resgate'),0)::int as redeemed
    from loyalty_ledger where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1`, [ctx.companyId, r.from, r.to])).rows[0];
  const reviews = (await q(`select count(*)::int as n, round(avg(score)::numeric, 2)::float as average from reviews where company_id = $1 and created_at >= $2::date and created_at < $3::date + 1`, [ctx.companyId, r.from, r.to])).rows[0];
  const cash = fin ? (await q(`select count(*)::int as sessions, coalesce(sum(difference_cents),0)::bigint as difference_cents,
      count(*) filter (where difference_cents <> 0)::int as with_difference from cash_sessions where company_id = $1 and business_date between $2 and $3 and status = 'fechado'`, [ctx.companyId, r.from, r.to])).rows[0] : null;
  const movements = fin ? (await q(`select m.kind, coalesce(sum(m.amount_cents),0)::bigint as total from cash_movements m join cash_sessions c on c.id = m.cash_session_id
      where m.company_id = $1 and c.business_date between $2 and $3 group by m.kind`, [ctx.companyId, r.from, r.to])).rows : null;

  const cogs = byProduct.reduce((s, p) => s + Number(p.cost_cents), 0);
  const money = (v) => (fin ? v : null);
  if (!cmv) for (const p of [...byProduct, ...byCategory]) delete p.cost_cents;
  const received = payments.reduce((s, p) => s + Number(p.total), 0);
  // DRE gerencial simplificada (sem despesas fixas: só o que o RUSTEN registra)
  const dre = fin && cmv ? {
    receita_bruta: revenue, taxa_servico: Number(sum.service_fee_cents), taxa_entrega: Number(sum.delivery_fee_cents), cmv: cogs,
    lucro_bruto: Number(sum.items_cents) - cogs, despesas_caixa: Number(movements?.find((m) => m.kind === 'despesa')?.total || 0),
    resultado: Number(sum.items_cents) - cogs - Number(movements?.find((m) => m.kind === 'despesa')?.total || 0),
  } : null;
  return {
    period: { from: r.from, to: r.to }, permissions: { financial: fin, cmv },
    summary: { sessions: sum.sessions, revenue_cents: money(revenue), items_cents: money(Number(sum.items_cents)), service_fee_cents: money(Number(sum.service_fee_cents)),
      delivery_fee_cents: money(Number(sum.delivery_fee_cents)), received_cents: money(received), ticket_cents: money(sum.sessions ? Math.round(revenue / sum.sessions) : 0),
      open_sessions: open.n, open_balance_cents: money(Number(open.balance)),
      cmv_cents: cmv ? cogs : null, margin_pct: cmv && Number(sum.items_cents) ? Math.round(((Number(sum.items_cents) - cogs) / Number(sum.items_cents)) * 1000) / 10 : null },
    by_day: byDay.map((d) => ({ ...d, items_cents: money(Number(d.items_cents)) })),
    by_hour: byHour.map((d) => ({ ...d, items_cents: money(Number(d.items_cents)) })),
    by_product: byProduct.map((d) => ({ ...d, items_cents: money(Number(d.items_cents)) })),
    by_category: byCategory.map((d) => ({ ...d, items_cents: money(d.items_cents) })),
    by_user: byUser.map((d) => ({ ...d, items_cents: money(Number(d.items_cents)) })),
    by_table: byTable.map((d) => ({ ...d, items_cents: money(Number(d.items_cents)) })),
    by_channel: byChannel.map((d) => ({ ...d, items_cents: money(Number(d.items_cents)) })),
    by_terminal: byTerminal.map((d) => ({ ...d, items_cents: money(Number(d.items_cents)) })),
    payments: fin ? payments : null, cash, movements, dre,
    control: { ...control, canceled_cents: money(Number(control.canceled_cents)), discounts_cents: money(Number(control.discounts_cents)),
      launch_modes: Object.fromEntries(modes.map((m) => [m.launch_mode, m.n])), events: Object.fromEntries(auditCounts.map((a) => [a.action, a.n])) },
    kitchen, delivery, stock: cmv ? stock : null, customers: { ...customers, loyalty, reviews },
  };
}

router.get('/overview', need('relatorios.visualizar'), h(async (req, res) => {
  res.json(await build(req.ctx, range(req.query)));
}));

const SECTIONS = {
  produtos: ['by_product', [['name', 'Produto'], ['category', 'Categoria'], ['qty', 'Quantidade'], ['items_cents', 'Vendido (R$)'], ['cost_cents', 'CMV (R$)'], ['abc', 'Curva ABC']]],
  dias: ['by_day', [['day', 'Dia comercial'], ['sessions', 'Consumos'], ['items_cents', 'Vendido (R$)']]],
  horas: ['by_hour', [['hour', 'Hora'], ['items', 'Itens'], ['items_cents', 'Vendido (R$)']]],
  garcons: ['by_user', [['name', 'Usuário'], ['items', 'Itens'], ['items_cents', 'Vendido (R$)']]],
  mesas: ['by_table', [['number', 'Mesa'], ['sessions', 'Consumos'], ['items_cents', 'Vendido (R$)'], ['avg_minutes', 'Permanência média (min)']]],
  pagamentos: ['payments', [['method', 'Forma'], ['n', 'Quantidade'], ['total', 'Total (R$)']]],
};

router.get('/export', need('relatorios.visualizar'), h(async (req, res) => {
  const r = range(req.query);
  const sec = SECTIONS[req.query.section];
  if (!sec) throw bad('Seção inválida');
  const data = await build(req.ctx, r);
  const rows = data[sec[0]] || [];
  const cols = sec[1].filter(([k]) => rows.some((x) => x[k] !== undefined && x[k] !== null));
  const fmt = (k, v) => (/cents|^total$/.test(k) && v != null ? (Number(v) / 100).toFixed(2).replace('.', ',') : v);
  const lines = [cols.map(([, l]) => l).join(';'), ...rows.map((x) => cols.map(([k]) => csvCell(fmt(k, x[k]))).join(';'))];
  await audit({ query: q }, req.ctx, 'relatorio.exportado', { data: { section: req.query.section, ...r } });
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="rusten-${req.query.section}-${r.from}-${r.to}.csv"`);
  res.send(`﻿${lines.join('\n')}`);
}));
