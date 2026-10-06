// Lê uma planilha de cardápio salva como CSV (ou colada): nome, categoria, preço e, se houver, disponibilidade.
// Aceita separador ; , ou tabulação, aspas no padrão CSV e preços como "12,50", "R$ 1.234,50" ou "12.50".
import { parseCents } from './format.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const COLS = {
  name: ['nome', 'produto', 'item', 'descricao', 'nome do produto', 'name', 'product'],
  category: ['categoria', 'grupo', 'secao', 'category'],
  price: ['preco', 'valor', 'preco de venda', 'valor de venda', 'preco venda', 'price'],
  available: ['disponivel', 'ativo', 'status', 'situacao', 'available'],
};

function splitLine(line, sep) {
  const out = []; let cur = ''; let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"' && !cur.trim()) quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

const price = (s) => {
  let t = String(s || '').trim().replace(/[R$\s]/g, '');
  if (/^\d+\.\d{1,2}$/.test(t)) t = t.replace('.', ','); // 12.50 → 12,50
  return parseCents(t);
};
const avail = (s) => !/^(nao|n|0|false|inativo|indisponivel|unavailable|esgotado)$/.test(norm(s));

/** @returns {{ items: {name, category, price_cents, available}[], errors: string[] }} */
export function parseMenuCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { items: [], errors: ['O arquivo está vazio.'] };
  const sep = ['\t', ';', ','].map((s) => [s, lines[0].split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], sep).map(norm);
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, names]) => [k, head.findIndex((h) => names.includes(h))]));
  let rows = lines.slice(1);
  if (idx.name < 0 || idx.price < 0) {
    // sem cabeçalho reconhecido: assume nome; categoria; preço (ou nome; preço)
    rows = lines;
    const n = splitLine(lines[0], sep).length;
    Object.assign(idx, n >= 3 ? { name: 0, category: 1, price: 2, available: -1 } : { name: 0, category: -1, price: 1, available: -1 });
    if (n < 2) return { items: [], errors: ['Não reconheci as colunas. Use: nome; categoria; preço (a primeira linha pode ser o cabeçalho).'] };
  }
  const items = []; const errors = [];
  rows.forEach((line, i) => {
    const c = splitLine(line, sep);
    const name = (c[idx.name] || '').slice(0, 120);
    if (!name) return;
    const cents = price(c[idx.price]);
    if (cents == null) { if (errors.length < 8) errors.push(`Linha ${i + (rows === lines ? 1 : 2)}: preço inválido para "${name}".`); return; }
    items.push({ name, category: idx.category >= 0 ? (c[idx.category] || '').slice(0, 80) || null : null, price_cents: cents,
      available: idx.available >= 0 ? avail(c[idx.available]) : true });
  });
  if (!items.length && !errors.length) errors.push('Nenhum produto encontrado no arquivo.');
  return { items, errors };
}
