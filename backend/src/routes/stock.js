// Estoque: insumos, saldos, movimentos, fichas técnicas versionadas, compras com recebimento parcial,
// inventário com aprovação, produção própria, perdas e sugestão de compra.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict } from '../lib/core.js';
import { need, audit, assertCan, rateLimit } from '../lib/auth.js';
import { readImage, matchLines, aliasKey, aiAvailable } from '../lib/notes.js';
import { balances, receive, theoreticalCost, requirements, stockConfig } from '../lib/stock.js';

export const router = Router();
const UNITS = ['un', 'kg', 'g', 'L', 'ml'];
const qtyNum = z.number().positive().max(1000000);

router.get('/items', need('estoque.visualizar'), h(async (req, res) => {
  const rows = (await q(`select s.*, (select coalesce(sum(qty),0) from stock_movements m where m.stock_item_id = s.id)::float as balance,
      (select coalesce(-sum(qty),0) from stock_movements m where m.stock_item_id = s.id and m.kind = 'venda' and m.created_at > now() - interval '30 days')::float as used_30d
    from stock_items s where s.company_id = $1 ${req.query.all ? '' : 'and s.active'} order by lower(s.name)`, [req.ctx.companyId])).rows;
  const showCost = req.ctx.can('relatorios.cmv') || req.ctx.can('compras.gerenciar');
  res.json(rows.map((r) => ({ ...r, avg_cost_cents: showCost ? Number(r.avg_cost_cents) : null,
    status: r.balance <= 0 ? 'zerado' : r.balance <= Number(r.min_qty) ? 'baixo' : 'ok',
    // sugestão de compra: repor até o ponto de reposição + consumo médio de 7 dias
    suggest: Math.max(0, Math.ceil((Number(r.reorder_qty) || Number(r.min_qty) * 2) + (r.used_30d / 30) * 7 - r.balance)) })));
}));

const itemSchema = z.object({
  name: z.string().trim().min(2).max(80), unit: z.enum(UNITS),
  min_qty: z.number().min(0).max(1000000).default(0), reorder_qty: z.number().min(0).max(1000000).default(0),
  active: z.boolean().default(true),
});
router.post('/items', need('estoque.ajustar'), h(async (req, res) => {
  const b = parse(itemSchema.extend({ initial_qty: z.number().min(0).max(1000000).optional(), unit_cost_cents: z.number().int().min(0).max(100000000).optional() }), req.body);
  const id = await tx(async (db) => {
    const r = await db.query('insert into stock_items (company_id, name, unit, min_qty, reorder_qty, active) values ($1,$2,$3,$4,$5,$6) returning id',
      [req.ctx.companyId, b.name, b.unit, b.min_qty, b.reorder_qty, b.active]).catch((e) => { if (e.code === '23505') throw conflict('Já existe insumo com este nome'); throw e; });
    if (b.initial_qty) await receive(db, req.ctx, r.rows[0].id, b.initial_qty, b.unit_cost_cents || 0, { type: 'saldo_inicial' }, 'Saldo inicial');
    await audit(db, req.ctx, 'estoque.insumo_criado', { entity: 'stock_item', entityId: r.rows[0].id, data: { name: b.name, initial: b.initial_qty } });
    return r.rows[0].id;
  });
  res.status(201).json({ id });
}));
router.put('/items/:id', need('estoque.ajustar'), h(async (req, res) => {
  const b = parse(itemSchema.partial(), req.body);
  const r = await q(`update stock_items set name = coalesce($3,name), unit = coalesce($4,unit), min_qty = coalesce($5,min_qty), reorder_qty = coalesce($6,reorder_qty),
      active = coalesce($7,active) where id = $1 and company_id = $2 returning id`,
  [Number(req.params.id), req.ctx.companyId, b.name ?? null, b.unit ?? null, b.min_qty ?? null, b.reorder_qty ?? null, b.active ?? null]);
  if (!r.rows[0]) throw notFound('Insumo não encontrado');
  res.json({ ok: true });
}));

router.get('/items/:id/movements', need('estoque.visualizar'), h(async (req, res) => {
  res.json((await q(`select m.id, m.kind, m.qty::float, m.unit_cost_cents, m.ref_type, m.ref_id, m.reverses_id, m.reason, m.created_at, u.name as user_name
     from stock_movements m left join users u on u.id = m.user_id where m.company_id = $1 and m.stock_item_id = $2 order by m.id desc limit 200`,
  [req.ctx.companyId, Number(req.params.id)])).rows);
}));

