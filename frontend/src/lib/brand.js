// Marca do estabelecimento aplicada na interface: cor de destaque, tipos de letra, cantos, menu, logotipo e fundo.
// As cores passam por um ajuste de contraste para o texto continuar legível no tema claro e no escuro.
import { useEffect, useState } from 'react';
import { api } from './api.js';

export const DISPLAY_FONTS = {
  bebas: { label: 'Bebas Neue (padrão)', css: '"Bebas Neue", Impact, sans-serif', g: null },
  oswald: { label: 'Oswald (moderna)', css: 'Oswald, Impact, sans-serif', g: 'Oswald:wght@500;600' },
  anton: { label: 'Anton (impacto)', css: 'Anton, Impact, sans-serif', g: 'Anton' },
  playfair: { label: 'Playfair (elegante)', css: '"Playfair Display", Georgia, serif', g: 'Playfair+Display:wght@600;700' },
  righteous: { label: 'Righteous (retrô)', css: 'Righteous, sans-serif', g: 'Righteous' },
  montserrat: { label: 'Montserrat (limpa)', css: 'Montserrat, system-ui, sans-serif', g: 'Montserrat:wght@600;700' },
  lobster: { label: 'Lobster (manuscrita)', css: 'Lobster, cursive', g: 'Lobster' },
  inter: { label: 'Inter (simples)', css: 'Inter, system-ui, sans-serif', g: null },
};
export const BODY_FONTS = {
  inter: { label: 'Inter (padrão)', css: 'Inter, system-ui, sans-serif', g: null },
  roboto: { label: 'Roboto', css: 'Roboto, system-ui, sans-serif', g: 'Roboto:wght@400;500;700' },
  nunito: { label: 'Nunito (arredondada)', css: 'Nunito, system-ui, sans-serif', g: 'Nunito:wght@400;600;700' },
  poppins: { label: 'Poppins', css: 'Poppins, system-ui, sans-serif', g: 'Poppins:wght@400;500;600' },
  lato: { label: 'Lato', css: 'Lato, system-ui, sans-serif', g: 'Lato:wght@400;700' },
  source: { label: 'Source Sans', css: '"Source Sans 3", system-ui, sans-serif', g: 'Source+Sans+3:wght@400;600;700' },
};
export const ACCENTS = [
  ['#ce8a48', 'Cobre (RUSTEN)'], ['#d64545', 'Vermelho'], ['#e67e22', 'Laranja'], ['#e2b33c', 'Mostarda'], ['#3fa55b', 'Verde'],
  ['#1e9e8f', 'Turquesa'], ['#2f7fd1', 'Azul'], ['#6b5bd2', 'Roxo'], ['#c2457a', 'Vinho rosado'], ['#8d6e63', 'Café'],
];
export const DEFAULT_APPEARANCE = {
  theme: 'auto', density: 'confortavel', menu: 'lateral', accent: '', font_display: 'bebas', font_body: 'inter', radius: 'padrao', sidebar: 'padrao',
  logo_mode: 'rusten', brand_title: '', brand_subtitle: '', logo_size: 40, bg_overlay: 0.82, bg_blur: false, bg_fit: 'cobrir',
};

const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (c, to, k) => c.map((v, i) => Math.round(v + (to[i] - v) * k));
/** Ajusta a cor (escurece no claro, clareia no escuro) até ter contraste 4,5:1 com a superfície. */
export function readableAccent(h, dark) {
  const c = hex(h); if (!c) return null;
  const surface = dark ? [44, 42, 40] : [255, 252, 245];
  const to = dark ? [255, 255, 255] : [0, 0, 0];
  for (let k = 0; k <= 1.0001; k += 0.05) { const x = mix(c, to, k); if (ratio(x, surface) >= 4.5) return x; }
  return dark ? [255, 255, 255] : [0, 0, 0];
}

const loaded = new Set();
export function loadGoogleFont(spec) {
  if (!spec || loaded.has(spec)) return;
  loaded.add(spec);
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(l);
}

let current = { ...DEFAULT_APPEARANCE };
/** Aplica a aparência na página (chamado ao entrar, ao salvar e quando o tema claro/escuro muda). */
export function applyBrand(ap) {
  if (ap) current = { ...DEFAULT_APPEARANCE, ...ap };
  const root = document.documentElement;
  const dark = root.classList.contains('dark');
  const acc = current.accent ? readableAccent(current.accent, dark) : null;
  if (acc) root.style.setProperty('--copper', acc.join(' ')); else root.style.removeProperty('--copper');
  const df = DISPLAY_FONTS[current.font_display] || DISPLAY_FONTS.bebas;
  const bf = BODY_FONTS[current.font_body] || BODY_FONTS.inter;
  loadGoogleFont(df.g); loadGoogleFont(bf.g);
  root.style.setProperty('--font-display', df.css);
  root.style.setProperty('--font-body', bf.css);
  root.classList.toggle('r-reto', current.radius === 'reto');
  root.classList.toggle('r-round', current.radius === 'arredondado');
  root.classList.toggle('compact', current.density === 'compacta');
  root.dataset.sidebar = current.sidebar || 'padrao';
}

// Imagens da marca: baixadas uma vez por versão (a versão muda quando alguém troca a imagem)
const cache = new Map();
export function useBrandImage(kind, version) {
  const [url, setUrl] = useState(() => (version && cache.get(kind)?.v === version ? cache.get(kind).url : null));
  useEffect(() => {
    if (!version) { setUrl(null); return undefined; }
    const c = cache.get(kind);
    if (c?.v === version) { setUrl(c.url); return undefined; }
    let alive = true;
    api(`/api/brand/${kind}`).then((r) => { cache.set(kind, { v: version, url: r.data_url }); if (alive) setUrl(r.data_url); }).catch(() => {});
    return () => { alive = false; };
  }, [kind, version]);
  return url;
}
export const forgetBrandImage = (kind) => cache.delete(kind);

