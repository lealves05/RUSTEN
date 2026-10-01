// PDV: roteador de códigos, sessões de consumo, lançamento idempotente nos 3 modos, pagamentos e fechamento.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, forbidden, notFound, conflict, lineTotal, splitCents, businessDate } from '../lib/core.js';
import { need, audit, assertCan } from '../lib/auth.js';
import { pdvSettings, resolveCode, lockSession, assertOpen, assertUnitScope, sessionTotals, normalizeCode } from '../lib/pdv.js';
import { consumeAuthorization } from './admin.js';
import { consumeForItem, reverseForItem } from '../lib/stock.js';
import { earnPoints, reverseEarn, reverseRedeemByPayment } from '../lib/customers.js';

export const router = Router();

async function unitCutoff(db, companyId, unitId) {
  const r = await db.query('select u.day_cutoff, c.timezone from units u join companies c on c.id = u.company_id where u.id = $1 and u.company_id = $2', [unitId, companyId]);
  if (!r.rows[0]) throw bad('Unidade inválida');
  return r.rows[0];
}

// ---- Roteador de códigos ----
router.post('/resolve', need('pdv.lancar'), h(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().max(256) }), req.body);
  const r = await resolveCode({ query: q }, req.ctx.companyId, code);
  if (r.type === 'DESCONHECIDO') await audit({ query: q }, req.ctx, 'leitura.desconhecida', { data: { code: r.code.slice(0, 40) } });
  // Reconhecer não autoriza: devolvemos só o necessário para o PDV decidir
  res.json(r);
}));

// ---- Sessões de consumo ----
router.get('/sessions', need('pdv.lancar'), h(async (req, res) => {
  const status = req.query.status === 'all' ? null : ['aberta', 'em_fechamento'];
  const params = [req.ctx.companyId];
  let where = 's.company_id = $1';
  if (status) { params.push(status); where += ` and s.status = any($${params.length})`; }
  const unit = Number(req.query.unit_id) || req.ctx.terminalUnitId || req.ctx.unitId;
  if (unit) { params.push(unit); where += ` and s.unit_id = $${params.length}`; }
  const { rows } = await q(
    `select s.id, s.kind, s.status, s.label, s.customer_name, s.opened_at, s.version, s.suspended, s.unit_id,
            c.number as card_number, t.number as table_number, s.table_id, s.card_id,
            (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
            (select coalesce(sum(amount_cents),0)::bigint from payments p where p.session_id = s.id and p.status = 'confirmado') as paid_cents,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo') as item_count
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
      where ${where} order by s.opened_at desc limit 300`, params);
  res.json(rows);
}));

const openSchema = z.object({
  kind: z.enum(['comanda', 'mesa', 'balcao', 'retirada']),
  card_id: z.number().int().optional(),
  card_code: z.string().max(128).optional(),
  table_id: z.number().int().optional(),
  customer_name: z.string().trim().max(80).optional(),
  customer_id: z.number().int().optional(),
  label: z.string().trim().max(60).optional(),
  unit_id: z.number().int().optional(),
});

