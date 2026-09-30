// Cardápio: categorias, setores de produção, produtos, códigos de leitura e modificadores.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict } from '../lib/core.js';
import { need, audit } from '../lib/auth.js';
import { registerCode, normalizeCode } from '../lib/pdv.js';

export const router = Router();

router.get('/categories', need('cardapio.visualizar'), h(async (req, res) => {
  res.json((await q('select id, name, sort, active, demo from categories where company_id = $1 order by sort, name', [req.ctx.companyId])).rows);
}));
router.post('/categories', need('cardapio.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), sort: z.number().int().default(0) }), req.body);
  const r = await q('insert into categories (company_id, name, sort) values ($1,$2,$3) returning id', [req.ctx.companyId, b.name, b.sort]);
  res.status(201).json({ id: r.rows[0].id });
}));
router.put('/categories/:id', need('cardapio.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(1).max(80), sort: z.number().int(), active: z.boolean() }).partial(), req.body);
  const r = await q('update categories set name = coalesce($3,name), sort = coalesce($4,sort), active = coalesce($5,active) where id = $1 and company_id = $2 returning id',
    [Number(req.params.id), req.ctx.companyId, b.name ?? null, b.sort ?? null, b.active ?? null]);
  if (!r.rows[0]) throw notFound();
  res.json({ ok: true });
}));

router.get('/sectors', h(async (req, res) => {
  res.json((await q('select id, name, active from production_sectors where company_id = $1 order by id', [req.ctx.companyId])).rows);
}));
router.post('/sectors', need('cardapio.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(2).max(60) }), req.body);
  const r = await q('insert into production_sectors (company_id, name) values ($1,$2) returning id', [req.ctx.companyId, b.name]);
  res.status(201).json({ id: r.rows[0].id });
}));

// Lista para PDV/catálogo: inclui códigos e grupos de opções
router.get('/products', need('cardapio.visualizar'), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = 'p.company_id = $1';
  if (req.query.active !== 'all') where += ' and p.active';
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 60)}%`, normalizeCode(req.query.q));
    where += ` and (p.name ilike $${params.length - 1} or p.sku = $${params.length} or exists (select 1 from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id and s.code = $${params.length}))`;
  }
  if (req.query.category_id) { params.push(Number(req.query.category_id)); where += ` and p.category_id = $${params.length}`; }
  const showCost = req.ctx.can('relatorios.cmv') || req.ctx.can('cardapio.gerenciar');
  const { rows } = await q(
    `select p.id, p.name, p.description, p.sku, p.kind, p.unit, p.price_cents, ${showCost ? 'p.cost_cents,' : ''} p.favorite, p.active, p.demo,
            p.category_id, p.sector_id, p.channels, p.allergens,
            coalesce((select array_agg(s.code order by s.id) from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id), '{}') as codes,
            coalesce((select json_agg(json_build_object('id', g.id, 'name', g.name, 'min', g.min_select, 'max', g.max_select,
               'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'price_cents', o.price_cents) order by o.id), '[]')
                             from modifier_options o where o.group_id = g.id and o.active)) order by g.sort, g.id)
               from modifier_groups g where g.product_id = p.id), '[]') as groups
       from products p where ${where} order by p.favorite desc, p.name limit 500`, params);
  res.json(rows);
}));

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  sku: z.string().trim().max(40).nullable().optional(),
  kind: z.enum(['resale', 'recipe', 'produced', 'combo', 'addon', 'weight']).default('resale'),
  unit: z.enum(['un', 'kg', 'g', 'L', 'ml']).default('un'),
  price_cents: z.number().int().min(0).max(100000000),
  cost_cents: z.number().int().min(0).max(100000000).default(0),
  category_id: z.number().int().nullable().optional(),
  sector_id: z.number().int().nullable().optional(),
  favorite: z.boolean().default(false),
  active: z.boolean().default(true),
  channels: z.array(z.enum(['pdv', 'delivery', 'cardapio_digital'])).default(['pdv']),
  allergens: z.string().max(500).nullable().optional(),
  codes: z.array(z.string().max(128)).max(20).default([]),
  groups: z.array(z.object({
    name: z.string().trim().min(1).max(60), min: z.number().int().min(0).max(20), max: z.number().int().min(1).max(20),
    options: z.array(z.object({ name: z.string().trim().min(1).max(60), price_cents: z.number().int().min(0).max(1000000) })).min(1).max(40),
  })).max(10).optional(),
});

async function checkRefs(db, companyId, b) {
  if (b.category_id) { const r = await db.query('select 1 from categories where id = $1 and company_id = $2', [b.category_id, companyId]); if (!r.rows[0]) throw bad('Categoria inválida'); }
  if (b.sector_id) { const r = await db.query('select 1 from production_sectors where id = $1 and company_id = $2', [b.sector_id, companyId]); if (!r.rows[0]) throw bad('Setor inválido'); }
  if (b.kind === 'weight' && b.unit === 'un') throw bad('Produto por peso precisa de unidade kg ou g');
  for (const g of b.groups || []) if (g.min > g.max) throw bad(`Grupo ${g.name}: mínimo maior que máximo`);
}

async function saveGroups(db, companyId, productId, groups) {
  if (!groups) return;
  await db.query('delete from modifier_groups where product_id = $1 and company_id = $2', [productId, companyId]);
  let sort = 0;
  for (const g of groups) {
    const r = await db.query('insert into modifier_groups (company_id, product_id, name, min_select, max_select, sort) values ($1,$2,$3,$4,$5,$6) returning id',
      [companyId, productId, g.name, g.min, g.max, sort++]);
    for (const o of g.options)
      await db.query('insert into modifier_options (company_id, group_id, name, price_cents) values ($1,$2,$3,$4)', [companyId, r.rows[0].id, o.name, o.price_cents]);
  }
}

router.post('/products', need('cardapio.gerenciar'), h(async (req, res) => {
  const b = parse(productSchema, req.body);
  const id = await tx(async (db) => {
    await checkRefs(db, req.ctx.companyId, b);
    const r = await db.query(
      `insert into products (company_id, name, description, sku, kind, unit, price_cents, cost_cents, category_id, sector_id, favorite, active, channels, allergens)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [req.ctx.companyId, b.name, b.description ?? null, b.sku || null, b.kind, b.unit, b.price_cents, b.cost_cents, b.category_id ?? null,
        b.sector_id ?? null, b.favorite, b.active, b.channels, b.allergens ?? null]);
    const pid = r.rows[0].id;
    for (const c of b.codes) await registerCode(db, req.ctx.companyId, c, 'PRODUTO', pid);
    await saveGroups(db, req.ctx.companyId, pid, b.groups);
    await db.query('insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)', [req.ctx.companyId, pid, b.price_cents, req.ctx.userId]);
    await audit(db, req.ctx, 'produto.criado', { entity: 'product', entityId: pid, data: { name: b.name, price_cents: b.price_cents } });
    return pid;
  }).catch((e) => { if (e.code === '23505') throw conflict('SKU já usado em outro produto'); throw e; });
  res.status(201).json({ id });
}));