// Entrada avulsa, perda ou ajuste (com motivo). Ajuste/perda nunca editam movimentos: criam novos.
router.post('/movements', need('estoque.ajustar'), h(async (req, res) => {
  const b = parse(z.object({ stock_item_id: z.number().int(), kind: z.enum(['entrada', 'perda', 'ajuste']), qty: z.number().refine((n) => n !== 0 && Math.abs(n) <= 1000000),
    unit_cost_cents: z.number().int().min(0).max(100000000).optional(), reason: z.string().trim().min(3).max(200) }), req.body);
  const out = await tx(async (db) => {
    const s = (await db.query('select * from stock_items where id = $1 and company_id = $2 for update', [b.stock_item_id, req.ctx.companyId])).rows[0];
    if (!s) throw notFound('Insumo não encontrado');
    if (b.kind === 'entrada') {
      if (b.qty <= 0) throw bad('Entrada deve ser positiva');
      await receive(db, req.ctx, s.id, b.qty, b.unit_cost_cents ?? Math.round(Number(s.avg_cost_cents)), { type: 'manual' }, b.reason);
    } else {
      const qty = b.kind === 'perda' ? -Math.abs(b.qty) : b.qty;
      await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reason, user_id) values ($1,$2,$3,$4,$5,$6,$7)`,
        [req.ctx.companyId, s.id, b.kind, qty, s.avg_cost_cents, b.reason, req.ctx.userId]);
    }
    await audit(db, req.ctx, `estoque.${b.kind}`, { entity: 'stock_item', entityId: s.id, reason: b.reason, data: { qty: b.qty } });
    return { balance: (await balances(db, req.ctx.companyId, [s.id]))[s.id] || 0 };
  });
  res.status(201).json(out);
}));

// Reversão de um movimento manual (vinculada ao original, uma única vez)
router.post('/movements/:id/reverse', need('estoque.ajustar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  const out = await tx(async (db) => {
    const m = (await db.query('select * from stock_movements where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!m) throw notFound('Movimento não encontrado');
    if (!['entrada', 'perda', 'ajuste'].includes(m.kind) || m.reverses_id) throw conflict('Este movimento é revertido pelo fluxo de origem (venda, compra ou inventário)');
    await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, reverses_id, reason, user_id) values ($1,$2,'reversao',$3,$4,$5,$6,$7)`,
      [req.ctx.companyId, m.stock_item_id, -Number(m.qty), m.unit_cost_cents, m.id, b.reason, req.ctx.userId])
      .catch((e) => { if (e.code === '23505') throw conflict('Movimento já revertido'); throw e; });
    await audit(db, req.ctx, 'estoque.reversao', { entity: 'stock_movement', entityId: m.id, reason: b.reason });
    return { ok: true };
  });
  res.json(out);
}));

// ---- Fichas técnicas ----
router.get('/recipes', need('estoque.visualizar'), h(async (req, res) => {
  const products = (await q(`select p.id, p.name, p.price_cents, p.cost_cents, p.stock_mode, p.stock_item_id, p.kind, si.name as stock_item_name,
      r.id as recipe_id, r.version, r.yield_qty::float
    from products p left join recipes r on r.product_id = p.id and r.active left join stock_items si on si.id = p.stock_item_id
    where p.company_id = $1 and p.active order by p.name`, [req.ctx.companyId])).rows;
  const lines = (await q(`select l.recipe_id, l.stock_item_id, l.qty::float, l.loss_pct::float, s.name, s.unit from recipe_lines l join stock_items s on s.id = l.stock_item_id
    where l.company_id = $1 and l.recipe_id = any($2)`, [req.ctx.companyId, products.map((p) => p.recipe_id).filter(Boolean)])).rows;
  const showCost = req.ctx.can('relatorios.cmv') || req.ctx.can('compras.gerenciar');
  const out = [];
  for (const p of products) {
    const cost = showCost ? await theoreticalCost({ query: q }, req.ctx.companyId, p) : null;
    out.push({ ...p, lines: lines.filter((l) => l.recipe_id === p.recipe_id), theoretical_cost_cents: cost,
      margin_pct: cost != null && p.price_cents ? Math.round(((p.price_cents - cost) / p.price_cents) * 1000) / 10 : null });
  }
  res.json(out);
}));