export async function openSession(db, ctx, b) {
  assertCan(ctx, 'pdv.abrir_comanda');
  let unitId = b.unit_id || ctx.terminalUnitId || ctx.unitId;
  let cardId = null; let tableId = null;
  if (b.card_code && !b.card_id) {
    const r = await resolveCode(db, ctx.companyId, b.card_code);
    if (r.type !== 'COMANDA') throw bad('Código não é de comanda');
    b.card_id = r.card.id;
  }
  if (b.card_id) {
    const c = (await db.query('select * from tab_cards where id = $1 and company_id = $2 for update', [b.card_id, ctx.companyId])).rows[0];
    if (!c) throw notFound('Comanda não encontrada');
    if (c.status !== 'ativo') throw conflict(`Comanda ${c.number} bloqueada${c.block_reason ? `: ${c.block_reason}` : ''}`, 'card_blocked');
    const busy = await db.query("select id from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento')", [c.id]);
    if (busy.rows[0]) throw conflict(`Comanda ${c.number} já está em uso`, 'card_busy', { session_id: busy.rows[0].id });
    cardId = c.id; unitId = c.unit_id;
  }
  if (b.table_id) {
    const t = (await db.query('select * from dining_tables where id = $1 and company_id = $2 and active', [b.table_id, ctx.companyId])).rows[0];
    if (!t) throw notFound('Mesa não encontrada');
    if (unitId && t.unit_id !== unitId) throw bad('Mesa e comanda de unidades diferentes');
    tableId = t.id; unitId = t.unit_id;
  }
  if (b.customer_id) {
    const cu = (await db.query('select id, name from customers where id = $1 and company_id = $2 and anonymized_at is null', [b.customer_id, ctx.companyId])).rows[0];
    if (!cu) throw notFound('Cliente não encontrado');
    b.customer_name = b.customer_name || cu.name;
  }
  if (b.kind === 'comanda' && !cardId) throw bad('Informe a comanda');
  if (b.kind === 'mesa' && !tableId) throw bad('Informe a mesa');
  if (!unitId) unitId = (await db.query('select id from units where company_id = $1 and active order by id limit 1', [ctx.companyId])).rows[0]?.id;
  assertUnitScope(ctx, unitId);
  const settings = await pdvSettings(db, ctx, unitId);
  const { day_cutoff, timezone } = await unitCutoff(db, ctx.companyId, unitId);
  const s = await db.query(
    `insert into consumption_sessions (company_id, unit_id, kind, card_id, table_id, customer_name, label, service_fee_bp, opened_by, business_date, customer_id, delivery_fee_cents)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [ctx.companyId, unitId, b.kind, cardId, tableId, b.customer_name ?? null, b.label ?? null,
      ['balcao', 'retirada', 'delivery'].includes(b.kind) ? 0 : settings.service_fee_bp, ctx.userId, businessDate(new Date(), timezone, day_cutoff),
      b.customer_id ?? null, b.delivery_fee_cents ?? 0]);
  if (tableId) await db.query("update dining_tables set status = 'ocupada' where id = $1 and status in ('livre','reservada','limpeza')", [tableId]);
  await audit(db, ctx, 'consumo.aberto', { entity: 'session', entityId: s.rows[0].id, unitId, data: { kind: b.kind, card: cardId, table: tableId } });
  return s.rows[0];
}

router.post('/sessions', h(async (req, res) => {
  const b = parse(openSchema, req.body);
  const s = await tx((db) => openSession(db, req.ctx, b)).catch((e) => {
    if (e.code === '23505') throw conflict('Comanda já está em uso', 'card_busy');
    throw e;
  });
  res.status(201).json(s);
}));

async function loadSessionFull(db, ctx, id) {
  const s = (await db.query(
    `select s.*, c.number as card_number, t.number as table_number, u.name as opened_by_name, cu.points as customer_points,
            (select count(*)::int from order_items i where i.session_id = s.id and i.status = 'ativo' and i.sent_at is null and i.kitchen_status = 'novo') as pending_send
       from consumption_sessions s left join tab_cards c on c.id = s.card_id left join dining_tables t on t.id = s.table_id
       left join users u on u.id = s.opened_by left join customers cu on cu.id = s.customer_id where s.id = $1 and s.company_id = $2`, [id, ctx.companyId])).rows[0];
  if (!s) throw notFound('Consumo não encontrado');
  const items = (await db.query(
    `select i.id, i.product_id, i.description, i.qty, i.unit, i.unit_price_cents, i.modifiers, i.modifiers_cents, i.discount_cents,
            i.total_cents, i.notes, i.status, i.kitchen_status, i.launch_mode, i.created_at, i.cancel_reason, i.transferred_from, i.sent_at,
            u.name as user_name
       from order_items i left join users u on u.id = i.user_id where i.session_id = $1 order by i.id`, [id])).rows;
  const payments = (await db.query(
    `select p.id, p.method, p.amount_cents, p.tendered_cents, p.change_cents, p.status, p.source, p.created_at, p.refund_reason, u.name as user_name
       from payments p left join users u on u.id = p.user_id where p.session_id = $1 order by p.id`, [id])).rows;
  return { ...s, items, payments, totals: await sessionTotals(db, id) };
}

router.get('/sessions/:id', need('pdv.lancar'), h(async (req, res) => {
  res.json(await loadSessionFull({ query: q }, req.ctx, Number(req.params.id)));
}));

/* ---- Lançamento de item ----
   Mesma regra de preço, estoque, permissão e produção em todos os modos. Idempotente pela chave do cliente. */
const itemSchema = z.object({
  session_id: z.number().int(),
  product_id: z.number().int().optional(),
  qty: z.number().positive().max(9999).optional(),
  option_ids: z.array(z.number().int()).max(40).default([]),
  notes: z.string().trim().max(200).optional(),
  launch_mode: z.enum(['manual', 'continua', 'dupla', 'excecao', 'balcao', 'delivery']),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  scan: z.object({ card_code: z.string().max(128).optional(), product_code: z.string().max(128).optional() }).optional(),
  price_override_cents: z.number().int().min(0).max(100000000).optional(),
  discount_cents: z.number().int().min(0).max(100000000).optional(),
  authorization: z.string().max(100).optional(),
  exception_reason: z.string().trim().max(200).optional(),
});

router.post('/items', need('pdv.lancar'), h(async (req, res) => {
  const b = parse(itemSchema, req.body);
  const ctx = req.ctx;
  // Reenvio da mesma operação: devolve o resultado original, sem novo lançamento
  const prev = await q('select * from order_items where company_id = $1 and idempotency_key = $2', [ctx.companyId, b.idempotency_key]);
  if (prev.rows[0]) {
    if (Number(prev.rows[0].session_id) !== b.session_id) throw conflict('Chave de operação já usada em outro lançamento', 'idempotency_mismatch');
    return res.json({ item: prev.rows[0], replay: true, totals: await sessionTotals({ query: q }, b.session_id) });
  }

  const out = await tx(async (db) => {
    const session = await lockSession(db, ctx.companyId, b.session_id);
    assertUnitScope(ctx, session.unit_id);
    assertOpen(session);
    const st = await pdvSettings(db, ctx, session.unit_id);
    let productId = b.product_id;
    let exceptionBy = null;

    // Regras por modo — o servidor decide, não a tela
    if (b.launch_mode === 'dupla' || b.launch_mode === 'continua') {
      if (!st.scanner_enabled) throw forbidden('Leitor desabilitado nesta configuração', 'scanner_disabled');
      if (b.launch_mode === 'continua' && st.double_read_mandatory) throw forbidden('Dupla leitura obrigatória: leitura contínua não permitida', 'double_read_required');
      const pr = await resolveCode(db, ctx.companyId, b.scan?.product_code);
      if (pr.type !== 'PRODUTO') throw bad('Código lido não é de produto', 'not_a_product');
      if (productId && productId !== pr.product.id) throw bad('Produto informado difere do código lido');
      productId = pr.product.id;
      if (b.launch_mode === 'dupla') {
        const cr = await resolveCode(db, ctx.companyId, b.scan?.card_code);
        if (cr.type !== 'COMANDA') throw bad('Dupla leitura exige a leitura da comanda antes do produto', 'card_required');
        if (Number(cr.card.id) !== Number(session.card_id)) throw conflict('Comanda lida não corresponde ao consumo de destino', 'card_mismatch');
      }
    } else if (b.launch_mode === 'excecao') {
      if (!st.allow_manual_exception) throw forbidden('Exceção manual desabilitada', 'exception_disabled');
      assertCan(ctx, 'pdv.excecao_dupla_leitura');
      if (!b.exception_reason) throw bad('Informe o motivo da exceção');
      if (st.exception_requires_manager) {
        const a = await consumeAuthorization(db, ctx, b.authorization, 'excecao_dupla_leitura');
        exceptionBy = a.authorized_by;
      }
    } else if (b.launch_mode === 'delivery') {
      assertCan(ctx, 'delivery.gerenciar');
      if (session.kind !== 'delivery') throw bad('Lançamento de delivery só em pedidos de delivery');
    } else {
      // manual / balcão
      if (st.double_read_mandatory) throw forbidden('Dupla leitura obrigatória: use a exceção autorizada para lançar manualmente', 'double_read_required');
      if (!st.allow_manual) throw forbidden('Lançamento manual desabilitado', 'manual_disabled');
      assertCan(ctx, 'pdv.lancamento_manual');
    }
    if (!productId) throw bad('Informe o produto');

    const p = (await db.query('select * from products where id = $1 and company_id = $2', [productId, ctx.companyId])).rows[0];
    if (!p) throw notFound('Produto não encontrado');
    if (!p.active) throw conflict(`${p.name} está indisponível`, 'product_inactive');

    // Quantidade: produto por peso exige peso explícito; demais, inteiro. Leitura com qtd ≠ padrão exige permissão.
    let qty = b.qty;
    const scanning = b.launch_mode === 'dupla' || b.launch_mode === 'continua';
    if (p.kind === 'weight') {
      if (!qty) throw bad(`${p.name} é vendido por peso: informe o peso`, 'weight_required');
    } else {
      qty = qty ?? (scanning ? st.qty_per_scan : 1);
      if (!Number.isInteger(qty)) throw bad('Quantidade deve ser inteira para este produto');
      if (scanning && qty !== st.qty_per_scan) {
        assertCan(ctx, 'pdv.alterar_quantidade');
        if (qty > st.max_qty_per_scan) throw bad(`Quantidade por leitura limitada a ${st.max_qty_per_scan}`);
      }
    }

    // Opções: pertencem ao produto e respeitam mínimo/máximo de cada grupo
    const groups = (await db.query(
      `select g.id, g.name, g.min_select, g.max_select,
              coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents)) filter (where o.id is not null), '[]') as options
         from modifier_groups g left join modifier_options o on o.group_id = g.id and o.active
        where g.product_id = $1 group by g.id order by g.sort, g.id`, [p.id])).rows;
    const chosen = [];
    for (const g of groups) {
      const sel = g.options.filter((o) => b.option_ids.includes(o.id));
      if (sel.length < g.min_select) throw bad(`Escolha ${g.min_select === 1 ? 'uma opção' : `${g.min_select} opções`} em "${g.name}"`, 'options_required');
      if (sel.length > g.max_select) throw bad(`No máximo ${g.max_select} em "${g.name}"`);
      for (const o of sel) chosen.push({ group: g.name, id: o.id, name: o.name, price_cents: o.price_cents });
    }
    if (chosen.length !== new Set(b.option_ids).size) throw bad('Opção inválida para este produto');
    const modsCents = chosen.reduce((s, o) => s + o.price_cents, 0);

    let unitPrice = p.price_cents;
    const overrides = {};
    if (b.price_override_cents != null && b.price_override_cents !== p.price_cents) {
      if (!ctx.can('pdv.alterar_preco')) await consumeAuthorization(db, ctx, b.authorization, 'alterar_preco');
      unitPrice = b.price_override_cents; overrides.price = { from: p.price_cents, to: unitPrice };
    }
    const discount = b.discount_cents || 0;
    if (discount) {
      if (!ctx.can('pdv.desconto')) await consumeAuthorization(db, ctx, b.authorization, 'desconto');
      overrides.discount = discount;
    }
    const total = lineTotal(unitPrice, qty, modsCents, discount);
    if (discount > lineTotal(unitPrice, qty, modsCents, 0)) throw bad('Desconto maior que o valor do item');

    const item = (await db.query(
      `insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, sent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, case when $19::boolean then now() end) returning *`,
      [ctx.companyId, session.id, p.id, p.name, qty, p.unit, unitPrice, JSON.stringify(chosen), modsCents, discount, total,
        b.notes ?? null, p.sector_id, p.sector_id ? 'novo' : 'nao_produz', b.launch_mode, ctx.terminalId, ctx.userId, b.idempotency_key,
        // envio por lote: o item espera a confirmação "Enviar à produção" (delivery entra na fila ao ser confirmado)
        !!p.sector_id && st.kitchen_send !== 'lote' && session.kind !== 'delivery'])).rows[0];
    await consumeForItem(db, ctx, item, p, chosen.map((o) => o.id));
    await db.query('update consumption_sessions set version = version + 1 where id = $1', [session.id]);
    if (b.launch_mode === 'excecao' || Object.keys(overrides).length) {
      await audit(db, ctx, b.launch_mode === 'excecao' ? 'pdv.excecao_manual' : 'pdv.item_ajustado', {
        entity: 'item', entityId: item.id, unitId: session.unit_id, reason: b.exception_reason,
        data: { session: session.id, product: p.id, authorized_by: exceptionBy, ...overrides } });
    }
    return { item, totals: await sessionTotals(db, session.id),
      confirmation: { product: p.name, qty, unit_price_cents: unitPrice + modsCents, total_cents: total,
        destination: session.card_id ? `Comanda ${(await db.query('select number from tab_cards where id = $1', [session.card_id])).rows[0].number}` : session.label || `Consumo ${session.id}` } };
  }).catch(async (e) => {
    if (e.code === '23505') { // corrida com a mesma chave: devolve o que foi gravado
      const again = await q('select * from order_items where company_id = $1 and idempotency_key = $2', [ctx.companyId, b.idempotency_key]);
      if (again.rows[0]) return { item: again.rows[0], replay: true, totals: await sessionTotals({ query: q }, again.rows[0].session_id) };
    }
    throw e;
  });
  res.status(out.replay ? 200 : 201).json(out);
}));

// Recuperação de resposta incerta: consulta pela chave, sem repetir o lançamento
router.get('/items/by-key/:key', need('pdv.lancar'), h(async (req, res) => {
  const r = await q('select * from order_items where company_id = $1 and idempotency_key = $2', [req.ctx.companyId, String(req.params.key).slice(0, 80)]);
  res.json({ found: !!r.rows[0], item: r.rows[0] || null });
}));

router.post('/items/:id/cancel', need('pdv.lancar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200), authorization: z.string().max(100).optional() }), req.body);
  const out = await tx(async (db) => {
    const it = (await db.query('select * from order_items where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!it) throw notFound('Item não encontrado');
    const s = await lockSession(db, req.ctx.companyId, it.session_id);
    assertOpen(s);
    const cur = (await db.query('select * from order_items where id = $1 for update', [it.id])).rows[0];
    if (cur.status !== 'ativo') throw conflict('Item já cancelado');
    let authorizedBy = null;
    if (!req.ctx.can('pdv.cancelar_item')) authorizedBy = (await consumeAuthorization(db, req.ctx, b.authorization, 'cancelar_item')).authorized_by;
    const afterPrep = ['preparando', 'pronto', 'entregue'].includes(cur.kitchen_status);
    await db.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end where id = $1`,
    [cur.id, b.reason, req.ctx.userId]);
    if ((await sessionTotals(db, s.id)).balance < 0)
      throw conflict('Cancelar este item deixaria o consumo com pagamento maior que o total. Estorne o pagamento antes.', 'overpaid');
    await db.query('update consumption_sessions set version = version + 1 where id = $1', [s.id]);
    // Antes do preparo o insumo volta ao estoque; depois, o consumo permanece como perda
    if (!afterPrep) await reverseForItem(db, req.ctx, cur.id, `Cancelamento: ${b.reason}`);
    await audit(db, req.ctx, 'pdv.item_cancelado', { entity: 'item', entityId: cur.id, unitId: s.unit_id, reason: b.reason,
      data: { session: s.id, total_cents: cur.total_cents, after_preparation: afterPrep, kitchen_status: cur.kitchen_status, authorized_by: authorizedBy } });
    return { ok: true, after_preparation: afterPrep, totals: await sessionTotals(db, s.id) };
  });
  res.json(out);
}));

