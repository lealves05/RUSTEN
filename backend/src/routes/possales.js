// Vendas feitas direto na maquininha (fora do RUSTEN): importação do relatório de vendas da InfinitePay.
// O navegador lê o PDF e envia os números + o arquivo original; aqui os números são conferidos entre si
// (dias × total, formas × total, taxas = bruto − líquido) antes de gravar. Nada é editado depois: só cancelado.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict, forbidden } from '../lib/core.js';
import { need, audit, assertCan } from '../lib/auth.js';
import { requirements, balances, stockConfig } from '../lib/stock.js';

export const router = Router();

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CENTS = z.number().int().min(0).max(10_000_000_000);
const NAME = z.string().trim().min(1).max(120);
const reportSchema = z.object({
  account: z.string().trim().max(120).nullish(),
  generated_on: DAY.nullish(),
  period_from: DAY, period_to: DAY,
  gross_cents: CENTS, net_cents: CENTS, fee_cents: CENTS, tx_count: z.number().int().min(0).max(1_000_000),
  days: z.array(z.object({ day: DAY, gross_cents: CENTS, net_cents: CENTS, tx_count: z.number().int().min(0).max(1_000_000) })).min(1).max(400),
  methods: z.array(z.object({ label: NAME, gross_cents: CENTS })).max(20).default([]),
  products: z.array(z.object({ name: NAME, qty: z.number().min(0).max(1_000_000) })).max(300).default([]),
  categories: z.array(z.object({ name: NAME, qty: z.number().min(0).max(1_000_000) })).max(100).default([]),
  notes: z.array(z.string().trim().max(300)).max(10).default([]),
});
const bodySchema = z.object({
  file_name: z.string().trim().min(1).max(200),
  file_b64: z.string().min(10).max(7_000_000),
  mode: z.enum(['externa', 'conferencia']),
  replace: z.boolean().default(false),
  report: reportSchema,
});

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Forma do relatório → forma do RUSTEN. "Money" é como a InfinitePay chama a venda em dinheiro registrada na maquininha. */
export function methodKey(label) {
  const l = norm(label);
  if (/debito/.test(l)) return 'debito';
  if (/credito|parcelad/.test(l)) return 'credito';
  if (/pix/.test(l)) return 'pix';
  if (/money|dinheiro|especie/.test(l)) return 'dinheiro';
  return 'outro';
}
export const METHOD_LABEL = { debito: 'Débito', credito: 'Crédito', pix: 'Pix', dinheiro: 'Dinheiro', outro: 'Outro' };

/** Confere o relatório: devolve a lista de problemas (vazia = consistente). */
export function checkReport(r) {
  const errs = [];
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  if (r.period_from > r.period_to) errs.push('período com data inicial depois da final');
  if ((new Date(r.period_to) - new Date(r.period_from)) / 86400000 > 400) errs.push('período maior que 400 dias');
  const seen = new Set();
  for (const d of r.days) {
    if (seen.has(d.day)) errs.push(`dia ${d.day} repetido`);
    seen.add(d.day);
    if (d.day < r.period_from || d.day > r.period_to) errs.push(`dia ${d.day} fora do período do relatório`);
    if (d.net_cents > d.gross_cents) errs.push(`dia ${d.day}: líquido maior que o bruto`);
  }
  const tol = Math.max(2, r.days.length); // arredondamento de centavos por linha
  const sg = r.days.reduce((s, d) => s + d.gross_cents, 0);
  const sn = r.days.reduce((s, d) => s + d.net_cents, 0);
  const st = r.days.reduce((s, d) => s + d.tx_count, 0);
  if (!near(sg, r.gross_cents, tol)) errs.push(`soma dos dias (${sg / 100}) diferente da receita bruta (${r.gross_cents / 100})`);
  if (!near(sn, r.net_cents, tol)) errs.push(`soma dos dias (${sn / 100}) diferente da receita líquida (${r.net_cents / 100})`);
  if (st !== r.tx_count) errs.push(`soma das transações por dia (${st}) diferente do total (${r.tx_count})`);
  if (r.net_cents > r.gross_cents) errs.push('receita líquida maior que a bruta');
  if (!near(r.gross_cents - r.net_cents, r.fee_cents, 2)) errs.push('taxas diferentes de bruto − líquido');
  if (r.methods.length) {
    const sm = r.methods.reduce((s, m) => s + m.gross_cents, 0);
    if (!near(sm, r.gross_cents, Math.max(2, r.methods.length))) errs.push(`soma das formas de pagamento (${sm / 100}) diferente da receita bruta (${r.gross_cents / 100})`);
  }
  return errs;
}