router.get('/recipes/:productId/history', need('estoque.visualizar'), h(async (req, res) => {
  res.json((await q(`select r.id, r.version, r.yield_qty::float, r.active, r.created_at, u.name as user_name,
      (select json_agg(json_build_object('name', s.name, 'qty', l.qty, 'unit', s.unit, 'loss_pct', l.loss_pct)) from recipe_lines l join stock_items s on s.id = l.stock_item_id where l.recipe_id = r.id) as lines
    from recipes r left join users u on u.id = r.created_by where r.company_id = $1 and r.product_id = $2 order by r.version desc`, [req.ctx.companyId, Number(req.params.productId)])).rows);
}));

/* Define a estratégia do produto e, para ficha técnica, grava NOVA versão (a anterior fica no histórico). */
router.put('/recipes/:productId', need('estoque.ajustar'), h(async (req, res) => {
  const b = parse(z.object({
    stock_mode: z.enum(['nenhum', 'ficha', 'acabado']),
    stock_item_id: z.number().int().nullable().optional(),
    yield_qty: z.number().positive().max(10000).default(1),
    lines: z.array(z.object({ stock_item_id: z.number().int(), qty: z.number().positive().max(100000), loss_pct: z.number().min(0).max(99).default(0) })).max(60).default([]),
    notes: z.string().max(300).optional(),
  }), req.body);
  const pid = Number(req.params.productId);
  const out = await tx(async (db) => {
    const p = (await db.query('select * from products where id = $1 and company_id = $2 for update', [pid, req.ctx.companyId])).rows[0];
    if (!p) throw notFound('Produto não encontrado');
    const ids = [...new Set([...(b.lines.map((l) => l.stock_item_id)), ...(b.stock_item_id ? [b.stock_item_id] : [])])];
    if (ids.length) {
      const ok = (await db.query('select count(*)::int as n from stock_items where company_id = $1 and id = any($2)', [req.ctx.companyId, ids])).rows[0].n;
      if (ok !== ids.length) throw bad('Insumo inválido');
    }
    if (b.stock_mode === 'acabado' && !b.stock_item_id) throw bad('Escolha o item de estoque do produto acabado');
    if (b.stock_mode === 'ficha' && !b.lines.length) throw bad('A ficha técnica precisa de ao menos um insumo');
    if (new Set(b.lines.map((l) => l.stock_item_id)).size !== b.lines.length) throw bad('Insumo repetido na ficha');
    await db.query('update products set stock_mode = $3, stock_item_id = $4, updated_at = now() where id = $1 and company_id = $2',
      [pid, req.ctx.companyId, b.stock_mode, b.stock_mode === 'acabado' ? b.stock_item_id : null]);
    let version = null;
    // "acabado" pode ter ficha de produção (usada na produção própria, não na venda)
    if (b.lines.length && b.stock_mode !== 'nenhum') {
      version = Number((await db.query('select coalesce(max(version),0) as v from recipes where product_id = $1', [pid])).rows[0].v) + 1;
      await db.query('update recipes set active = false where product_id = $1 and active', [pid]);
      const r = await db.query('insert into recipes (company_id, product_id, version, yield_qty, notes, created_by) values ($1,$2,$3,$4,$5,$6) returning id',
        [req.ctx.companyId, pid, version, b.yield_qty, b.notes ?? null, req.ctx.userId]);
      for (const l of b.lines) await db.query('insert into recipe_lines (company_id, recipe_id, stock_item_id, qty, loss_pct) values ($1,$2,$3,$4,$5)',
        [req.ctx.companyId, r.rows[0].id, l.stock_item_id, l.qty, l.loss_pct]);
    } else {
      await db.query('update recipes set active = false where product_id = $1 and active', [pid]);
    }
    // custo do produto passa a refletir a ficha (base de margem e CMV teórico)
    const cost = await theoreticalCost(db, req.ctx.companyId, { ...p, stock_mode: b.stock_mode, stock_item_id: b.stock_mode === 'acabado' ? b.stock_item_id : null });
    if (b.stock_mode !== 'nenhum') await db.query('update products set cost_cents = $3 where id = $1 and company_id = $2', [pid, req.ctx.companyId, cost]);
    await audit(db, req.ctx, 'estoque.ficha', { entity: 'product', entityId: pid, data: { mode: b.stock_mode, version, lines: b.lines.length } });
    return { ok: true, version, cost_cents: cost };
  });
  res.json(out);
}));

