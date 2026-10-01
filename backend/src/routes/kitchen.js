// Cozinha, bar e KDS: filas por setor, transições NOVO → ACEITO → PREPARANDO → PRONTO → ENTREGUE,
// cancelamentos que exigem ciência do setor, prioridade autorizada e alerta de atraso.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, notFound, conflict, forbidden } from '../lib/core.js';
import { need, audit, assertCan } from '../lib/auth.js';

export const router = Router();
const anyOf = (...perms) => (req, _res, next) => (perms.some((p) => req.ctx.can(p)) ? next() : next(forbidden('Sem permissão para o painel')));

const FLOW = ['novo', 'aceito', 'preparando', 'pronto', 'entregue'];

router.get('/sectors', need('cozinha.operar'), h(async (req, res) => {
  res.json((await q(`select s.id, s.name, s.target_minutes,
      (select count(*)::int from order_items i where i.sector_id = s.id and i.sent_at is not null and i.status = 'ativo'
         and i.kitchen_status in ('novo','aceito','preparando')) as open_count
    from production_sectors s where s.company_id = $1 and s.active order by s.id`, [req.ctx.companyId])).rows);
}));

router.put('/sectors/:id', need('cardapio.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ target_minutes: z.number().int().min(1).max(240) }), req.body);
  const r = await q('update production_sectors set target_minutes = $3 where id = $1 and company_id = $2 returning id', [Number(req.params.id), req.ctx.companyId, b.target_minutes]);
  if (!r.rows[0]) throw notFound();
  res.json({ ok: true });
}));

/* Fila do setor. `since` (id do último evento visto) permite ao painel recuperar o que perdeu numa reconexão. */
router.get('/queue', need('cozinha.operar'), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = `i.company_id = $1 and i.sent_at is not null and i.kitchen_status <> 'nao_produz'
    and (i.kitchen_status in ('novo','aceito','preparando','pronto')
         or (i.kitchen_status = 'cancelado' and i.cancel_ack_at is null and i.accepted_at is not null)
         or (i.kitchen_status = 'cancelado' and i.cancel_ack_at is null and i.canceled_at > now() - interval '30 minutes'))`;
  if (req.query.sector_id) { params.push(Number(req.query.sector_id)); where += ` and i.sector_id = $${params.length}`; }
  const unit = req.ctx.terminalUnitId || req.ctx.unitId;
  if (unit) { params.push(unit); where += ` and s.unit_id = $${params.length}`; }
  const rows = (await q(
    `select i.id, i.session_id, i.description, i.qty, i.unit, i.modifiers, i.notes, i.kitchen_status, i.status, i.priority, i.sector_id,
            i.created_at, i.sent_at, i.accepted_at, i.ready_at, i.cancel_reason, i.canceled_at, i.launch_mode,
            s.kind, s.label, s.customer_name, c.number as card_number, t.number as table_number, d.number as delivery_number, d.mode as delivery_mode,
            ps.name as sector_name, ps.target_minutes, u.name as user_name,
            exists(select 1 from order_items o where o.session_id = i.session_id and o.id < i.id and o.sent_at < i.sent_at - interval '1 minute') as added_later
       from order_items i join consumption_sessions s on s.id = i.session_id
       left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join delivery_orders d on d.session_id = s.id left join production_sectors ps on ps.id = i.sector_id
       left join users u on u.id = i.user_id
      where ${where} order by i.priority desc, i.sent_at, i.id limit 400`, params)).rows;
  const last = (await q('select coalesce(max(id),0)::bigint as id from kitchen_events where company_id = $1', [req.ctx.companyId])).rows[0].id;
  res.json({ now: new Date().toISOString(), last_event: last, items: rows });
}));

/* Transição idempotente: repetir a mesma mudança devolve ok sem novo evento; `from` evita sobrescrever
   uma mudança feita em outra tela (ex.: dois cozinheiros tocando o mesmo item). */
