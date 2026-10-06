// Cardápio: categorias, setores de produção, produtos, códigos de leitura e modificadores.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict, HttpError } from '../lib/core.js';
import { need, audit, rateLimit } from '../lib/auth.js';
import { registerCode, normalizeCode } from '../lib/pdv.js';
import { fetchCatalog, validHandle } from '../lib/ipcatalog.js';
import { normName } from './possales.js';
import { normalizeHandle, ipConfig } from '../lib/infinitepay.js';

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
            case when p.photo is not null then floor(extract(epoch from coalesce(p.photo_updated_at, p.updated_at)))::bigint end as photo_v,
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
  // edição parcial: campo não enviado fica como está (os padrões do cadastro, ex.: canais = só PDV, não valem aqui)
  for (const k of Object.keys(b)) if (!Object.prototype.hasOwnProperty.call(req.body || {}, k)) delete b[k];
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

// Foto opcional do produto (cardápio digital). O navegador já envia a imagem reduzida (JPEG/PNG/WebP, até ~300 KB).
export function parsePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Envie uma imagem JPG, PNG ou WebP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 300 * 1024) throw bad('Imagem grande demais (máx. 300 KB). Use uma foto menor.');
  const sig = buf.subarray(0, 4).toString('hex');
  const ok = { 'image/png': sig.startsWith('89504e47'), 'image/jpeg': sig.startsWith('ffd8'), 'image/webp': buf.subarray(8, 12).toString() === 'WEBP' }[m[1]];
  if (!ok) throw bad('O conteúdo do arquivo não é uma imagem válida');
  return { mime: m[1], buf };
}

router.put('/products/:id/photo', need('cardapio.gerenciar'), h(async (req, res) => {
  const id = Number(req.params.id);
  parsePhoto(req.body?.data_url);
  const r = await q('update products set photo = $3, photo_updated_at = now() where id = $1 and company_id = $2 returning id', [id, req.ctx.companyId, req.body.data_url]);
  if (!r.rowCount) throw notFound('Produto não encontrado');
  await audit({ query: q }, req.ctx, 'produto.foto', { entity: 'product', entityId: id, data: { size: req.body.data_url.length } });
  res.json({ ok: true });
}));

router.delete('/products/:id/photo', need('cardapio.gerenciar'), h(async (req, res) => {
  const id = Number(req.params.id);
  const r = await q('update products set photo = null, photo_updated_at = now() where id = $1 and company_id = $2 returning id', [id, req.ctx.companyId]);
  if (!r.rowCount) throw notFound('Produto não encontrado');
  await audit({ query: q }, req.ctx, 'produto.foto_removida', { entity: 'product', entityId: id });
  res.json({ ok: true });
}));

