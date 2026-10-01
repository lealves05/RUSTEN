// Leitura de nota fiscal / pedido de compra: a foto é lida por um modelo de visão (Claude, API da Anthropic) e
// devolvida como linhas estruturadas; o XML da NF-e é lido sem IA. Nada entra no estoque sem a conferência do usuário.
import { q, HttpError } from './core.js';
import { env } from './env.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const aliasKey = (s) => norm(s).slice(0, 120);

async function aiConfig(companyId) {
  const own = (await q("select key, value from company_secrets where company_id = $1 and key in ('ai_api_key','ai_model')", [companyId])).rows;
  const plat = (await q("select key, value from platform_config where key in ('anthropic_api_key','ai_model')").catch(() => ({ rows: [] }))).rows;
  const get = (rows, k) => rows.find((r) => r.key === k)?.value;
  return {
    key: get(own, 'ai_api_key') || env.ANTHROPIC_API_KEY || get(plat, 'anthropic_api_key') || null,
    model: get(own, 'ai_model') || env.AI_MODEL || get(plat, 'ai_model') || 'claude-sonnet-5-5',
    url: env.AI_API_URL || 'https://api.anthropic.com/v1/messages',
  };
}
export async function aiAvailable(companyId) { return !!(await aiConfig(companyId)).key; }

const PROMPT = `Você lê documentos de compra de bares e restaurantes no Brasil: nota fiscal (NF-e/DANFE, NFC-e, cupom), pedido de compra,
romaneio ou lista escrita à mão. Extraia SOMENTE o que está escrito. Responda apenas com JSON válido, sem texto antes ou depois, no formato:
{"supplier": string|null, "document": string|null, "date": "AAAA-MM-DD"|null, "total": number|null,
 "items": [{"description": string, "qty": number, "unit": string|null, "unit_price": number|null, "total": number|null}],
 "warnings": [string]}
Regras: números com ponto decimal (12,50 → 12.5); "unit" como está na nota (UN, CX, KG, FD, PCT, L, GF...);
não invente itens, preços ou quantidades; se algo estiver ilegível, deixe null e explique em "warnings";
ignore impostos, descontos gerais e totalizadores (eles não são itens).`;

/* Foto → linhas. Lança 503 quando a leitura por foto não está configurada (nunca simula resultado). */
export async function readImage(companyId, dataUrl) {
  const cfg = await aiConfig(companyId);
  if (!cfg.key) throw new HttpError(503, 'Leitura por foto não configurada: informe a chave da API em Estoque › Leitura de notas, ou use o XML da NF-e.', 'ai_not_configured');
  const m = String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp|gif)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new HttpError(400, 'Envie uma foto (JPG, PNG ou WEBP) ou PDF', 'invalid');
  const source = { type: 'base64', media_type: m[1], data: m[2] };
  const block = m[1] === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
  let res;
  try {
    res = await fetch(cfg.url, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4000, messages: [{ role: 'user', content: [block, { type: 'text', text: PROMPT }] }] }),
    });
  } catch (e) {
    throw new HttpError(502, `Não foi possível ler a foto agora (${String(e.message || e).slice(0, 80)}). Tente de novo.`, 'ai_unavailable');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Serviço de leitura recusou a foto: ${body?.error?.message?.slice(0, 160) || res.status}`, 'ai_error');
  const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let out;
  try { out = JSON.parse(json); } catch { throw new HttpError(422, 'Não consegui entender a foto. Tente outra mais nítida, com a nota inteira e bem iluminada.', 'ai_unreadable'); }
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    supplier: out.supplier ? String(out.supplier).slice(0, 100) : null, document: out.document ? String(out.document).slice(0, 60) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(out.date || '') ? out.date : null, total: num(out.total),
    warnings: (out.warnings || []).map(String).slice(0, 10),
    items: (out.items || []).filter((i) => i && i.description).slice(0, 150).map((i) => ({
      description: String(i.description).slice(0, 120), qty: num(i.qty), unit: i.unit ? String(i.unit).slice(0, 10) : null,
      unit_price: num(i.unit_price), total: num(i.total) })),
  };
}

const UNIT_MAP = { un: 'un', und: 'un', unid: 'un', pc: 'un', pç: 'un', kg: 'kg', g: 'g', gr: 'g', l: 'L', lt: 'L', ml: 'ml' };
export const guessUnit = (u) => UNIT_MAP[norm(u)] || null;

/* Associa cada linha a um insumo: primeiro pelo apelido aprendido, depois por semelhança de nome. */
export async function matchLines(companyId, lines) {
  const items = (await q('select id, name, unit from stock_items where company_id = $1 and active', [companyId])).rows;
  const aliases = Object.fromEntries((await q('select alias, stock_item_id, factor from stock_aliases where company_id = $1', [companyId])).rows.map((a) => [a.alias, a]));
  return lines.map((l) => {
    const key = aliasKey(l.description);
    const al = aliases[key];
    if (al && items.find((i) => Number(i.id) === Number(al.stock_item_id))) return { ...l, alias: key, stock_item_id: Number(al.stock_item_id), factor: Number(al.factor), match: 'aprendido' };
    const words = key.split(' ').filter((w) => w.length > 2 && !/^\d+$/.test(w));
    let best = null; let score = 0;
    for (const it of items) {
      const iw = norm(it.name).split(' ').filter((w) => w.length > 2);
      if (!iw.length) continue;
      const hit = iw.filter((w) => words.some((x) => x.startsWith(w) || w.startsWith(x))).length;
      const s = hit / iw.length;
      if (s > score) { score = s; best = it; }
    }
    return { ...l, alias: key, stock_item_id: score > 0.5 ? Number(best.id) : null, factor: 1, match: score > 0.5 ? 'semelhante' : 'novo', suggested_unit: guessUnit(l.unit) || 'un' };
  });
}
