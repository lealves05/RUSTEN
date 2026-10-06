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