router.get('/products/:id/photo', need('cardapio.visualizar'), h(async (req, res) => {
  const r = (await q('select photo from products where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
  res.json({ data_url: r?.photo || null });
}));

router.get('/products/:id/prices', need('cardapio.visualizar'), h(async (req, res) => {
  res.json((await q(`select h.old_cents, h.new_cents, h.created_at, u.name as user_name from product_price_history h left join users u on u.id = h.user_id
                      where h.product_id = $1 and h.company_id = $2 order by h.id desc`, [Number(req.params.id), req.ctx.companyId])).rows);
}));

// ---------------- Importar cardápio (Loja InfinitePay ou planilha) ----------------
// 1) /import/infinitepay/fetch lê o catálogo público da InfinitePay (nada é gravado);
// 2) /import com dry_run mostra o que vai acontecer; 3) /import grava tudo numa transação.
// Produtos e categorias são casados pelo nome (sem acento/caixa); nomes iguais aos da maquininha também casam pelos apelidos já salvos.

router.post('/import/infinitepay/fetch', need('cardapio.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ handle: z.string().trim().max(80).optional() }), req.body);
  // aceita a tag, $tag ou o endereço da loja (loja.infinitepay.io/tag/...)
  const typed = String(b.handle || '').trim();
  const fromUrl = typed.match(/infinitepay\.io\/(?:llms\/)?([^/?#\s]+)/i);
  let handle = normalizeHandle(fromUrl ? fromUrl[1].replace(/\.md$/i, '') : typed);
  if (!handle) handle = ipConfig((await q('select settings from companies where id = $1', [req.ctx.companyId])).rows[0]?.settings).handle || '';
  if (!validHandle(handle)) throw bad('Informe a InfiniteTag da loja (o endereço loja.infinitepay.io/SUA-TAG), sem o $');
  await rateLimit(`menu-import:${req.ctx.companyId}`, 20, 600);
  let cat;
  try { cat = await fetchCatalog(handle); } catch (e) {
    throw new HttpError(502, e.upstream ? `A InfinitePay não respondeu agora (código ${e.upstream}). Tente de novo em alguns minutos.` : 'Não foi possível ler a loja da InfinitePay agora. Tente de novo em alguns minutos.', 'upstream');
  }
  if (!cat) throw notFound(`Não encontrei a loja loja.infinitepay.io/${handle}. Confira a InfiniteTag e se a Loja Online está publicada no app da InfinitePay.`);
  if (!cat.products.length) throw bad('A loja foi encontrada, mas não tem produtos publicados.');
  res.json({ handle, ...cat });
}));

const importItem = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().max(80).nullable().optional(),
  price_cents: z.number().int().min(0).max(100000000),
  cost_cents: z.number().int().min(0).max(100000000).nullable().optional(),
  sku: z.string().trim().max(40).nullable().optional(),
  codes: z.array(z.string().trim().max(128)).max(10).default([]),
  unit: z.enum(['un', 'kg', 'g', 'L', 'ml']).nullable().optional(),
  sector: z.string().trim().max(60).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  available: z.boolean().default(true),
  line: z.number().int().positive().optional(),
});
const importSchema = z.object({
  source: z.enum(['infinitepay', 'planilha', 'arquivo']).default('infinitepay'),
  dry_run: z.boolean().default(false),
  items: z.array(importItem).min(1).max(3000),
  categories: z.array(z.string().trim().min(1).max(80)).max(300).default([]), // ordem da InfinitePay
  // categoria da planilha → { category_id } (usar uma existente) ou { create: true } (criar com o nome da planilha)
  category_map: z.record(z.string(), z.union([z.object({ category_id: z.number().int() }), z.object({ create: z.literal(true) })])).default({}),
  category_sectors: z.record(z.string(), z.number().int().nullable()).default({}),
  update_prices: z.boolean().default(true),
  update_costs: z.boolean().default(true),
  update_categories: z.boolean().default(true),
  inactive_unavailable: z.boolean().default(true),
});

// categoria sem produtos ainda: sugere o setor pelo nome (o usuário pode trocar na prévia)
const SECTOR_HINTS = [
  [/\b(chop+e?s?|cervejas?|drinks?|doses?|bebidas?|caipirinhas?|coqueteis|vinhos?|destilados?|whisky|gin|bar|garrafas?)\b/, 'bar'],
  [/\b(cozinha|porcoes|porcao|petiscos?|lanches?|pratos?|comidas?|refeicoes|executivos?|burgers?|hamburgueres|pizzas?|sobremesas?|entradas?|tira gostos?|espetos?|caldos?)\b/, 'cozinha'],
];

async function importPlan(db, companyId, b) {
  const fileSource = b.source !== 'infinitepay';
  const cats = (await db.query('select id, name, sort, active from categories where company_id = $1 order by id', [companyId])).rows;
  const products = (await db.query('select id, name, sku, price_cents, cost_cents, category_id, sector_id, active, demo from products where company_id = $1 order by active desc, demo, id', [companyId])).rows;
  const sectors = (await db.query('select id, name from production_sectors where company_id = $1 and active order by id', [companyId])).rows;
  const aliases = (await db.query("select alias_norm, product_id from pos_product_aliases where company_id = $1 and provider = 'infinitepay'", [companyId])).rows;
  const usedCodes = new Map((await db.query("select code, entity, entity_id from scan_codes where company_id = $1", [companyId])).rows.map((c) => [c.code, c]));
  const catByNorm = new Map(); for (const c of cats) if (!catByNorm.has(normName(c.name))) catByNorm.set(normName(c.name), c);
  const prodByNorm = new Map(); for (const p of products) if (!prodByNorm.has(normName(p.name))) prodByNorm.set(normName(p.name), p);
  for (const a of aliases) { const p = products.find((x) => Number(x.id) === Number(a.product_id)); if (p && !prodByNorm.has(a.alias_norm)) prodByNorm.set(a.alias_norm, p); }
  const prodBySku = new Map(products.filter((p) => p.sku).map((p) => [String(p.sku).toLowerCase(), p]));
  const maxSort = cats.reduce((m, c) => Math.max(m, c.sort), -1);

  // categorias citadas (ordem da InfinitePay, depois as que só aparecem nos itens)
  const order = [];
  for (const n of [...b.categories, ...b.items.map((i) => i.category).filter(Boolean)]) if (!order.some((x) => normName(x) === normName(n))) order.push(n);
  const mapOf = (name) => { for (const [k, v] of Object.entries(b.category_map)) if (normName(k) === normName(name)) return v; return null; };
  let hint = null;
  const unresolved = [];
  const catPlan = order.map((name, i) => {
    const m = mapOf(name);
    let cur = m && m.category_id ? cats.find((c) => Number(c.id) === Number(m.category_id)) || null : catByNorm.get(normName(name));
    if (m && m.category_id && !cur) cur = null;
    if (!cur && fileSource && !m) unresolved.push(name); // planilha: categoria nova precisa de decisão (usar existente ou criar)
    const counts = {};
    if (cur) for (const p of products) if (Number(p.category_id) === Number(cur.id) && p.sector_id) counts[p.sector_id] = (counts[p.sector_id] || 0) + 1;
    const fromProducts = Object.entries(counts).sort((x, y) => y[1] - x[1])[0]?.[0];
    const words = normName(name).split(' ');
    const byName = sectors.find((s) => words.includes(normName(s.name)) || normName(s.name) === normName(name))
      || (SECTOR_HINTS.some(([re, sec]) => re.test(normName(name)) && (hint = sectors.find((s) => normName(s.name) === sec))) ? hint : null);
    const suggested = fromProducts ? Number(fromProducts) : byName ? Number(byName.id) : null;
    const chosen = Object.prototype.hasOwnProperty.call(b.category_sectors, name) ? b.category_sectors[name] : suggested;
    const sector_id = chosen && sectors.some((s) => Number(s.id) === Number(chosen)) ? Number(chosen) : null;
    const changes = [];
    if (cur && !cur.active) changes.push('reativar');
    if (cur && !fileSource && cur.name !== name) changes.push('renomear');
    if (cur && !fileSource && cur.sort !== i) changes.push('ordem');
    const mapped = !!(m && m.category_id && cur);
    return { name, id: cur ? Number(cur.id) : null, current_name: cur?.name ?? null, mapped, action: !cur ? 'criar' : changes.length ? 'atualizar' : 'igual', changes,
      sort: !cur && fileSource ? maxSort + 1 + i : i, sector_id };
  });
  const catOf = (n) => (n ? catPlan.find((c) => normName(c.name) === normName(n)) : null);
  const sectorByName = (n) => (n ? sectors.find((s) => normName(s.name) === normName(n)) : null);

  const seen = new Set(); const seenSku = new Set(); const seenCode = new Set();
  const items = b.items.map((it) => {
    const key = normName(it.name);
    if (!key) return { ...it, action: 'ignorar', reason: 'nome vazio' };
    if (seen.has(key)) return { ...it, action: 'ignorar', reason: 'repetido no arquivo' };
    seen.add(key);
    const warn = [];
    const skuKey = it.sku ? String(it.sku).toLowerCase() : null;
    let cur = (skuKey && prodBySku.get(skuKey)) || prodByNorm.get(key) || null;
    let sku = it.sku || null;
    if (skuKey && (seenSku.has(skuKey) || (prodBySku.get(skuKey) && cur && prodBySku.get(skuKey).id !== cur.id))) { sku = null; warn.push('código repetido: entra sem código'); }
    if (skuKey) seenSku.add(skuKey);
    const codes = [];
    for (const raw of it.codes || []) {
      const c = normalizeCode(raw);
      if (!c || /^0+$/.test(c)) continue;
      if (seenCode.has(c)) { warn.push(`código de barras ${c} repetido na planilha`); continue; }
      const owner = usedCodes.get(c);
      if (owner && !(owner.entity === 'PRODUTO' && cur && Number(owner.entity_id) === Number(cur.id))) { warn.push(`código de barras ${c} já usado`); continue; }
      seenCode.add(c); codes.push(c);
    }
    const c = catOf(it.category);
    const sec = sectorByName(it.sector);
    const base = { ...it, sku, codes, category_resolved: c ? (c.current_name || c.name) : null, warnings: warn };
    if (!cur) return { ...base, action: 'criar', product_id: null, sector_id: sec ? Number(sec.id) : c?.sector_id ?? null, active: it.available || !b.inactive_unavailable };
    const changes = [];
    if (b.update_prices && cur.price_cents !== it.price_cents) changes.push('preco');
    if (fileSource && b.update_costs && it.cost_cents != null && cur.cost_cents !== it.cost_cents) changes.push('custo');
    if (b.update_categories && c && Number(cur.category_id) !== c.id) changes.push('categoria');
    if (!cur.active && it.available) changes.push('reativar');
    if (fileSource && cur.active && !it.available && b.inactive_unavailable) changes.push('pausar');
    if (sku && !cur.sku) changes.push('codigo');
    if (codes.some((x) => !usedCodes.has(x))) changes.push('codigo_barras');
    return { ...base, action: changes.length ? 'atualizar' : 'igual', changes, product_id: Number(cur.id), current_name: cur.name, current_price_cents: cur.price_cents,
      current_cost_cents: cur.cost_cents, current_sku: cur.sku, demo: cur.demo };
  });
  const sum = (a) => items.filter((x) => x.action === a).length;
  return {
    categories: catPlan, items, sectors, unresolved,
    existing_categories: cats.filter((x) => x.active).map((x) => ({ id: Number(x.id), name: x.name })),
    summary: { criar: sum('criar'), atualizar: sum('atualizar'), igual: sum('igual'), ignorar: sum('ignorar'),
      categorias_criar: catPlan.filter((c) => c.action === 'criar').length, categorias_atualizar: catPlan.filter((c) => c.action === 'atualizar').length },
  };
}

router.post('/import', need('cardapio.gerenciar'), h(async (req, res) => {
  const b = parse(importSchema, req.body);
  if (b.dry_run) { res.json(await importPlan({ query: q }, req.ctx.companyId, b)); return; }
  const out = await tx(async (db) => {
    await db.query('select id from companies where id = $1 for update', [req.ctx.companyId]); // uma importação por vez
    const plan = await importPlan(db, req.ctx.companyId, b);
    if (plan.unresolved.length) throw bad(`Indique a categoria de: ${plan.unresolved.slice(0, 5).join(', ')}${plan.unresolved.length > 5 ? '…' : ''}`, 'category_unresolved');
    for (const c of plan.categories) {
      if (c.action === 'criar') {
        const r = await db.query('insert into categories (company_id, name, sort) values ($1,$2,$3) returning id', [req.ctx.companyId, c.name, c.sort]);
        c.id = Number(r.rows[0].id);
      } else if (c.action === 'atualizar') {
        if (b.source === 'infinitepay') await db.query('update categories set name = $3, sort = $4, active = true where id = $1 and company_id = $2', [c.id, req.ctx.companyId, c.name, c.sort]);
        else await db.query('update categories set active = true where id = $1 and company_id = $2', [c.id, req.ctx.companyId]);
      }
    }
    const cat = (n) => (n ? plan.categories.find((c) => normName(c.name) === normName(n)) : null);
    let created = 0; let updated = 0; let prices = 0;
    for (const it of plan.items) {
      const c = cat(it.category);
      if (it.action === 'criar') {
        const r = await db.query(
          `insert into products (company_id, name, sku, description, kind, unit, price_cents, cost_cents, category_id, sector_id, active, channels)
           values ($1,$2,$3,$4,'resale',$5,$6,$7,$8,$9,$10,'{pdv}') returning id`,
          [req.ctx.companyId, it.name, it.sku || null, it.description || null, it.unit || 'un', it.price_cents, it.cost_cents ?? 0, c?.id ?? null, it.sector_id ?? null, it.active]);
        it.product_id = Number(r.rows[0].id);
        await db.query('insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)', [req.ctx.companyId, it.product_id, it.price_cents, req.ctx.userId]);
        created++;
      } else if (it.action === 'atualizar') {
        const ch = (x) => it.changes.includes(x);
        await db.query(`update products set price_cents = case when $3 then $4 else price_cents end, category_id = case when $5 then $6 else category_id end,
                          cost_cents = case when $8 then $9 else cost_cents end, sku = case when $10 then $11 else sku end,
                          active = case when $7 then true when $12 then false else active end, updated_at = now() where id = $1 and company_id = $2`,
          [it.product_id, req.ctx.companyId, ch('preco'), it.price_cents, ch('categoria'), c?.id ?? null, ch('reativar'), ch('custo'), it.cost_cents ?? 0, ch('codigo'), it.sku || null, ch('pausar')]);
        if (ch('preco')) {
          await db.query('insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,$3,$4,$5)', [req.ctx.companyId, it.product_id, it.current_price_cents, it.price_cents, req.ctx.userId]);
          prices++;
        }
        updated++;
      }
      if (it.product_id && it.action !== 'ignorar') for (const code of it.codes || []) await registerCode(db, req.ctx.companyId, code, 'PRODUTO', it.product_id);
      // mesmo nome da maquininha → baixa de estoque casa sozinha nas próximas importações de vendas
      if (it.product_id && it.action !== 'ignorar')
        await db.query(`insert into pos_product_aliases (company_id, provider, alias_norm, product_id) values ($1,'infinitepay',$2,$3)
          on conflict (company_id, provider, alias_norm) do update set product_id = excluded.product_id, updated_at = now()`, [req.ctx.companyId, normName(it.name), it.product_id]);
    }
    const result = { created, updated, prices, unchanged: plan.summary.igual, categories_created: plan.summary.categorias_criar, categories_updated: plan.summary.categorias_atualizar };
    await audit(db, req.ctx, 'cardapio.importado', { data: { source: b.source, ...result } });
    return result;
  }).catch((e) => { if (e.code === '23505') throw conflict('Código (SKU) repetido entre produtos: confira a coluna de código'); throw e; });
  res.json(out);
}));

// Exportação do cardápio (a tela monta a planilha .xlsx); mesmas colunas que a importação entende
router.get('/export', need('cardapio.gerenciar'), h(async (req, res) => {
  const showCost = req.ctx.can('relatorios.cmv') || req.ctx.can('cardapio.gerenciar');
  const { rows } = await q(
    `select p.sku, p.name, c.name as category, ps.name as sector, p.kind, p.unit, p.price_cents, ${showCost ? 'p.cost_cents' : 'null::bigint as cost_cents'}, p.active, p.description,
            coalesce((select string_agg(s.code, ' ' order by s.id) from scan_codes s where s.company_id = p.company_id and s.entity = 'PRODUTO' and s.entity_id = p.id), '') as codes
       from products p left join categories c on c.id = p.category_id left join production_sectors ps on ps.id = p.sector_id
      where p.company_id = $1 and not p.demo order by c.sort nulls last, c.name, p.name`, [req.ctx.companyId]);
  await audit({ query: q }, req.ctx, 'cardapio.exportado', { data: { count: rows.length } });
  res.json(rows);
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