router.put('/products/:id', need('cardapio.gerenciar'), h(async (req, res) => {
  const id = Number(req.params.id);
  const b = parse(productSchema.partial(), req.body);
  await tx(async (db) => {
    const cur = (await db.query('select * from products where id = $1 and company_id = $2 for update', [id, req.ctx.companyId])).rows[0];
    if (!cur) throw notFound('Produto não encontrado');
    await checkRefs(db, req.ctx.companyId, { ...cur, ...b });
    const next = { ...cur, ...b };
    await db.query(
      `update products set name=$3, description=$4, sku=$5, kind=$6, unit=$7, price_cents=$8, cost_cents=$9, category_id=$10, sector_id=$11,
         favorite=$12, active=$13, channels=$14, allergens=$15, updated_at=now() where id=$1 and company_id=$2`,
      [id, req.ctx.companyId, next.name, next.description, next.sku || null, next.kind, next.unit, next.price_cents, next.cost_cents,
        next.category_id, next.sector_id, next.favorite, next.active, next.channels, next.allergens]);
    if (b.price_cents != null && b.price_cents !== cur.price_cents) {
      await db.query('insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)', [req.ctx.companyId, id, cur.price_cents, b.price_cents, req.ctx.userId]);
      await audit(db, req.ctx, 'produto.preco', { entity: 'product', entityId: id, data: { before: cur.price_cents, after: b.price_cents } });
    }
    if (b.codes) {
      const keep = b.codes.map(normalizeCode).filter(Boolean);
      await db.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id = $2 and not (code = any($3))", [req.ctx.companyId, id, keep]);
      for (const c of keep) await registerCode(db, req.ctx.companyId, c, 'PRODUTO', id);
    }
    await saveGroups(db, req.ctx.companyId, id, b.groups);
    await audit(db, req.ctx, 'produto.alterado', { entity: 'product', entityId: id, data: { ...b, groups: b.groups ? 'alterados' : undefined } });
  }).catch((e) => { if (e.code === '23505') throw conflict('SKU já usado em outro produto'); throw e; });
  res.json({ ok: true });
}));

router.get('/products/:id/prices', need('cardapio.visualizar'), h(async (req, res) => {
  res.json((await q(`select h.old_cents, h.new_cents, h.created_at, u.name as user_name from product_price_history h left join users u on u.id = h.user_id
                      where h.product_id = $1 and h.company_id = $2 order by h.id desc`, [Number(req.params.id), req.ctx.companyId])).rows);
}));

// Remove dados de demonstração sem tocar em transações: produtos já vendidos são apenas desativados
router.delete('/demo', need('configuracoes.gerenciar'), h(async (req, res) => {
  const out = await tx(async (db) => {
    const used = await db.query(`select distinct product_id from order_items where company_id = $1`, [req.ctx.companyId]);
    const usedIds = used.rows.map((r) => r.product_id);
    const deact = await db.query('update products set active = false, name = name where company_id = $1 and demo and id = any($2) returning id', [req.ctx.companyId, usedIds]);
    await db.query("delete from scan_codes where company_id = $1 and entity = 'PRODUTO' and entity_id in (select id from products where company_id = $1 and demo and not (id = any($2)))", [req.ctx.companyId, usedIds]);
    await db.query('delete from product_price_history where company_id = $1 and product_id in (select id from products where company_id = $1 and demo and not (id = any($2)))', [req.ctx.companyId, usedIds]);
    const del = await db.query('delete from products where company_id = $1 and demo and not (id = any($2)) returning id', [req.ctx.companyId, usedIds]);
    await db.query('delete from categories c where c.company_id = $1 and c.demo and not exists (select 1 from products p where p.category_id = c.id)', [req.ctx.companyId]);
    await audit(db, req.ctx, 'demonstracao.removida', { data: { removed: del.rowCount, deactivated: deact.rowCount } });
    return { removed: del.rowCount, deactivated: deact.rowCount };
  });
  res.json(out);
}));