// Pagamentos do RUSTEN nos mesmos dias, para conferir se essas vendas já foram lançadas nas comandas
async function reconcile(db, companyId, days) {
  if (!days.length) return [];
  const rows = (await db.query(`select p.business_date as day, p.method, count(*)::int as n, coalesce(sum(p.amount_cents),0)::bigint as total
      from payments p where p.company_id = $1 and p.status = 'confirmado' and p.business_date = any($2::date[])
        and p.method in ('debito','credito','pix','dinheiro') group by 1, 2`, [companyId, days.map((d) => d.day)])).rows;
  return days.map((d) => {
    const mine = rows.filter((r) => r.day === d.day);
    const card = mine.filter((r) => r.method !== 'dinheiro').reduce((s, r) => s + Number(r.total), 0);
    return { day: d.day, report_gross_cents: d.gross_cents, report_tx: d.tx_count, rusten_card_pix_cents: card,
      rusten_cash_cents: mine.filter((r) => r.method === 'dinheiro').reduce((s, r) => s + Number(r.total), 0),
      rusten_card_pix_count: mine.filter((r) => r.method !== 'dinheiro').reduce((s, r) => s + r.n, 0) };
  });
}

async function overlaps(db, companyId, days) {
  return (await db.query(`select i.id, i.file_name, i.period_from, i.period_to, i.mode, count(d.id)::int as days
      from pos_sales_days d join pos_sales_imports i on i.id = d.import_id
     where d.company_id = $1 and d.provider = 'infinitepay' and d.active and d.day = any($2::date[])
     group by i.id order by i.id`, [companyId, days.map((d) => d.day)])).rows;
}

function decodeFile(b64) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < 100 || buf.length > 5 * 1024 * 1024) throw bad('Arquivo vazio ou maior que 5 MB');
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw bad('O arquivo não é um PDF');
  return { buf, sha: crypto.createHash('sha256').update(buf).digest('hex') };
}

// Conferência antes de gravar: números, sobreposição com importações anteriores e lançamentos do RUSTEN nos mesmos dias
router.post('/preview', need('financeiro.visualizar'), h(async (req, res) => {
  const b = parse(bodySchema.omit({ mode: true, replace: true }), req.body);
  const { sha } = decodeFile(b.file_b64);
  const dup = (await q("select id, created_at from pos_sales_imports where company_id = $1 and file_sha256 = $2 and status = 'ativo'", [req.ctx.companyId, sha])).rows[0];
  res.json({ problems: checkReport(b.report), duplicate: dup || null, overlaps: await overlaps({ query: q }, req.ctx.companyId, b.report.days),
    reconciliation: await reconcile({ query: q }, req.ctx.companyId, b.report.days) });
}));