/** Lê o arquivo escolhido e reduz no navegador (logo: PNG/WebP com transparência; fundo: JPEG). */
export async function shrinkImage(file, { max, maxBytes, keepAlpha }) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma imagem JPG, PNG ou WebP');
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Não foi possível ler a imagem')); r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida')); i.src = src; });
  for (const [m, q] of [[max, 0.85], [Math.round(max * 0.8), 0.75], [Math.round(max * 0.6), 0.65], [Math.round(max * 0.45), 0.6]]) {
    const k = Math.min(1, m / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const out = keepAlpha ? (c.toDataURL('image/png').length * 0.75 < maxBytes ? c.toDataURL('image/png') : c.toDataURL('image/webp', q)) : c.toDataURL('image/jpeg', q);
    if (out.length * 0.75 < maxBytes && /^data:image\/(png|jpeg|webp)/.test(out)) return out;
  }
  throw new Error('Imagem grande demais mesmo reduzida. Tente outra.');
}

const readImage = async (file) => {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma imagem JPG, PNG ou WebP');
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Não foi possível ler a imagem')); r.readAsDataURL(file); });
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida')); i.src = src; });
};

/**
 * Ajuste automático do logotipo: tira o fundo liso (branco ou de uma cor só, a partir das bordas, sem mexer no
 * que está dentro do desenho), corta as sobras em volta e reduz para caber nos espaços do sistema e da TV.
 * @returns {Promise<{ data: string, removedBg: boolean, trimmed: boolean }>}
 */
export async function prepareLogo(file, { removeBg = true, max = 640, maxBytes = 380 * 1024 } = {}) {
  const img = await readImage(file);
  const k0 = Math.min(1, 1400 / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * k0)); const H = Math.max(1, Math.round(img.height * k0));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const id = ctx.getImageData(0, 0, W, H); const d = id.data;
  const at = (x, y) => (y * W + x) * 4;
  // cor de fundo: a mais comum nas bordas (se a borda for quase toda dessa cor)
  let removedBg = false;
  if (removeBg) {
    const border = [];
    for (let x = 0; x < W; x += Math.max(1, Math.floor(W / 200))) border.push(at(x, 0), at(x, H - 1));
    for (let y = 0; y < H; y += Math.max(1, Math.floor(H / 200))) border.push(at(0, y), at(W - 1, y));
    const opaque = border.filter((i) => d[i + 3] > 200);
    if (opaque.length > border.length * 0.9) {
      const q = (v) => v >> 4; const count = new Map();
      for (const i of opaque) { const key = `${q(d[i])},${q(d[i + 1])},${q(d[i + 2])}`; count.set(key, (count.get(key) || 0) + 1); }
      const [bestKey, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n > opaque.length * 0.85) {
        const [br, bg, bb] = (() => { let r = 0, g = 0, b = 0, m = 0; for (const i of opaque) if (`${q(d[i])},${q(d[i + 1])},${q(d[i + 2])}` === bestKey) { r += d[i]; g += d[i + 1]; b += d[i + 2]; m++; } return [r / m, g / m, b / m]; })();
        const dist = (i) => Math.max(Math.abs(d[i] - br), Math.abs(d[i + 1] - bg), Math.abs(d[i + 2] - bb));
        const TOL = 34; const SOFT = 70;
        const seen = new Uint8Array(W * H); const stack = [];
        const push = (x, y) => { const p = y * W + x; if (!seen[p] && dist(p * 4) <= SOFT) { seen[p] = 1; stack.push(p); } };
        for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
        for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
        while (stack.length) {
          const p = stack.pop(); const i = p * 4; const dd = dist(i);
          // fundo some; borda suave (antisserrilhado) fica semitransparente
          d[i + 3] = dd <= TOL ? 0 : Math.min(d[i + 3], Math.round(255 * (dd - TOL) / (SOFT - TOL)));
          if (dd > TOL) continue; // não atravessa a borda do desenho
          const x = p % W; const y = (p - x) / W;
          if (x > 0) push(x - 1, y); if (x < W - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < H - 1) push(x, y + 1);
        }
        ctx.putImageData(id, 0, 0);
        removedBg = true;
      }
    }
  }
  // corta as sobras transparentes em volta
  const px = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('O logotipo ficou vazio: use uma imagem com o desenho visível.');
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const cw = x1 - x0 + 1; const ch = y1 - y0 + 1;
  const trimmed = cw < W || ch < H;
  for (const m of [max, Math.round(max * 0.75), Math.round(max * 0.55), Math.round(max * 0.4)]) {
    const k = Math.min(1, m / Math.max(cw, ch));
    const o = document.createElement('canvas'); o.width = Math.max(1, Math.round(cw * k)); o.height = Math.max(1, Math.round(ch * k));
    o.getContext('2d').drawImage(c, x0, y0, cw, ch, 0, 0, o.width, o.height);
    for (const out of [o.toDataURL('image/png'), o.toDataURL('image/webp', 0.9), o.toDataURL('image/webp', 0.75)]) {
      if (/^data:image\/(png|webp)/.test(out) && out.length * 0.75 < maxBytes) return { data: out, removedBg, trimmed };
    }
  }
  throw new Error('Logotipo grande demais mesmo reduzido. Tente outra imagem.');
}
