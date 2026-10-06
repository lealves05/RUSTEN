// Catálogo público da InfinitePay (Loja Online: loja.infinitepay.io/<InfiniteTag>).
// Só lê páginas públicas de um host fixo; a InfiniteTag é validada antes (sem SSRF).
// Fontes: o resumo para máquinas (/llms/<tag>.md: categorias e lista de produtos com preço) e a vitrine
// filtrada por categoria (para saber a categoria de cada produto e o preço de cada variação).

const HOST = 'https://loja.infinitepay.io';
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CATEGORIES = 80;
const MAX_PAGES = 15;

export const validHandle = (h) => /^[a-z0-9][a-z0-9_.-]{1,59}$/.test(h);

export const toCents = (s) => {
  const m = String(s).match(/R\$\s*([\d.]+,\d{2})/);
  return m ? Math.round(Number(m[1].replace(/\./g, '').replace(',', '.')) * 100) : null;
};

/** Lê o Markdown público (/llms/<tag>.md). */
export function parseLlms(md, handle) {
  const out = { store: null, categories: [], products: [] };
  const name = md.match(/^# Loja:\s*(.+)$/m);
  if (name) out.store = name[1].trim().slice(0, 120);
  const section = (title) => { const m = md.match(new RegExp(`^## ${title}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm')); return m ? m[1] : ''; };
  for (const line of section('Categories').split('\n')) {
    const m = line.match(/^-\s+(.+?)\s+\((\d+)-([a-z0-9-]*)\)\s*$/);
    if (m) out.categories.push({ ext_id: m[2], slug: `${m[2]}-${m[3]}`, name: m[1].trim().slice(0, 80) });
  }
  const esc = handle.replace(/[.]/g, '\\.');
  for (const line of section('Catalog').split('\n')) {
    // - Nome - R$ 10,00 - available - https://loja.infinitepay.io/llms/<tag>/<slug>.md  (o nome pode conter " - ")
    const m = line.match(new RegExp(`^-\\s+(.+)\\s+-\\s+(-?R\\$\\s*[\\d.]+,\\d{2})\\s+-\\s+([a-z_ ]+?)\\s+-\\s+https://loja\\.infinitepay\\.io/llms/${esc}/([a-z0-9-]+)\\.md\\s*$`));
    if (m) out.products.push({ slug: m[4], name: m[1].trim().slice(0, 120), price_cents: toCents(m[2]), available: m[3].trim() === 'available' });
  }
  return out;
}

const unescapeRsc = (html) => html.replace(/\\\\/g, '\u0000').replace(/\\"/g, '"').replace(/\u0000/g, '\\');
const jsonStr = (s) => { try { return JSON.parse(`"${s}"`); } catch { return s; } };

/** Lê os produtos da vitrine (payload do Next.js na página). */
export function parseStorefront(html, handle) {
  const t = unescapeRsc(html);
  const esc = handle.replace(/[.]/g, '\\.');
  const re = new RegExp(`"path":"/${esc}/([a-z0-9-]+)","info":\\{"sales_product":\\{([\\s\\S]*?)"product_default_variation_index":(\\d+)`, 'g');
  const products = [];
  const seen = new Set();
  for (const m of t.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    const body = m[2];
    const nm = body.match(/"name":"((?:[^"\\]|\\.)*)"/);
    const vars = [...body.matchAll(/\{"id":(\d+),"price":(\d+),"promotional_price":(null|\d+)[^}]*?"quantity":(null|-?\d+),"stock_control":(true|false)\}/g)]
      .map((v) => ({ id: Number(v[1]), price_cents: Number(v[2]), promo_cents: v[3] === 'null' ? null : Number(v[3]), quantity: v[4] === 'null' ? null : Number(v[4]), stock_control: v[5] === 'true' }));
    const def = vars[Number(m[3])] || vars[0];
    products.push({ slug: m[1], name: nm ? jsonStr(nm[1]).trim().slice(0, 120) : null, price_cents: def ? (def.promo_cents ?? def.price_cents) : null,
      variations: vars.length, available: !def || !def.stock_control || (def.quantity ?? 1) > 0 });
  }
  const meta = t.match(/"initialMeta":\{"current_page":(\d+),"next_page":(null|\d+)/);
  return { products, page: meta ? Number(meta[1]) : 1, next: meta && meta[2] !== 'null' ? Number(meta[2]) : null };
}

async function get(path, fetchImpl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetchImpl(HOST + path, { headers: { 'user-agent': 'RUSTEN/1.0 (importacao de cardapio)', accept: 'text/html,text/markdown,*/*' }, redirect: 'error', signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw Object.assign(new Error(`InfinitePay respondeu ${r.status}`), { upstream: r.status });
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error('Página da InfinitePay grande demais');
    return text;
  } finally { clearTimeout(timer); }
}

async function storefrontAll(handle, query, fetchImpl) {
  const all = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams(query);
    if (page > 1) qs.set('page', String(page));
    const html = await get(`/${handle}${qs.toString() ? `?${qs}` : ''}`, fetchImpl);
    if (!html) break;
    const r = parseStorefront(html, handle);
    let added = 0;
    for (const p of r.products) if (!all.has(p.slug)) { all.set(p.slug, p); added++; }
    if (!r.next || !added) break;
  }
  return [...all.values()];
}

/**
 * Busca o catálogo público. Retorna categorias e produtos (com a categoria de cada um, quando a vitrine informa).
 * @returns {Promise<null | {store, categories, products, warnings}>} null quando a loja não existe/não está publicada
 */
export async function fetchCatalog(handle, fetchImpl = globalThis.fetch) {
  const md = await get(`/llms/${handle}.md`, fetchImpl);
  if (md == null) return null;
  const base = parseLlms(md, handle);
  const warnings = [];
  const bySlug = new Map(base.products.map((p) => [p.slug, { ...p, category: null, variations: 1 }]));
  // vitrine completa: completa a lista (caso o resumo venha cortado) e traz as variações
  try {
    for (const p of await storefrontAll(handle, {}, fetchImpl)) {
      const cur = bySlug.get(p.slug);
      if (cur) Object.assign(cur, { variations: p.variations, price_cents: cur.price_cents ?? p.price_cents });
      else if (p.name) bySlug.set(p.slug, { ...p, category: null });
    }
  } catch { warnings.push('A vitrine não respondeu; usei só o resumo do catálogo.'); }
  const cats = base.categories.slice(0, MAX_CATEGORIES);
  if (base.categories.length > MAX_CATEGORIES) warnings.push(`Só as primeiras ${MAX_CATEGORIES} categorias foram lidas.`);
  let failed = 0;
  for (const c of cats) {
    try {
      const list = await storefrontAll(handle, { categories: c.slug }, fetchImpl);
      c.count = list.length;
      for (const p of list) {
        const cur = bySlug.get(p.slug) || (p.name ? bySlug.set(p.slug, { ...p, category: null }).get(p.slug) : null);
        if (cur && !cur.category) cur.category = c.name;
      }
    } catch { failed++; }
  }
  if (failed) warnings.push(`${failed} categoria(s) não puderam ser lidas; os produtos delas vêm sem categoria.`);
  const products = [...bySlug.values()].filter((p) => p.name && p.price_cents != null);
  return { store: base.store, categories: cats.map((c) => ({ name: c.name, count: c.count ?? null })), products, warnings };
}