router.post('/', need('financeiro.visualizar'), h(async (req, res) => {
  const b = parse(bodySchema, req.body);
  const r = b.report;
  const problems = checkReport(r);
  if (problems.length) throw bad(`O relatório não fecha: ${problems.slice(0, 3).join('; ')}`, 'report_inconsistent');
  const { buf, sha } = decodeFile(b.file_b64);
  const out = await tx(async (db) => {
    await db.query("select pg_advisory_xact_lock(hashtext('pos-sales:' || $1::text))", [req.ctx.companyId]);
    const dup = (await db.query("select id from pos_sales_imports where company_id = $1 and file_sha256 = $2 and status = 'ativo'", [req.ctx.companyId, sha])).rows[0];
    if (dup) throw conflict('Este relatório já foi importado', 'duplicate', { import_id: dup.id });
    const ov = await overlaps(db, req.ctx.companyId, r.days);
    if (ov.length && !b.replace) throw conflict('Já existe importação ativa para parte destes dias', 'overlap', { overlaps: ov });
    if (ov.length && !req.ctx.can('financeiro.estornar')) throw forbidden('Substituir uma importação exige a permissão "Estornar pagamentos"');
    const methods = r.methods.map((m) => ({ method: methodKey(m.label), label: m.label, gross_cents: m.gross_cents }));
    const imp = (await db.query(`insert into pos_sales_imports (company_id, mode, file_name, file_sha256, file_data, account_label, period_from, period_to, generated_on,
          gross_cents, net_cents, fee_cents, tx_count, methods, products, categories, notes, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [req.ctx.companyId, b.mode, b.file_name, sha, buf, r.account || null, r.period_from, r.period_to, r.generated_on || null,
      r.gross_cents, r.net_cents, r.fee_cents, r.tx_count, JSON.stringify(methods), JSON.stringify(r.products), JSON.stringify(r.categories), JSON.stringify(r.notes), req.ctx.userId])).rows[0];
    for (const o of ov) {
      await cancelImport(db, req.ctx, o.id, `Substituída pela importação #${imp.id}`);
      await audit(db, req.ctx, 'maquininha.importacao_substituida', { entity: 'pos_sales_import', entityId: o.id, reason: `nova importação #${imp.id}` });
    }
    for (const d of r.days) {
      await db.query('insert into pos_sales_days (company_id, import_id, provider, day, gross_cents, net_cents, tx_count) values ($1,$2,$3,$4,$5,$6,$7)',
        [req.ctx.companyId, imp.id, 'infinitepay', d.day, d.gross_cents, d.net_cents, d.tx_count]);
    }
    await audit(db, req.ctx, 'maquininha.importada', { entity: 'pos_sales_import', entityId: imp.id,
      data: { file: b.file_name, sha256: sha, mode: b.mode, period: [r.period_from, r.period_to], gross_cents: r.gross_cents, net_cents: r.net_cents, tx_count: r.tx_count, replaced: ov.map((o) => o.id) } });
    return { id: imp.id, replaced: ov.map((o) => o.id) };
  });
  res.status(201).json(out);
}));

router.get('/', need('financeiro.visualizar'), h(async (req, res) => {
  const rows = (await q(`select i.id, i.mode, i.file_name, i.account_label, i.period_from, i.period_to, i.generated_on, i.gross_cents, i.net_cents, i.fee_cents, i.tx_count,
      i.methods, i.status, i.created_at, i.canceled_at, i.cancel_reason, u.name as user_name, cu.name as canceled_by_name
    from pos_sales_imports i left join users u on u.id = i.created_by left join users cu on cu.id = i.canceled_by
    where i.company_id = $1 order by i.period_to desc, i.id desc limit 100`, [req.ctx.companyId])).rows;
  const act = rows.filter((r) => r.status === 'ativo');
  const sum = (k, mode) => act.filter((r) => !mode || r.mode === mode).reduce((s, r) => s + Number(r[k]), 0);
  res.json({ items: rows, totals: { gross_cents: sum('gross_cents', 'externa'), net_cents: sum('net_cents', 'externa'), fee_cents: sum('fee_cents', 'externa'), tx_count: sum('tx_count', 'externa') } });
}));

router.get('/:id', need('financeiro.visualizar'), h(async (req, res) => {
  const i = (await q(`select i.id, i.mode, i.file_name, i.file_sha256, i.account_label, i.period_from, i.period_to, i.generated_on, i.gross_cents, i.net_cents, i.fee_cents, i.tx_count,
      i.methods, i.products, i.categories, i.notes, i.status, i.created_at, i.canceled_at, i.cancel_reason, u.name as user_name
    from pos_sales_imports i left join users u on u.id = i.created_by where i.id = $1 and i.company_id = $2`, [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!i) throw notFound('Importação não encontrada');
  const days = (await q('select day, gross_cents, net_cents, tx_count, active from pos_sales_days where import_id = $1 order by day', [i.id])).rows;
  res.json({ ...i, days, reconciliation: await reconcile({ query: q }, req.ctx.companyId, days) });
}));

// relatório original, como foi enviado
router.get('/:id/file', need('financeiro.visualizar'), h(async (req, res) => {
  const i = (await q('select file_name, file_data from pos_sales_imports where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!i?.file_data) throw notFound('Arquivo não encontrado');
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `attachment; filename="${i.file_name.replace(/[^\w.\- ]/g, '_')}"`);
  res.send(i.file_data);
}));

// Cancela a importação: os dias deixam de contar e as saídas de estoque já lançadas são estornadas.
async function cancelImport(db, ctx, importId, reason) {
  await db.query('update pos_sales_days set active = false where import_id = $1', [importId]);
  await db.query("update pos_sales_imports set status = 'cancelado', canceled_by = $2, canceled_at = now(), cancel_reason = $3 where id = $1", [importId, ctx.userId, reason]);
  const rows = (await db.query("select id from pos_sales_items where import_id = $1 and status = 'baixado' for update", [importId])).rows;
  for (const r of rows) {
    const mv = (await db.query(`select m.* from stock_movements m where m.company_id = $1 and m.ref_type = 'pos_sales_item' and m.ref_id = $2 and m.kind = 'venda'
      and not exists (select 1 from stock_movements x where x.reverses_id = m.id)`, [ctx.companyId, r.id])).rows;
    for (const m of mv) {
      await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reverses_id, reason, user_id)
        values ($1,$2,'estorno_venda',$3,$4,'pos_sales_item_rev',$5,$6,$7,$8)`, [ctx.companyId, m.stock_item_id, -Number(m.qty), m.unit_cost_cents, r.id, m.id, `Importação da maquininha cancelada: ${reason}`.slice(0, 300), ctx.userId]);
    }
    await db.query("update pos_sales_items set status = 'estornado' where id = $1", [r.id]);
  }
  return rows.length;
}

// ---------------- Produtos vendidos na maquininha → saída no estoque ----------------
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'ml', 'l', 'lt', 'un', 'und', 'g', 'kg', 'a', 'o']);
export const normName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = (s) => [...new Set(normName(s).split(' ').filter((t) => t && !STOP.has(t)))];
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// mesma palavra com pequena diferença de grafia (chopp/chope, heineken/heiniken) ou abreviação (refri/refrigerante)
const same = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))
  || (Math.min(x.length, y.length) >= 5 && lev(x, y) <= (Math.min(x.length, y.length) >= 8 ? 2 : 1));
/** Semelhança entre o nome na maquininha e o nome do produto (0 a 1, coeficiente de Dice tolerante a grafia). */
export function similarity(a, b) {
  const A = tokens(a); const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const used = new Set();
  let inter = 0;
  for (const t of A) { const k = B.findIndex((x, i) => !used.has(i) && same(t, x)); if (k >= 0) { used.add(k); inter++; } }
  return (2 * inter) / (A.length + B.length);
}
function bestMatch(name, products) {
  let best = null;
  for (const p of products) {
    const sc = normName(p.name) === normName(name) ? 1 : similarity(name, p.name);
    if (!best || sc > best.score) best = { product_id: p.id, name: p.name, score: Math.round(sc * 100) / 100 };
  }
  return best && best.score >= 0.5 ? best : null;
}

async function loadImport(db, ctx, id, lock = false) {
  const i = (await db.query(`select id, status, mode, period_from, period_to, products, categories from pos_sales_imports where id = $1 and company_id = $2${lock ? ' for update' : ''}`,
    [Number(id), ctx.companyId])).rows[0];
  if (!i) throw notFound('Importação não encontrada');
  return i;
}

// cria as linhas a partir do ranking do relatório (uma vez), já ligando os nomes conhecidos ou idênticos
async function ensureItems(db, ctx, imp) {
  const has = (await db.query('select 1 from pos_sales_items where import_id = $1 limit 1', [imp.id])).rows[0];
  if (has || !imp.products?.length) return;
  const products = (await db.query('select id, name from products where company_id = $1 and active', [ctx.companyId])).rows;
  const aliases = Object.fromEntries((await db.query("select alias_norm, product_id from pos_product_aliases where company_id = $1 and provider = 'infinitepay'", [ctx.companyId])).rows
    .filter((a) => products.some((p) => Number(p.id) === Number(a.product_id))).map((a) => [a.alias_norm, a.product_id]));
  for (const p of imp.products) {
    if (!(Number(p.qty) > 0)) continue;
    const exact = products.find((x) => normName(x.name) === normName(p.name));
    const pid = aliases[normName(p.name)] ?? exact?.id ?? null;
    await db.query('insert into pos_sales_items (company_id, import_id, report_name, qty, product_id) values ($1,$2,$3,$4,$5)', [ctx.companyId, imp.id, p.name, p.qty, pid]);
  }
}

async function itemsView(db, ctx, imp) {
  const rows = (await db.query(`select i.id, i.report_name, i.source, i.qty::float as qty, i.product_id, i.status, i.posted_at, u.name as posted_by_name
      from pos_sales_items i left join users u on u.id = i.posted_by where i.import_id = $1 order by i.source desc, i.qty desc, i.id`, [imp.id])).rows;
  const products = (await db.query('select id, name, stock_mode, stock_item_id, cost_cents from products where company_id = $1 and active order by name', [ctx.companyId])).rows;
  const byId = Object.fromEntries(products.map((p) => [Number(p.id), p]));
  const units = Object.fromEntries((await db.query('select id, name, unit from stock_items where company_id = $1', [ctx.companyId])).rows.map((s) => [Number(s.id), s]));
  for (const r of rows) {
    const p = byId[Number(r.product_id)];
    r.product_name = p?.name || null;
    r.untracked = p ? p.stock_mode === 'nenhum' : false;
    if (!p && r.status === 'pendente') r.suggestion = bestMatch(r.report_name, products);
    if (p) {
      const need = await requirements(db, ctx.companyId, p, r.qty, []);
      r.stock = [...need.entries()].map(([id, q]) => ({ stock_item_id: id, name: units[id]?.name, unit: units[id]?.unit, qty: Math.round(q * 1000) / 1000 }));
    }
    if (r.status === 'baixado' || r.status === 'estornado') {
      r.moved = (await db.query(`select s.name, s.unit, -m.qty::float as qty from stock_movements m join stock_items s on s.id = m.stock_item_id
        where m.company_id = $1 and m.ref_type = 'pos_sales_item' and m.ref_id = $2 and m.kind = 'venda'`, [ctx.companyId, r.id])).rows;
    }
  }
  const reportQty = (imp.products || []).reduce((a, p) => a + Number(p.qty || 0), 0);
  const catQty = (imp.categories || []).reduce((a, p) => a + Number(p.qty || 0), 0);
  return { rows, products: products.map((p) => ({ id: p.id, name: p.name, stock_mode: p.stock_mode })),
    summary: { report_qty: reportQty, categories_qty: catQty, missing_qty: Math.max(0, catQty - reportQty) },
    can_post: imp.status === 'ativo' && imp.mode === 'externa', mode: imp.mode, status: imp.status,
    can_edit: ctx.can('estoque.ajustar'), can_create: ctx.can('estoque.ajustar') && ctx.can('cardapio.gerenciar') };
}

router.get('/:id/items', need('financeiro.visualizar'), h(async (req, res) => {
  const out = await tx(async (db) => {
    const imp = await loadImport(db, req.ctx, req.params.id, true);
    if (imp.status === 'ativo') await ensureItems(db, req.ctx, imp);
    return itemsView(db, req.ctx, imp);
  });
  res.json(out);
}));

// salva a conferência: produto de cada linha, quantidade, linhas ignoradas e linhas acrescentadas à mão
router.put('/:id/items', need('financeiro.visualizar'), h(async (req, res) => {
  assertCan(req.ctx, 'estoque.ajustar');
  const b = parse(z.object({ rows: z.array(z.object({
    id: z.number().int().optional(), report_name: z.string().trim().min(1).max(120).optional(),
    qty: z.number().positive().max(100000), product_id: z.number().int().nullable(), ignored: z.boolean().default(false),
  })).max(400) }), req.body);
  const out = await tx(async (db) => {
    const imp = await loadImport(db, req.ctx, req.params.id, true);
    if (imp.status !== 'ativo') throw conflict('Importação cancelada');
    const pids = [...new Set(b.rows.map((r) => r.product_id).filter(Boolean))];
    if (pids.length) {
      const ok = (await db.query('select count(*)::int as n from products where company_id = $1 and id = any($2)', [req.ctx.companyId, pids])).rows[0].n;
      if (ok !== pids.length) throw bad('Produto inválido');
    }
    const cur = (await db.query('select id, source, status from pos_sales_items where import_id = $1 for update', [imp.id])).rows;
    const keep = new Set();
    for (const r of b.rows) {
      const status = r.ignored ? 'ignorado' : 'pendente';
      if (r.id) {
        const c = cur.find((x) => Number(x.id) === r.id);
        if (!c) throw bad('Linha inválida');
        keep.add(r.id);
        if (c.status === 'baixado' || c.status === 'estornado') continue; // já lançada: não muda
        await db.query('update pos_sales_items set qty = $2, product_id = $3, status = $4 where id = $1', [r.id, r.qty, r.product_id, status]);
      } else {
        if (!r.product_id) throw bad('Escolha o produto da linha acrescentada');
        const p = (await db.query('select name from products where id = $1', [r.product_id])).rows[0];
        await db.query("insert into pos_sales_items (company_id, import_id, report_name, source, qty, product_id, status) values ($1,$2,$3,'manual',$4,$5,$6)",
          [req.ctx.companyId, imp.id, (r.report_name || p.name).slice(0, 120), r.qty, r.product_id, status]);
      }
    }
    // linhas acrescentadas à mão e retiradas da lista (ainda não lançadas) saem
    for (const c of cur) if (c.source === 'manual' && !keep.has(Number(c.id)) && (c.status === 'pendente' || c.status === 'ignorado')) await db.query('delete from pos_sales_items where id = $1', [c.id]);
    return itemsView(db, req.ctx, imp);
  });
  res.json(out);
}));

// lança a saída no estoque das linhas conferidas (ficha técnica ou produto acabado), uma única vez por linha
// produto passa a ser controlado como produto acabado: item de estoque com o mesmo nome (reaproveita se já existir)
async function controlAsFinished(db, ctx, p) {
  let st = (await db.query('select id from stock_items where company_id = $1 and lower(name) = lower($2)', [ctx.companyId, p.name.slice(0, 80)])).rows[0];
  if (!st) st = (await db.query("insert into stock_items (company_id, name, unit, avg_cost_cents) values ($1,$2,'un',$3) returning id", [ctx.companyId, p.name.slice(0, 80), Number(p.cost_cents) || 0])).rows[0];
  await db.query("update products set stock_mode = 'acabado', stock_item_id = $3, updated_at = now() where id = $1 and company_id = $2", [p.id, ctx.companyId, st.id]);
  await audit(db, ctx, 'estoque.produtos_controlados', { entity: 'product', entityId: p.id, data: { origem: 'maquininha', stock_item_id: st.id } });
  return st.id;
}

// cadastra no cardápio os produtos da maquininha que não existem no RUSTEN (já com controle de estoque) e liga as linhas
router.post('/:id/items/create-products', need('financeiro.visualizar'), h(async (req, res) => {
  assertCan(req.ctx, 'estoque.ajustar'); assertCan(req.ctx, 'cardapio.gerenciar');
  const b = parse(z.object({ rows: z.array(z.object({ id: z.number().int(), name: z.string().trim().min(1).max(120), price_cents: z.number().int().min(0).max(100000000).nullable().default(null) })).min(1).max(200) }), req.body);
  const out = await tx(async (db) => {
    const imp = await loadImport(db, req.ctx, req.params.id, true);
    if (imp.status !== 'ativo') throw conflict('Importação cancelada');
    let cat = (await db.query("select id from categories where company_id = $1 and name = 'Maquininha' and not demo", [req.ctx.companyId])).rows[0];
    if (!cat) cat = (await db.query("insert into categories (company_id, name, sort) values ($1,'Maquininha',999) returning id", [req.ctx.companyId])).rows[0];
    const created = [];
    for (const r of b.rows) {
      const row = (await db.query("select id, status from pos_sales_items where id = $1 and import_id = $2 for update", [r.id, imp.id])).rows[0];
      if (!row || row.status !== 'pendente') throw bad('Linha inválida ou já lançada');
      let p = (await db.query('select id, name, cost_cents, stock_mode from products where company_id = $1 and lower(name) = lower($2) and active', [req.ctx.companyId, r.name])).rows[0];
      if (!p) {
        p = (await db.query(`insert into products (company_id, name, description, kind, unit, price_cents, cost_cents, category_id, active, channels)
            values ($1,$2,$3,'resale','un',$4,0,$5,true,'{pdv}') returning id, name, cost_cents, stock_mode`,
        [req.ctx.companyId, r.name, 'Cadastrado pela importação da maquininha: confira preço, categoria e ficha técnica.', r.price_cents ?? 0, cat.id])).rows[0];
        await db.query('insert into product_price_history (company_id, product_id, old_cents, new_cents, user_id) values ($1,$2,null,$3,$4)', [req.ctx.companyId, p.id, r.price_cents ?? 0, req.ctx.userId]);
        await audit(db, req.ctx, 'produto.criado', { entity: 'product', entityId: p.id, data: { name: r.name, price_cents: r.price_cents ?? 0, origem: 'maquininha' } });
        created.push(r.name);
      }
      if (p.stock_mode === 'nenhum') await controlAsFinished(db, req.ctx, p);
      await db.query('update pos_sales_items set product_id = $2 where id = $1', [r.id, p.id]);
    }
    return { created, view: await itemsView(db, req.ctx, imp) };
  });
  res.status(201).json(out);
}));

router.post('/:id/items/post', need('financeiro.visualizar'), h(async (req, res) => {
  assertCan(req.ctx, 'estoque.ajustar');
  const b = parse(z.object({ control_untracked: z.boolean().default(false) }), req.body || {});
  const out = await tx(async (db) => {
    const imp = await loadImport(db, req.ctx, req.params.id, true);
    if (imp.status !== 'ativo') throw conflict('Importação cancelada');
    if (imp.mode !== 'externa') throw conflict('Esta importação é só de conferência: as vendas já baixaram o estoque pelas comandas', 'conference_only');
    const rows = (await db.query("select * from pos_sales_items where import_id = $1 and status = 'pendente' order by id for update", [imp.id])).rows;
    const unmapped = rows.filter((r) => !r.product_id);
    if (unmapped.length) throw bad(`Escolha o produto (ou marque "ignorar") para: ${unmapped.slice(0, 5).map((r) => r.report_name).join(', ')}`, 'unmapped');
    if (!rows.length) throw bad('Nada pendente para lançar');
    // produtos ainda sem controle de estoque: passam a ser controlados como produto acabado (item de estoque com o mesmo nome)
    let controlled = [];
    if (b.control_untracked) {
      const un = (await db.query("select id, name, cost_cents from products where company_id = $1 and id = any($2) and stock_mode = 'nenhum' for update",
        [req.ctx.companyId, [...new Set(rows.map((r) => Number(r.product_id)))]])).rows;
      for (const p of un) await controlAsFinished(db, req.ctx, p);
      controlled = un.map((p) => p.name);
    }
    const co = (await db.query('select settings from companies where id = $1', [req.ctx.companyId])).rows[0];
    const cfg = stockConfig(co.settings);
    const per = `${String(imp.period_from).split('-').reverse().join('/')} a ${String(imp.period_to).split('-').reverse().join('/')}`;
    const plan = [];
    const total = new Map();
    for (const r of rows) {
      const p = (await db.query('select id, name, stock_mode, stock_item_id, cost_cents from products where id = $1 and company_id = $2', [r.product_id, req.ctx.companyId])).rows[0];
      const need = await requirements(db, req.ctx.companyId, p, Number(r.qty), []);
      plan.push({ r, p, need });
      for (const [id, q] of need) total.set(id, (total.get(id) || 0) + q);
    }
    const ids = [...total.keys()];
    const items = ids.length ? (await db.query('select id, name, unit, avg_cost_cents from stock_items where company_id = $1 and id = any($2) order by id for update', [req.ctx.companyId, ids])).rows : [];
    if (!cfg.allow_negative && ids.length) {
      const bal = await balances(db, req.ctx.companyId, ids);
      const short = items.filter((s) => (bal[s.id] || 0) - total.get(Number(s.id)) < -0.0001);
      if (short.length) throw conflict(`Estoque insuficiente: ${short.map((s) => `${s.name} (saldo ${(bal[s.id] || 0).toLocaleString('pt-BR')} ${s.unit})`).join(', ')}. Lance a entrada antes ou permita estoque negativo.`, 'stock_insufficient');
    }
    const cost = Object.fromEntries(items.map((s) => [Number(s.id), s.avg_cost_cents]));
    let moves = 0;
    for (const { r, p, need } of plan) {
      for (const [sid, q] of need) {
        const ins = await db.query(`insert into stock_movements (company_id, stock_item_id, kind, qty, unit_cost_cents, ref_type, ref_id, reason, user_id)
          values ($1,$2,'venda',$3,$4,'pos_sales_item',$5,$6,$7) on conflict do nothing returning id`,
        [req.ctx.companyId, sid, -q, cost[sid], r.id, `Venda na maquininha (${per}): ${r.report_name} × ${Number(r.qty).toLocaleString('pt-BR')}`.slice(0, 300), req.ctx.userId]);
        moves += ins.rowCount;
      }
      await db.query("update pos_sales_items set status = 'baixado', posted_at = now(), posted_by = $2 where id = $1", [r.id, req.ctx.userId]);
      if (r.source === 'relatorio') {
        await db.query(`insert into pos_product_aliases (company_id, provider, alias_norm, product_id) values ($1,'infinitepay',$2,$3)
          on conflict (company_id, provider, alias_norm) do update set product_id = excluded.product_id, updated_at = now()`, [req.ctx.companyId, normName(r.report_name), p.id]);
      }
    }
    await audit(db, req.ctx, 'maquininha.estoque_baixado', { entity: 'pos_sales_import', entityId: imp.id,
      data: { rows: rows.length, movements: moves, controlled, items: plan.map(({ r, p }) => ({ report: r.report_name, product: p.name, qty: Number(r.qty) })) } });
    return { posted: rows.length, movements: moves, controlled, without_stock: plan.filter((x) => !x.need.size).map((x) => x.p.name), view: await itemsView(db, req.ctx, imp) };
  });
  res.json(out);
}));

router.post('/:id/cancel', need('financeiro.estornar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(5, 'informe o motivo (mínimo 5 caracteres)').max(200) }), req.body);
  await tx(async (db) => {
    const i = (await db.query('select id, status from pos_sales_imports where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!i) throw notFound('Importação não encontrada');
    if (i.status !== 'ativo') throw conflict('Importação já cancelada');
    const reversed = await cancelImport(db, req.ctx, i.id, b.reason);
    await audit(db, req.ctx, 'maquininha.importacao_cancelada', { entity: 'pos_sales_import', entityId: i.id, reason: b.reason, data: { stock_reversed_rows: reversed } });
  });
  res.json({ ok: true });
}));