// ---- Compras ----
router.get('/purchases', need('estoque.visualizar'), h(async (req, res) => {
  const rows = (await q(`select p.*, u.name as user_name,
      (select json_agg(json_build_object('id', l.id, 'stock_item_id', l.stock_item_id, 'name', s.name, 'unit', s.unit, 'qty', l.qty, 'received_qty', l.received_qty,
         'unit_cost_cents', l.unit_cost_cents) order by l.id) from purchase_lines l join stock_items s on s.id = l.stock_item_id where l.purchase_id = p.id) as lines
    from purchases p left join users u on u.id = p.created_by where p.company_id = $1 order by p.id desc limit 100`, [req.ctx.companyId])).rows;
  res.json(rows);
}));

router.post('/purchases', need('compras.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ supplier: z.string().trim().min(2).max(100), document: z.string().trim().max(60).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), notes: z.string().max(300).optional(),
    lines: z.array(z.object({ stock_item_id: z.number().int(), qty: qtyNum, unit_cost_cents: z.number().int().min(0).max(100000000) })).min(1).max(100) }), req.body);
  const id = await tx(async (db) => {
    const ids = [...new Set(b.lines.map((l) => l.stock_item_id))];
    const ok = (await db.query('select count(*)::int as n from stock_items where company_id = $1 and id = any($2)', [req.ctx.companyId, ids])).rows[0].n;
    if (ok !== ids.length) throw bad('Insumo inválido');
    const total = b.lines.reduce((s, l) => s + Math.round(l.qty * l.unit_cost_cents), 0);
    const r = await db.query('insert into purchases (company_id, supplier, document, due_date, notes, total_cents, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id',
      [req.ctx.companyId, b.supplier, b.document ?? null, b.due_date ?? null, b.notes ?? null, total, req.ctx.userId]);
    for (const l of b.lines) await db.query('insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5)',
      [req.ctx.companyId, r.rows[0].id, l.stock_item_id, l.qty, l.unit_cost_cents]);
    await audit(db, req.ctx, 'compra.criada', { entity: 'purchase', entityId: r.rows[0].id, data: { supplier: b.supplier, total_cents: total } });
    return r.rows[0].id;
  });
  res.status(201).json({ id });
}));

// Recebimento (parcial ou total): gera entradas e atualiza custo médio
router.post('/purchases/:id/receive', need('compras.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ lines: z.array(z.object({ line_id: z.number().int(), qty: qtyNum })).min(1).max(100) }), req.body);
  const out = await tx(async (db) => {
    const p = (await db.query('select * from purchases where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!p) throw notFound('Compra não encontrada');
    if (['recebida', 'cancelada'].includes(p.status)) throw conflict(`Compra ${p.status}`);
    for (const r of b.lines) {
      const l = (await db.query('select * from purchase_lines where id = $1 and purchase_id = $2 for update', [r.line_id, p.id])).rows[0];
      if (!l) throw bad('Linha inválida');
      if (Number(l.received_qty) + r.qty > Number(l.qty) + 0.0001) throw bad('Quantidade recebida maior que a comprada');
      await db.query('update purchase_lines set received_qty = received_qty + $2 where id = $1', [l.id, r.qty]);
      await receive(db, req.ctx, l.stock_item_id, r.qty, Number(l.unit_cost_cents), { type: 'purchase', id: p.id }, `Compra ${p.id} — ${p.supplier}`);
    }
    const left = (await db.query('select count(*)::int as n from purchase_lines where purchase_id = $1 and received_qty < qty', [p.id])).rows[0].n;
    const status = left ? 'parcial' : 'recebida';
    await db.query('update purchases set status = $2 where id = $1', [p.id, status]);
    await audit(db, req.ctx, 'compra.recebida', { entity: 'purchase', entityId: p.id, data: { status, lines: b.lines.length } });
    return { status };
  });
  res.json(out);
}));

router.post('/purchases/:id/cancel', need('compras.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  const r = await q(`update purchases set status = 'cancelada', notes = coalesce(notes,'') || ' [cancelada: ' || $3 || ']' where id = $1 and company_id = $2 and status = 'aberta' returning id`,
    [Number(req.params.id), req.ctx.companyId, b.reason]);
  if (!r.rows[0]) throw conflict('Só compras ainda não recebidas podem ser canceladas');
  await audit({ query: q }, req.ctx, 'compra.cancelada', { entity: 'purchase', entityId: r.rows[0].id, reason: b.reason });
  res.json({ ok: true });
}));