// Transferência de itens entre consumos (também usada para juntar)
router.post('/items/transfer', need('pdv.transferir_item'), h(async (req, res) => {
  const b = parse(z.object({ item_ids: z.array(z.number().int()).min(1).max(200), target_session_id: z.number().int(), reason: z.string().trim().min(3).max(200) }), req.body);
  res.json(await tx((db) => transferItems(db, req.ctx, b.item_ids, b.target_session_id, b.reason)));
}));

async function transferItems(db, ctx, itemIds, targetId, reason) {
  const items = (await db.query(`select * from order_items where id = any($1) and company_id = $2 and status = 'ativo'`, [itemIds, ctx.companyId])).rows;
  if (items.length !== new Set(itemIds).size) throw bad('Itens inválidos ou já cancelados');
  const sourceIds = [...new Set(items.map((i) => Number(i.session_id)))];
  const ids = [...sourceIds, targetId].sort((a, b) => a - b); // ordem fixa evita impasse entre terminais
  const locked = {};
  for (const id of ids) locked[id] = await lockSession(db, ctx.companyId, id);
  const target = locked[targetId];
  assertOpen(target);
  for (const sid of sourceIds) {
    const s = locked[sid];
    assertOpen(s);
    if (sid === targetId) throw bad('Origem e destino iguais');
    if (s.unit_id !== target.unit_id) throw bad('Transferência entre unidades não permitida');
  }
  for (const it of items) {
    const copy = await db.query(
      `insert into order_items (company_id, session_id, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents,
         discount_cents, total_cents, notes, sector_id, kitchen_status, launch_mode, terminal_id, user_id, idempotency_key, transferred_from)
       select company_id, $2, product_id, description, qty, unit, unit_price_cents, modifiers, modifiers_cents, discount_cents, total_cents, notes,
              sector_id, kitchen_status, launch_mode, $3, $4, idempotency_key || '-t' || $5, id from order_items where id = $1 returning id`,
      [it.id, targetId, ctx.terminalId, ctx.userId, String(it.id)]);
    await db.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now() where id = $1`,
      [it.id, `Transferido para consumo ${targetId} (item ${copy.rows[0].id})`, ctx.userId]);
  }
  for (const sid of sourceIds) {
    const t = await sessionTotals(db, sid);
    if (t.balance < 0) throw conflict('A origem ficaria com pagamento maior que o consumo. Estorne antes de transferir.', 'overpaid');
    await db.query('update consumption_sessions set version = version + 1 where id = $1', [sid]);
  }
  await db.query('update consumption_sessions set version = version + 1 where id = $1', [targetId]);
  await audit(db, ctx, 'pdv.itens_transferidos', { entity: 'session', entityId: targetId, reason, data: { items: itemIds, from: sourceIds } });
  return { ok: true, moved: items.length };
}

router.post('/sessions/:id/merge', need('pdv.transferir_item'), h(async (req, res) => {
  const b = parse(z.object({ target_session_id: z.number().int(), reason: z.string().trim().min(3).max(200) }), req.body);
  const id = Number(req.params.id);
  res.json(await tx(async (db) => {
    const items = (await db.query(`select id from order_items where session_id = $1 and company_id = $2 and status = 'ativo'`, [id, req.ctx.companyId])).rows.map((r) => r.id);
    if (!items.length) throw bad('Consumo sem itens para juntar');
    const paid = await db.query("select 1 from payments where session_id = $1 and status = 'confirmado'", [id]);
    if (paid.rows[0]) throw conflict('Consumo com pagamento registrado não pode ser juntado; transfira os itens restantes', 'has_payments');
    const r = await transferItems(db, req.ctx, items, b.target_session_id, b.reason);
    if (Number(b.target_session_id) === id) throw bad('Escolha um destino diferente da origem');
    const src = (await db.query('select table_id, customer_name from consumption_sessions where id = $1', [id])).rows[0];
    await db.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2, label = coalesce(label,'') || ' (juntada)' where id = $1", [id, req.ctx.userId]);
    // destino sem nome herda o nome do cliente da origem; mesa da origem fica livre se não sobrou consumo nela
    if (src.customer_name) await db.query('update consumption_sessions set customer_name = coalesce(customer_name, $2) where id = $1', [b.target_session_id, src.customer_name]);
    if (src.table_id) await freeTableIfEmpty(db, src.table_id);
    return r;
  }));
}));

// Troca de mesa do consumo
router.post('/sessions/:id/move-table', need('pdv.transferir_item'), h(async (req, res) => {
  const b = parse(z.object({ table_id: z.number().int(), reason: z.string().trim().min(3).max(200) }), req.body);
  await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    assertOpen(s);
    const t = (await db.query('select * from dining_tables where id = $1 and company_id = $2 and active', [b.table_id, req.ctx.companyId])).rows[0];
    if (!t) throw notFound('Mesa não encontrada');
    if (t.unit_id !== s.unit_id) throw bad('Mesa de outra unidade');
    await db.query('update consumption_sessions set table_id = $2, version = version + 1 where id = $1', [s.id, t.id]);
    await db.query("update dining_tables set status = 'ocupada' where id = $1", [t.id]);
    if (s.table_id) await freeTableIfEmpty(db, s.table_id);
    await audit(db, req.ctx, 'pdv.mesa_trocada', { entity: 'session', entityId: s.id, reason: b.reason, data: { from: s.table_id, to: t.id } });
  });
  res.json({ ok: true });
}));

async function freeTableIfEmpty(db, tableId) {
  await db.query(`update dining_tables set status = 'limpeza' where id = $1 and status in ('ocupada','conta')
                  and not exists (select 1 from consumption_sessions where table_id = $1 and status in ('aberta','em_fechamento'))`, [tableId]);
}

// Taxa de serviço: discriminada, ajustável/removível com motivo
router.post('/sessions/:id/service-fee', need('pdv.lancar'), h(async (req, res) => {
  const b = parse(z.object({ bp: z.number().int().min(0).max(3000), reason: z.string().trim().min(3).max(200), authorization: z.string().max(100).optional() }), req.body);
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (!['aberta', 'em_fechamento'].includes(s.status)) throw conflict('Consumo encerrado');
    if (!req.ctx.can('pdv.taxa_servico')) await consumeAuthorization(db, req.ctx, b.authorization, 'taxa_servico');
    const paid = (await sessionTotals(db, s.id)).paid;
    await db.query('update consumption_sessions set service_fee_bp = $2, service_fee_removed_reason = $3, version = version + 1 where id = $1', [s.id, b.bp, b.reason]);
    const t = await sessionTotals(db, s.id);
    if (paid > t.total) throw conflict('Pagamento registrado supera o novo total. Estorne antes.', 'overpaid');
    await audit(db, req.ctx, 'pdv.taxa_servico', { entity: 'session', entityId: s.id, reason: b.reason, data: { from: s.service_fee_bp, to: b.bp } });
    return t;
  }));
}));

// Pré-conta (não fiscal), divisão e fechamento
router.post('/sessions/:id/request-close', need('pdv.lancar'), h(async (req, res) => {
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    assertOpen(s);
    await db.query("update consumption_sessions set status = 'em_fechamento', version = version + 1 where id = $1", [s.id]);
    if (s.table_id) await db.query("update dining_tables set status = 'conta' where id = $1", [s.table_id]);
    return { ok: true };
  }));
}));

router.post('/sessions/:id/resume', need('pdv.lancar'), h(async (req, res) => {
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (s.status !== 'em_fechamento') throw conflict('Consumo não está em fechamento');
    await db.query("update consumption_sessions set status = 'aberta', version = version + 1 where id = $1", [s.id]);
    if (s.table_id) await db.query("update dining_tables set status = 'ocupada' where id = $1", [s.table_id]);
    return { ok: true };
  }));
}));

router.post('/sessions/:id/suspend', need('pdv.lancar'), h(async (req, res) => {
  const b = parse(z.object({ suspended: z.boolean() }), req.body);
  await q('update consumption_sessions set suspended = $3 where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId, b.suspended]);
  res.json({ ok: true });
}));

router.get('/sessions/:id/split', need('pdv.lancar'), h(async (req, res) => {
  const parts = Math.min(Math.max(Number(req.query.parts) || 2, 2), 50);
  const t = await sessionTotals({ query: q }, Number(req.params.id));
  res.json({ parts: splitCents(Math.max(t.balance, 0), parts), balance: t.balance });
}));

router.post('/sessions/:id/close', need('pdv.receber'), h(async (req, res) => {
  const b = parse(z.object({ version: z.number().int() }), req.body);
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (!['aberta', 'em_fechamento'].includes(s.status)) throw conflict('Consumo já encerrado', 'already_closed');
    if (s.version !== b.version) throw conflict('O consumo foi alterado em outro terminal. Confira antes de fechar.', 'version_conflict', { version: s.version });
    const t = await sessionTotals(db, s.id);
    if (t.balance !== 0) throw conflict(`Saldo pendente de ${(t.balance / 100).toFixed(2)}. Receba antes de encerrar.`, 'balance_pending');
    if (t.items === 0) throw bad('Consumo sem itens: use cancelar');
    await db.query("update consumption_sessions set status = 'encerrada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1", [s.id, req.ctx.userId]);
    if (s.table_id) await freeTableIfEmpty(db, s.table_id);
    const earned = await earnPoints(db, req.ctx, s, t.items);
    await audit(db, req.ctx, 'consumo.encerrado', { entity: 'session', entityId: s.id, unitId: s.unit_id, data: t });
    return { ok: true, totals: t, points_earned: earned?.points || 0 };
  }));
}));

router.post('/sessions/:id/cancel', need('pdv.lancar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200), authorization: z.string().max(100).optional() }), req.body);
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (!['aberta', 'em_fechamento'].includes(s.status)) throw conflict('Consumo já encerrado');
    const t = await sessionTotals(db, s.id);
    if (t.paid > 0) throw conflict('Há pagamentos confirmados: estorne antes de cancelar', 'has_payments');
    let by = null;
    if (t.items > 0 && !req.ctx.can('pdv.cancelar_venda')) by = (await consumeAuthorization(db, req.ctx, b.authorization, 'cancelar_venda')).authorized_by;
    const before = (await db.query(`select id from order_items where session_id = $1 and status = 'ativo' and kitchen_status in ('novo','aceito','nao_produz')`, [s.id])).rows;
    for (const it of before) await reverseForItem(db, req.ctx, it.id, `Consumo cancelado: ${b.reason}`);
    await db.query(`update order_items set status = 'cancelado', cancel_reason = $2, canceled_by = $3, canceled_at = now(),
                      kitchen_status = case when kitchen_status = 'nao_produz' then kitchen_status else 'cancelado' end
                    where session_id = $1 and status = 'ativo'`, [s.id, `Consumo cancelado: ${b.reason}`, req.ctx.userId]);
    await db.query("update consumption_sessions set status = 'cancelada', closed_at = now(), closed_by = $2, version = version + 1 where id = $1", [s.id, req.ctx.userId]);
    if (s.table_id) await freeTableIfEmpty(db, s.table_id);
    await audit(db, req.ctx, 'consumo.cancelado', { entity: 'session', entityId: s.id, reason: b.reason, data: { items_cents: t.items, authorized_by: by } });
    return { ok: true };
  }));
}));

router.post('/sessions/:id/reopen', need('pdv.lancar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200), authorization: z.string().max(100).optional() }), req.body);
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    if (s.status !== 'encerrada') throw conflict('Só consumos encerrados podem ser reabertos');
    let by = null;
    if (!req.ctx.can('pdv.reabrir_comanda')) by = (await consumeAuthorization(db, req.ctx, b.authorization, 'reabrir_comanda')).authorized_by;
    if (s.card_id) {
      const busy = await db.query("select 1 from consumption_sessions where card_id = $1 and status in ('aberta','em_fechamento') and id <> $2", [s.card_id, s.id]);
      if (busy.rows[0]) throw conflict('O cartão já está em uso por outro consumo. Transfira os itens em vez de reabrir.', 'card_busy');
    }
    // Documentos fiscais emitidos nunca são sobrescritos (módulo fiscal registra a pendência)
    await db.query("update consumption_sessions set status = 'aberta', closed_at = null, closed_by = null, version = version + 1 where id = $1", [s.id]);
    await reverseEarn(db, req.ctx, s.id, 'Consumo reaberto');
    if (s.table_id) await db.query("update dining_tables set status = 'ocupada' where id = $1", [s.table_id]);
    await audit(db, req.ctx, 'consumo.reaberto', { entity: 'session', entityId: s.id, reason: b.reason, data: { authorized_by: by } });
    return { ok: true };
  }));
}));

// ---- Pagamentos ----
async function openCashFor(db, ctx, unitId) {
  const params = [ctx.companyId];
  let where = "company_id = $1 and status = 'aberto'";
  if (ctx.terminalId) { params.push(ctx.terminalId); where += ` and terminal_id = $${params.length}`; }
  else { params.push(ctx.userId, unitId); where += ` and user_id = $${params.length - 1} and unit_id = $${params.length} and terminal_id is null`; }
  return (await db.query(`select * from cash_sessions where ${where} order by id desc limit 1`, params)).rows[0];
}

const payInput = z.object({
  method: z.enum(['dinheiro', 'pix', 'debito', 'credito', 'vale', 'outro']),
  amount_cents: z.number().int().positive().max(100000000),
  tendered_cents: z.number().int().positive().max(100000000).optional(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
});

router.post('/sessions/:id/payments', need('pdv.receber'), h(async (req, res) => {
  const b = parse(payInput, req.body);
  const ctx = req.ctx;
  const prev = await q('select * from payments where company_id = $1 and idempotency_key = $2', [ctx.companyId, b.idempotency_key]);
  if (prev.rows[0]) return res.json({ payment: prev.rows[0], replay: true, totals: await sessionTotals({ query: q }, prev.rows[0].session_id) });
  const out = await tx(async (db) => {
    const s = await lockSession(db, ctx.companyId, Number(req.params.id));
    assertUnitScope(ctx, s.unit_id);
    if (!['aberta', 'em_fechamento'].includes(s.status)) throw conflict('Consumo encerrado', 'session_not_open');
    const st = await pdvSettings(db, ctx, s.unit_id);
    const cash = await openCashFor(db, ctx, s.unit_id);
    if (!cash && st.require_open_cash) throw conflict('Abra o caixa antes de receber', 'cash_closed');
    const t = await sessionTotals(db, s.id);
    if (b.amount_cents > t.balance) throw bad(`Valor maior que o saldo (${(t.balance / 100).toFixed(2)})`, 'over_balance');
    let change = 0;
    if (b.tendered_cents != null) {
      if (b.method !== 'dinheiro') throw bad('Troco só é permitido em dinheiro', 'change_not_allowed');
      if (b.tendered_cents < b.amount_cents) throw bad('Valor entregue menor que o valor a pagar');
      change = b.tendered_cents - b.amount_cents;
    }
    const { day_cutoff, timezone } = await unitCutoff(db, ctx.companyId, s.unit_id);
    const p = (await db.query(
      `insert into payments (company_id, session_id, cash_session_id, method, amount_cents, tendered_cents, change_cents, business_date, idempotency_key, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [ctx.companyId, s.id, cash?.id ?? null, b.method, b.amount_cents, b.tendered_cents ?? null, change,
        businessDate(new Date(), timezone, day_cutoff), b.idempotency_key, ctx.userId])).rows[0];
    await db.query('update consumption_sessions set version = version + 1 where id = $1', [s.id]);
    await audit(db, ctx, 'pagamento.registrado', { entity: 'payment', entityId: p.id, unitId: s.unit_id, data: { session: s.id, method: b.method, amount_cents: b.amount_cents, change_cents: change } });
    return { payment: p, totals: await sessionTotals(db, s.id) };
  }).catch(async (e) => {
    if (e.code === '23505') {
      const again = await q('select * from payments where company_id = $1 and idempotency_key = $2', [ctx.companyId, b.idempotency_key]);
      if (again.rows[0]) return { payment: again.rows[0], replay: true, totals: await sessionTotals({ query: q }, again.rows[0].session_id) };
    }
    throw e;
  });
  res.status(out.replay ? 200 : 201).json(out);
}));