router.post('/items/:id/status', need('cozinha.operar'), h(async (req, res) => {
  const b = parse(z.object({ to: z.enum(['aceito', 'preparando', 'pronto', 'entregue']), from: z.string().optional() }), req.body);
  const out = await tx(async (db) => {
    const it = (await db.query('select * from order_items where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!it) throw notFound('Item não encontrado');
    if (it.kitchen_status === b.to) return { ok: true, replay: true, status: it.kitchen_status };
    if (it.status !== 'ativo' || it.kitchen_status === 'cancelado') throw conflict('Item cancelado: confirme a ciência do cancelamento', 'item_canceled');
    if (!it.sent_at) throw conflict('Item ainda não enviado à produção', 'not_sent');
    if (b.from && b.from !== it.kitchen_status) throw conflict(`O item já está "${it.kitchen_status}" (alterado em outra tela)`, 'status_changed', { status: it.kitchen_status });
    const iFrom = FLOW.indexOf(it.kitchen_status); const iTo = FLOW.indexOf(b.to);
    if (iTo <= iFrom) throw conflict('Não é possível voltar a etapa anterior', 'invalid_transition');
    await db.query(`update order_items set kitchen_status = $2,
        accepted_at = coalesce(accepted_at, case when $2 in ('aceito','preparando','pronto','entregue') then now() end),
        ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
        delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`, [it.id, b.to]);
    await db.query('insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$2,$3,$4,$5)',
      [req.ctx.companyId, it.id, it.kitchen_status, b.to, req.ctx.userId]);
    return { ok: true, status: b.to };
  });
  res.json(out);
}));

// Avançar todos os itens de um pedido de uma vez (ex.: "pronto" para a mesa inteira)
router.post('/sessions/:id/advance', need('cozinha.operar'), h(async (req, res) => {
  const b = parse(z.object({ to: z.enum(['aceito', 'preparando', 'pronto', 'entregue']), sector_id: z.number().int().optional() }), req.body);
  const iTo = FLOW.indexOf(b.to);
  const out = await tx(async (db) => {
    const params = [Number(req.params.id), req.ctx.companyId, FLOW.slice(0, iTo)];
    let extra = '';
    if (b.sector_id) { params.push(b.sector_id); extra = ` and sector_id = $${params.length}`; }
    const items = (await db.query(`select id, kitchen_status from order_items where session_id = $1 and company_id = $2 and status = 'ativo'
      and sent_at is not null and kitchen_status = any($3)${extra} for update`, params)).rows;
    for (const it of items) {
      await db.query(`update order_items set kitchen_status = $2, accepted_at = coalesce(accepted_at, now()),
          ready_at = coalesce(ready_at, case when $2 in ('pronto','entregue') then now() end),
          delivered_at = case when $2 = 'entregue' then now() else delivered_at end where id = $1`, [it.id, b.to]);
      await db.query('insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$2,$3,$4,$5)',
        [req.ctx.companyId, it.id, it.kitchen_status, b.to, req.ctx.userId]);
    }
    return { changed: items.length };
  });
  res.json(out);
}));

// Cancelamento após envio: some da fila só depois que o setor confirma que viu
router.post('/items/:id/ack-cancel', need('cozinha.operar'), h(async (req, res) => {
  const r = await q(`update order_items set cancel_ack_at = now() where id = $1 and company_id = $2 and kitchen_status = 'cancelado' and cancel_ack_at is null returning id`,
    [Number(req.params.id), req.ctx.companyId]);
  if (r.rows[0]) await q('insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$2,$3,$4,$5)',
    [req.ctx.companyId, r.rows[0].id, 'cancelado', 'cancelado_ciente', req.ctx.userId]);
  res.json({ ok: true });
}));

// Prioridade: só gerência (ou com autorização registrada na auditoria)
router.post('/items/:id/priority', need('cozinha.operar'), h(async (req, res) => {
  const b = parse(z.object({ priority: z.boolean(), reason: z.string().trim().min(3).max(200) }), req.body);
  assertCan(req.ctx, 'pdv.autorizar');
  const r = await q('update order_items set priority = $3 where id = $1 and company_id = $2 returning id, session_id', [Number(req.params.id), req.ctx.companyId, b.priority]);
  if (!r.rows[0]) throw notFound();
  await audit({ query: q }, req.ctx, 'producao.prioridade', { entity: 'item', entityId: r.rows[0].id, reason: b.reason, data: { priority: b.priority } });
  res.json({ ok: true });
}));

// Itens prontos aguardando retirada pelo garçom (painel do salão)
router.get('/ready', need('pdv.lancar'), h(async (req, res) => {
  res.json((await q(`select i.id, i.description, i.qty, i.ready_at, s.id as session_id, s.label, c.number as card_number, t.number as table_number
     from order_items i join consumption_sessions s on s.id = i.session_id left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
     where i.company_id = $1 and i.kitchen_status = 'pronto' and i.status = 'ativo' order by i.ready_at limit 100`, [req.ctx.companyId])).rows);
}));

router.get('/stats', need('cozinha.operar'), h(async (req, res) => {
  const r = (await q(`select ps.name as sector, count(*)::int as items,
      round(avg(extract(epoch from (i.ready_at - i.sent_at)) / 60)::numeric, 1)::float as avg_minutes,
      count(*) filter (where i.ready_at - i.sent_at > make_interval(mins => ps.target_minutes))::int as late
     from order_items i join production_sectors ps on ps.id = i.sector_id
    where i.company_id = $1 and i.ready_at is not null and i.sent_at > now() - interval '24 hours' group by ps.name order by ps.name`, [req.ctx.companyId])).rows;
  res.json(r);
}));

/* Painel da TV (retirada): pedidos em preparo e prontos, por comanda/mesa/pedido.
   Mostra só número, primeiro nome e itens — nada de valores. */
router.get('/board', anyOf('pdv.lancar', 'cozinha.operar'), h(async (req, res) => {
  const unit = req.ctx.terminalUnitId || req.ctx.unitId;
  const params = [req.ctx.companyId];
  let unitF = '';
  if (unit) { params.push(unit); unitF = ` and s.unit_id = $${params.length}`; }
  const rows = (await q(`
    select s.id, s.kind, s.label, s.customer_name, c.number as card_number, t.number as table_number, d.number as delivery_number, d.mode as delivery_mode,
           count(*) filter (where i.kitchen_status in ('novo','aceito','preparando'))::int as pending,
           count(*) filter (where i.kitchen_status = 'pronto')::int as ready,
           min(i.sent_at) as sent_at, max(i.ready_at) as ready_at,
           coalesce(json_agg(json_build_object('d', i.description, 'q', i.qty, 's', i.kitchen_status) order by i.id), '[]') as items,
           (select max(e.created_at) from kitchen_events e join order_items i2 on i2.id = e.item_id where i2.session_id = s.id and e.to_status = 'chamado') as called_at
      from order_items i join consumption_sessions s on s.id = i.session_id
      left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id left join delivery_orders d on d.session_id = s.id
     where i.company_id = $1${unitF} and i.status = 'ativo' and i.sent_at is not null and i.kitchen_status in ('novo','aceito','preparando','pronto')
       and s.status in ('aberta','em_fechamento') and coalesce(d.status, '') not in ('saiu','entregue','cancelado')
     group by s.id, c.number, t.number, d.number, d.mode
     order by min(i.sent_at)
     limit 120`, params)).rows;
  const first = (n) => (n ? String(n).trim().split(/\s+/)[0] : null);
  res.set('cache-control', 'no-store');
  res.json({ now: new Date().toISOString(), orders: rows.map((r) => ({
    id: r.id,
    code: r.delivery_number ? `#${r.delivery_number}` : r.card_number ? String(r.card_number) : r.table_number ? String(r.table_number) : String(r.id),
    kind: r.delivery_number ? (r.delivery_mode === 'retirada' ? 'retirada' : 'delivery') : r.card_number ? 'comanda' : r.table_number ? 'mesa' : r.kind,
    table: r.card_number && r.table_number ? r.table_number : null,
    name: first(r.customer_name),
    status: r.pending > 0 ? 'preparando' : 'pronto',
    partial: r.pending > 0 && r.ready > 0,
    sent_at: r.sent_at, ready_at: r.ready_at, called_at: r.called_at,
    items: r.items.map((x) => ({ d: x.d, q: Number(x.q), ready: x.s === 'pronto' })),
  })) });
}));

// Chamar de novo no painel (ex.: cliente não veio buscar)
router.post('/sessions/:id/call', anyOf('pdv.lancar', 'cozinha.operar'), h(async (req, res) => {
  const it = (await q(`select id from order_items where session_id = $1 and company_id = $2 and status = 'ativo' and kitchen_status = 'pronto' order by id desc limit 1`,
    [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!it) throw conflict('Nenhum item pronto neste pedido', 'nothing_ready');
  await q(`insert into kitchen_events (company_id, item_id, from_status, to_status, user_id) values ($1,$2,'pronto','chamado',$3)`, [req.ctx.companyId, it.id, req.ctx.userId]);
  res.json({ ok: true });
}));
