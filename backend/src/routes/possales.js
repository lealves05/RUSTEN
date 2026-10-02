// Vendas feitas direto na maquininha (fora do RUSTEN): importação do relatório de vendas da InfinitePay.
// O navegador lê o PDF e envia os números + o arquivo original; aqui os números são conferidos entre si
// (dias × total, formas × total, taxas = bruto − líquido) antes de gravar. Nada é editado depois: só cancelado.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict, forbidden } from '../lib/core.js';
import { need, audit } from '../lib/auth.js';

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
      await db.query('update pos_sales_days set active = false where import_id = $1', [o.id]);
      await db.query("update pos_sales_imports set status = 'cancelado', canceled_by = $2, canceled_at = now(), cancel_reason = $3 where id = $1",
        [o.id, req.ctx.userId, `Substituída pela importação #${imp.id}`]);
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

router.post('/:id/cancel', need('financeiro.estornar'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(5, 'informe o motivo (mínimo 5 caracteres)').max(200) }), req.body);
  await tx(async (db) => {
    const i = (await db.query('select id, status from pos_sales_imports where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!i) throw notFound('Importação não encontrada');
    if (i.status !== 'ativo') throw conflict('Importação já cancelada');
    await db.query('update pos_sales_days set active = false where import_id = $1', [i.id]);
    await db.query("update pos_sales_imports set status = 'cancelado', canceled_by = $2, canceled_at = now(), cancel_reason = $3 where id = $1", [i.id, req.ctx.userId, b.reason]);
    await audit(db, req.ctx, 'maquininha.importacao_cancelada', { entity: 'pos_sales_import', entityId: i.id, reason: b.reason });
  });
  res.json({ ok: true });
}));