router.post('/payments/:id/refund', need('financeiro.estornar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  res.json(await tx(async (db) => {
    const p = (await db.query('select * from payments where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!p) throw notFound('Pagamento não encontrado');
    const s = await lockSession(db, req.ctx.companyId, p.session_id);
    if (!['aberta', 'em_fechamento'].includes(s.status)) throw conflict('Reabra o consumo antes de estornar', 'session_closed');
    const r = await db.query(`update payments set status = 'estornado', refund_reason = $2, refunded_by = $3, refunded_at = now()
                              where id = $1 and status = 'confirmado' returning id`, [p.id, b.reason, req.ctx.userId]);
    if (!r.rows[0]) throw conflict('Pagamento já estornado');
    await db.query('update consumption_sessions set version = version + 1 where id = $1', [s.id]);
    await reverseRedeemByPayment(db, req.ctx, p.id);
    await audit(db, req.ctx, 'pagamento.estornado', { entity: 'payment', entityId: p.id, reason: b.reason, data: { amount_cents: p.amount_cents, method: p.method } });
    return { ok: true, totals: await sessionTotals(db, s.id) };
  }));
}));

// ---- Envio por lote à produção: itens aguardando confirmação entram na fila de uma vez ----
router.post('/sessions/:id/send', need('pdv.lancar'), h(async (req, res) => {
  res.json(await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, Number(req.params.id));
    assertUnitScope(req.ctx, s.unit_id);
    const r = await db.query(`update order_items set sent_at = now() where session_id = $1 and status = 'ativo' and sent_at is null
      and kitchen_status = 'novo' returning id`, [s.id]);
    if (r.rowCount) await audit(db, req.ctx, 'producao.lote_enviado', { entity: 'session', entityId: s.id, data: { items: r.rowCount } });
    return { sent: r.rowCount };
  }));
}));

// ---- Troca de modo de leitura (auditada) ----
router.post('/mode', need('pdv.lancar'), h(async (req, res) => {
  const b = parse(z.object({ from: z.enum(['manual', 'continua', 'dupla']), to: z.enum(['manual', 'continua', 'dupla']), reason: z.string().trim().max(200).optional() }), req.body);
  const st = await pdvSettings({ query: q }, req.ctx, req.ctx.terminalUnitId || req.ctx.unitId);
  if (b.from !== b.to) {
    assertCan(req.ctx, 'pdv.alterar_modo');
    if (!st.allow_mode_change) throw forbidden('Troca de modo desabilitada nesta configuração', 'mode_locked');
    if (st.double_read_mandatory && b.to !== 'dupla') throw forbidden('Dupla leitura obrigatória: use a exceção autorizada', 'double_read_required');
    if (!st.scanner_enabled && b.to !== 'manual') throw forbidden('Leitor desabilitado', 'scanner_disabled');
  }
  await audit({ query: q }, req.ctx, 'pdv.modo_alterado', { reason: b.reason, data: { from: b.from, to: b.to } });
  res.json({ ok: true, mode: b.to });
}));

export { normalizeCode };
