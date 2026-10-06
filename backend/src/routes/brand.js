// Marca do estabelecimento: logotipo, imagem de fundo do sistema e da TV, e o padrão do Painel da TV.
// Qualquer usuário logado lê (a TV e o menu precisam); só quem gerencia as configurações altera.
import { Buffer } from 'node:buffer';
import { Router } from 'express';
import { z } from 'zod';
import { q, h, parse, bad, notFound } from '../lib/core.js';
import { need, audit } from '../lib/auth.js';

export const router = Router();

const KINDS = { logo: 400 * 1024, fundo: 1600 * 1024, tv_fundo: 1600 * 1024 };
const kindOf = (k) => { if (!Object.prototype.hasOwnProperty.call(KINDS, k)) throw notFound('Imagem não encontrada'); return k; };

/** Valida a imagem (data URL PNG/JPEG/WebP, assinatura do arquivo e tamanho). SVG não é aceito (pode conter script). */
export function parseImage(dataUrl, max) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('Envie uma imagem JPG, PNG ou WebP');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > max) throw bad(`Imagem grande demais (máx. ${Math.round(max / 1024)} KB). Use uma imagem menor.`);
  const sig = buf.subarray(0, 4).toString('hex');
  const ok = { 'image/png': sig.startsWith('89504e47'), 'image/jpeg': sig.startsWith('ffd8'), 'image/webp': buf.subarray(8, 12).toString() === 'WEBP' }[m[1]];
  if (!ok) throw bad('O conteúdo do arquivo não é uma imagem válida');
  return buf.length;
}

/** Versões (data da última troca) de cada imagem da empresa: a tela só baixa de novo quando muda. */
export async function brandVersions(db, companyId) {
  const r = await db.query('select kind, floor(extract(epoch from updated_at))::bigint v from company_assets where company_id = $1', [companyId]);
  return Object.fromEntries(r.rows.map((x) => [`${x.kind}_v`, Number(x.v)]));
}

router.get('/', h(async (req, res) => {
  res.json(await brandVersions({ query: q }, req.ctx.companyId));
}));

// Padrão do Painel da TV para todas as TVs da empresa (cada TV ainda pode ajustar o seu)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const tvSchema = z.object({
  title: z.string().max(30), bg: z.string().max(20), image: z.string().max(500).refine((u) => !u || /^https:\/\//.test(u), 'Use um endereço https'),
  font: z.string().max(20), sound: z.string().max(20), volume: z.number().min(0).max(1), voice: z.boolean(), seconds: z.number().int().min(3).max(60),
  fireworks: z.boolean(), fireworksSound: z.boolean(), showName: z.boolean(), showItems: z.boolean(), showQueue: z.boolean(),
  showLogo: z.boolean(), showClock: z.boolean(), logoSize: z.number().min(4).max(20), scale: z.number().min(0.7).max(1.6), overlay: z.number().min(0).max(0.9),
  ink: color.or(z.literal('')), accent: color.or(z.literal('')), readyLabel: z.string().max(40), queueLabel: z.string().max(40), emptyLabel: z.string().max(60),
  ticker: z.string().max(200), voiceText: z.string().max(120), voiceRate: z.number().min(0.6).max(1.4), cardStyle: z.string().max(20),
}).partial().strict();
router.get('/tv', h(async (req, res) => {
  const r = await q("select settings->'tv' as tv from companies where id = $1", [req.ctx.companyId]);
  res.json(r.rows[0]?.tv || null);
}));
router.put('/tv', need('configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(tvSchema, req.body);
  await q("update companies set settings = jsonb_set(settings, '{tv}', $2::jsonb) where id = $1", [req.ctx.companyId, JSON.stringify(b)]);
  await audit({ query: q }, req.ctx, 'configuracoes.tv', { entity: 'company', entityId: req.ctx.companyId, data: { keys: Object.keys(b) } });
  res.json({ ok: true });
}));

router.get('/:kind', h(async (req, res) => {
  const r = await q('select data_url from company_assets where company_id = $1 and kind = $2', [req.ctx.companyId, kindOf(req.params.kind)]);
  res.setHeader('cache-control', 'private, max-age=0');
  res.json({ data_url: r.rows[0]?.data_url || null });
}));
router.put('/:kind', need('configuracoes.gerenciar'), h(async (req, res) => {
  const kind = kindOf(req.params.kind);
  const bytes = parseImage(req.body?.data_url, KINDS[kind]);
  await q(`insert into company_assets (company_id, kind, data_url, bytes) values ($1,$2,$3,$4)
           on conflict (company_id, kind) do update set data_url = excluded.data_url, bytes = excluded.bytes, updated_at = now()`,
  [req.ctx.companyId, kind, req.body.data_url, bytes]);
  await audit({ query: q }, req.ctx, 'marca.imagem', { entity: 'company', entityId: req.ctx.companyId, data: { kind, bytes } });
  res.json(await brandVersions({ query: q }, req.ctx.companyId));
}));
router.delete('/:kind', need('configuracoes.gerenciar'), h(async (req, res) => {
  const kind = kindOf(req.params.kind);
  await q('delete from company_assets where company_id = $1 and kind = $2', [req.ctx.companyId, kind]);
  await audit({ query: q }, req.ctx, 'marca.imagem_removida', { entity: 'company', entityId: req.ctx.companyId, data: { kind } });
  res.json(await brandVersions({ query: q }, req.ctx.companyId));
}));