// ---- Inventário: contagem → divergências → aprovação (gera ajustes) ----
router.get('/inventories', need('estoque.visualizar'), h(async (req, res) => {
  res.json((await q(`select i.*, u.name as user_name, a.name as approved_name from inventory_counts i left join users u on u.id = i.created_by
    left join users a on a.id = i.approved_by where i.company_id = $1 order by i.id desc limit 30`, [req.ctx.companyId])).rows);
}));
router.post('/inventories', need('estoque.ajustar'), h(async (req, res) => {
  const b = parse(z.object({ counts: z.array(z.object({ stock_item_id: z.number().int(), counted: z.number().min(0).max(1000000) })).min(1).max(500), notes: z.string().max(300).optional() }), req.body);
  const bal = await balances({ query: q }, req.ctx.companyId, b.counts.map((c) => c.stock_item_id));
  const names = Object.fromEntries((await q('select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2)', [req.ctx.companyId, b.counts.map((c) => c.stock_item_id)])).rows.map((r) => [r.id, r]));
  const lines = b.counts.filter((c) => names[c.stock_item_id]).map((c) => {
    const system = Math.round((bal[c.stock_item_id] || 0) * 1000) / 1000;
    const diff = Math.round((c.counted - system) * 1000) / 1000;
    return { stock_item_id: c.stock_item_id, name: names[c.stock_item_id].name, unit: names[c.stock_item_id].unit, system, counted: c.counted, diff,
      value_cents: Math.round(diff * Number(names[c.stock_item_id].avg_cost_cents)) };
  });
  const r = await q('insert into inventory_counts (company_id, lines, notes, created_by) values ($1,$2,$3,$4) returning id', [req.ctx.companyId, JSON.stringify(lines), b.notes ?? null, req.ctx.userId]);
  res.status(201).json({ id: r.rows[0].id, lines });
}));
router.post('/inventories/:id/approve', need('estoque.ajustar'), h(async (req, res) => {
  assertCan(req.ctx, 'pdv.autorizar'); // aprovação é gerencial
  const out = await tx(async (db) => {
    const inv = (await db.query("select * from inventory_counts where id = $1 and company_id = $2 and status = 'aberto' for update", [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!inv) throw conflict('Inventário não está aberto');
    if (Number(inv.created_by) === Number(req.ctx.userId) && req.ctx.level < 100) throw conflict('A aprovação deve ser feita por outra pessoa', 'same_user');
    // recalcula com o saldo atual: vendas feitas desde a contagem não são apagadas
    const bal = await balances(db, req.ctx.companyId, inv.lines.map((l) => l.stock_item_id));
    let n = 0;
    for (const l of inv.lines) {
      const sinceCount = Math.round(((bal[l.stock_item_id] || 0) - l.system) * 1000) / 1000;
      const adj = Math.round((l.counted + sinceCount - (bal[l.stock_item_id] || 0)) * 1000) / 1000;
      if (Math.abs(adj) < 0.0005) continue;
      await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
        select $1, id, 'inventario', $3, avg_cost_cents, 'inventory', $4, 'Inventário aprovado', $5 from stock_items where id = $2 and company_id = $1`,
      [req.ctx.companyId, l.stock_item_id, adj, inv.id, req.ctx.userId]);
      n++;
    }
    await db.query("update inventory_counts set status = 'aprovado', approved_by = $2, approved_at = now() where id = $1", [inv.id, req.ctx.userId]);
    await audit(db, req.ctx, 'estoque.inventario_aprovado', { entity: 'inventory', entityId: inv.id, data: { adjustments: n } });
    return { adjustments: n };
  });
  res.json(out);
}));
router.post('/inventories/:id/discard', need('estoque.ajustar'), h(async (req, res) => {
  const r = await q("update inventory_counts set status = 'descartado' where id = $1 and company_id = $2 and status = 'aberto' returning id", [Number(req.params.id), req.ctx.companyId]);
  if (!r.rows[0]) throw conflict('Inventário não está aberto');
  res.json({ ok: true });
}));

// ---- Produção própria: consome a ficha do produto e dá entrada no item acabado ----
router.post('/produce', need('estoque.ajustar'), h(async (req, res) => {
  const b = parse(z.object({ product_id: z.number().int(), qty: qtyNum }), req.body);
  const out = await tx(async (db) => {
    const p = (await db.query('select * from products where id = $1 and company_id = $2', [b.product_id, req.ctx.companyId])).rows[0];
    if (!p) throw notFound('Produto não encontrado');
    if (p.stock_mode !== 'acabado') throw bad('Produção própria vale para produtos com estoque de produto acabado');
    const recipe = (await db.query('select id from recipes where product_id = $1 and active', [p.id])).rows[0];
    if (!recipe) throw bad('Cadastre a ficha de produção (insumos) deste produto acabado antes de produzir');
    const need = await requirements(db, req.ctx.companyId, { ...p, stock_mode: 'ficha' }, b.qty);
    const items = (await db.query('select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2) for update', [req.ctx.companyId, [...need.keys()]])).rows;
    let cost = 0;
    for (const s of items) {
      const qn = need.get(Number(s.id));
      cost += qn * Number(s.avg_cost_cents);
      await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
        values ($1,$2,'producao_consumo',$3,$4,'production',$5,$6,$7)`, [req.ctx.companyId, s.id, -qn, s.avg_cost_cents, p.id, `Produção de ${b.qty} ${p.name}`, req.ctx.userId]);
    }
    await receive(db, req.ctx, p.stock_item_id, b.qty, Math.round(cost / b.qty), { type: 'production', id: p.id }, `Produção de ${p.name}`);
    await audit(db, req.ctx, 'estoque.producao', { entity: 'product', entityId: p.id, data: { qty: b.qty, cost_cents: Math.round(cost) } });
    return { ok: true, cost_cents: Math.round(cost) };
  });
  res.json(out);
}));

router.get('/settings', need('estoque.visualizar'), h(async (req, res) => {
  const c = (await q('select settings from companies where id = $1', [req.ctx.companyId])).rows[0];
  res.json(stockConfig(c.settings));
}));
router.put('/settings', need('configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ enabled: z.boolean(), allow_negative: z.boolean() }), req.body);
  await q(`update companies set settings = jsonb_set(settings, '{stock}', $2::jsonb) where id = $1`, [req.ctx.companyId, JSON.stringify(b)]);
  await audit({ query: q }, req.ctx, 'estoque.politica', { data: b });
  res.json({ ok: true });
}));

