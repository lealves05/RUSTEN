// Estoque: baixa por ficha técnica ou produto acabado, reversão vinculada, custo médio e saldos.
// Política operacional: a baixa acontece no lançamento do item (pedido confirmado). Cancelamento antes do preparo
// estorna; depois do preparo o consumo permanece (perda registrada na auditoria do cancelamento).
import { conflict } from './core.js';

// Política de estoque. Correção: até `correction_limit_cents` e `correction_max_pct` um gerente aplica direto;
// acima disso, ou por quem não aprova, a correção fica pendente para outra pessoa aprovar.
export const STOCK_DEFAULTS = { enabled: true, allow_negative: true, correction_limit_cents: 5000, correction_max_pct: 20, correction_expire_days: 7 };
export const stockConfig = (settings) => ({ ...STOCK_DEFAULTS, ...(settings?.stock || {}) });

export async function balances(db, companyId, ids) {
  const r = await db.query(`select stock_item_id, coalesce(sum(qty),0)::numeric as qty from stock_movements
    where company_id = $1 ${ids ? 'and stock_item_id = any($2)' : ''} group by stock_item_id`, ids ? [companyId, ids] : [companyId]);
  return Object.fromEntries(r.rows.map((x) => [x.stock_item_id, Number(x.qty)]));
}

const round4 = (n) => Math.round(n * 10000) / 10000;

/* Necessidade de insumos para vender `qty` unidades do produto (com opções escolhidas). */
export async function requirements(db, companyId, product, qty, optionIds = []) {
  const need = new Map();
  const add = (id, n) => need.set(Number(id), round4((need.get(Number(id)) || 0) + n));
  if (product.stock_mode === 'acabado' && product.stock_item_id) add(product.stock_item_id, Number(qty));
  if (product.stock_mode === 'ficha') {
    const lines = (await db.query(`select l.stock_item_id, l.qty, l.loss_pct, r.yield_qty from recipes r join recipe_lines l on l.recipe_id = r.id
      where r.company_id = $1 and r.product_id = $2 and r.active`, [companyId, product.id])).rows;
    for (const l of lines) add(l.stock_item_id, (Number(l.qty) * (1 + Number(l.loss_pct) / 100) / Number(l.yield_qty)) * Number(qty));
  }
  if (optionIds.length) {
    const ops = (await db.query('select stock_item_id, stock_qty from modifier_options where company_id = $1 and id = any($2) and stock_item_id is not null and stock_qty > 0',
      [companyId, optionIds])).rows;
    for (const o of ops) add(o.stock_item_id, Number(o.stock_qty) * Number(qty));
  }
  return need;
}

export async function consumeForItem(db, ctx, item, product, optionIds) {
  const c = (await db.query('select settings from companies where id = $1', [ctx.companyId])).rows[0];
  const cfg = stockConfig(c.settings);
  if (!cfg.enabled) return [];
  const need = await requirements(db, ctx.companyId, product, item.qty, optionIds);
  if (!need.size) return [];
  const ids = [...need.keys()];
  // trava os insumos para que dois lançamentos simultâneos não furem a política de estoque negativo
  const items = (await db.query('select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2) order by id for update', [ctx.companyId, ids])).rows;
  if (!cfg.allow_negative) {
    const bal = await balances(db, ctx.companyId, ids);
    for (const s of items) {
      if ((bal[s.id] || 0) - need.get(Number(s.id)) < -0.0001)
        throw conflict(`Estoque insuficiente de ${s.name} (saldo ${(bal[s.id] || 0).toLocaleString('pt-BR')} ${s.unit})`, 'stock_insufficient');
    }
  }
  const out = [];
  for (const s of items) {
    const r = await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, user_id)
      values ($1,$2,'venda',$3,$4,'order_item',$5,$6) on conflict do nothing returning id`,
    [ctx.companyId, s.id, -need.get(Number(s.id)), s.avg_cost_cents, item.id, ctx.userId]);
    if (r.rows[0]) out.push(r.rows[0].id);
  }
  return out;
}

// Estorno da baixa de um item (uma única vez por movimento original)
export async function reverseForItem(db, ctx, itemId, reason) {
  const mv = (await db.query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'order_item' and m.ref_id = $2 and m.kind = 'venda'
    and not exists (select 1 from stock_movements r where r.reverses_id = m.id)`, [ctx.companyId, itemId])).rows;
  for (const m of mv) {
    await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
      values ($1,$2,'estorno_venda',$3,$4,'order_item_rev',$5,$6,$7,$8)`,
    [ctx.companyId, m.stock_item_id, -Number(m.qty), m.unit_cost_cents, itemId, m.id, reason, ctx.userId]);
  }
  return mv.length;
}

// Entrada com custo: atualiza o custo médio ponderado
export async function receive(db, ctx, stockItemId, qty, unitCostCents, ref, reason) {
  const s = (await db.query('select avg_cost_cents from stock_items where id = $1 and company_id = $2 for update', [stockItemId, ctx.companyId])).rows[0];
  const bal = (await balances(db, ctx.companyId, [stockItemId]))[stockItemId] || 0;
  const prevQty = Math.max(0, bal);
  const avg = prevQty + qty > 0 ? (prevQty * Number(s.avg_cost_cents) + qty * unitCostCents) / (prevQty + qty) : unitCostCents;
  await db.query('update stock_items set avg_cost_cents = $3 where id = $1 and company_id = $2', [stockItemId, ctx.companyId, round4(avg)]);
  await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
    values ($1,$2,'entrada',$3,$4,$5,$6,$7,$8)`, [ctx.companyId, stockItemId, qty, unitCostCents, ref?.type ?? null, ref?.id ?? null, reason ?? null, ctx.userId]);
}

// Custo teórico de uma unidade do produto pela ficha vigente (centavos, com 2 casas)
export async function theoreticalCost(db, companyId, product) {
  const need = await requirements(db, companyId, product, 1, []);
  if (!need.size) return Number(product.cost_cents || 0);
  const r = (await db.query('select id, avg_cost_cents from stock_items where company_id = $1 and id = any($2)', [companyId, [...need.keys()]])).rows;
  return Math.round(r.reduce((s, x) => s + Number(x.avg_cost_cents) * need.get(Number(x.id)), 0));
}