// ---- Leitura de notas: foto (IA de visão) ou XML da NF-e → conferência → compra recebida no estoque ----
router.get('/notes/status', need('compras.gerenciar'), h(async (req, res) => {
  const own = (await q("select 1 from company_secrets where company_id = $1 and key = 'ai_api_key'", [req.ctx.companyId])).rows[0];
  res.json({ photo: await aiAvailable(req.ctx.companyId), own_key: !!own });
}));

router.put('/notes/key', need('compras.gerenciar', 'configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ api_key: z.string().trim().max(300) }), req.body);
  if (b.api_key && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(b.api_key)) throw bad('Chave inválida: ela começa com "sk-ant-"');
  if (!b.api_key) await q("delete from company_secrets where company_id = $1 and key = 'ai_api_key'", [req.ctx.companyId]);
  else await q(`insert into company_secrets (company_id, key, value) values ($1,'ai_api_key',$2) on conflict (company_id, key) do update set value = excluded.value, updated_at = now()`, [req.ctx.companyId, b.api_key]);
  await audit({ query: q }, req.ctx, 'estoque.leitura_chave', { data: { removed: !b.api_key } });
  res.json({ ok: true });
}));

router.post('/notes/read', need('compras.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ image: z.string().max(9_000_000) }), req.body);
  await rateLimit(`notes:${req.ctx.companyId}`, 60, 3600);
  const doc = await readImage(req.ctx.companyId, b.image);
  res.json({ ...doc, items: await matchLines(req.ctx.companyId, doc.items) });
}));

router.post('/notes/match', need('compras.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ items: z.array(z.object({ description: z.string().max(120), qty: z.number().nullable().optional(), unit: z.string().max(10).nullable().optional(),
    unit_price: z.number().nullable().optional(), total: z.number().nullable().optional() })).max(300) }), req.body);
  res.json({ items: await matchLines(req.ctx.companyId, b.items) });
}));

router.post('/notes/confirm', need('compras.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({
    supplier: z.string().trim().min(2).max(100), document: z.string().trim().max(60).optional().nullable(), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    source: z.enum(['foto', 'xml', 'manual']), nfe_key: z.string().regex(/^\d{44}$/).optional().nullable(), receive: z.boolean().default(true),
    lines: z.array(z.object({
      description: z.string().max(120), alias: z.string().max(120).optional(),
      stock_item_id: z.number().int().optional().nullable(),
      new_item: z.object({ name: z.string().trim().min(2).max(80), unit: z.enum(['un', 'kg', 'g', 'L', 'ml']), min_qty: z.number().min(0).max(1000000).default(0) }).optional().nullable(),
      qty: z.number().positive().max(1000000), factor: z.number().positive().max(10000).default(1), unit_cost_cents: z.number().int().min(0).max(100000000),
    })).min(1).max(150),
  }), req.body);
  const out = await tx(async (db) => {
    if (b.nfe_key) {
      const dup = (await db.query("select id from purchases where company_id = $1 and nfe_key = $2 and status <> 'cancelada'", [req.ctx.companyId, b.nfe_key])).rows[0];
      if (dup) throw conflict(`Esta NF-e já foi lançada (compra #${dup.id})`, 'nfe_duplicate');
    }
    const resolved = [];
    for (const l of b.lines) {
      let id = l.stock_item_id;
      if (!id && l.new_item) {
        const ex = (await db.query('select id from stock_items where company_id = $1 and lower(name) = lower($2)', [req.ctx.companyId, l.new_item.name])).rows[0];
        id = ex?.id ?? (await db.query('insert into stock_items (company_id, name, unit, min_qty, reorder_qty) values ($1,$2,$3,$4,$5) returning id',
          [req.ctx.companyId, l.new_item.name, l.new_item.unit, l.new_item.min_qty, l.new_item.min_qty * 3])).rows[0].id;
      }
      if (!id) throw bad(`Escolha o insumo de "${l.description}" ou marque para criar`);
      const ok = (await db.query('select 1 from stock_items where id = $1 and company_id = $2', [id, req.ctx.companyId])).rows[0];
      if (!ok) throw bad('Insumo inválido');
      // quantidade e custo convertidos para a unidade do estoque (ex.: 2 caixas × 12 = 24 un)
      resolved.push({ ...l, stock_item_id: Number(id), stock_qty: Math.round(l.qty * l.factor * 1000) / 1000, stock_cost: Math.round(l.unit_cost_cents / l.factor) });
    }
    const total = b.lines.reduce((s, l) => s + Math.round(l.qty * l.unit_cost_cents), 0);
    const p = (await db.query(`insert into purchases (company_id, supplier, document, due_date, total_cents, created_by, source, nfe_key, notes)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`, [req.ctx.companyId, b.supplier, b.document ?? null, b.due_date ?? null, total, req.ctx.userId, b.source, b.nfe_key ?? null,
      ({ foto: 'Lançada pela foto da nota (conferida)', xml: 'Importada do XML da NF-e', manual: 'Nota/pedido digitado manualmente' })[b.source]])).rows[0];
    for (const l of resolved) {
      const pl = (await db.query('insert into purchase_lines (company_id, purchase_id, stock_item_id, qty, unit_cost_cents) values ($1,$2,$3,$4,$5) returning id',
        [req.ctx.companyId, p.id, l.stock_item_id, l.stock_qty, l.stock_cost])).rows[0];
      if (b.receive) {
        await db.query('update purchase_lines set received_qty = qty where id = $1', [pl.id]);
        await receive(db, req.ctx, l.stock_item_id, l.stock_qty, l.stock_cost, { type: 'purchase', id: p.id }, `Compra ${p.id} — ${b.supplier}`);
      }
      const alias = aliasKey(l.alias || l.description);
      if (alias) await db.query(`insert into stock_aliases (company_id, alias, stock_item_id, factor) values ($1,$2,$3,$4)
        on conflict (company_id, alias) do update set stock_item_id = excluded.stock_item_id, factor = excluded.factor, updated_at = now()`, [req.ctx.companyId, alias, l.stock_item_id, l.factor]);
    }
    if (b.receive) await db.query("update purchases set status = 'recebida' where id = $1", [p.id]);
    await audit(db, req.ctx, 'compra.nota_lancada', { entity: 'purchase', entityId: p.id, data: { source: b.source, lines: resolved.length, total_cents: total, received: b.receive } });
    return { purchase_id: p.id, lines: resolved.length, total_cents: total, received: b.receive };
  }).catch((e) => { if (e.code === '23505') throw conflict('Esta NF-e já foi lançada', 'nfe_duplicate'); throw e; });
  res.status(201).json(out);
}));
