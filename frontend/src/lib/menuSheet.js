// Lê uma planilha de produtos (exportada da InfinitePay, de outro sistema ou do próprio RUSTEN).
// Reconhece as colunas pelo cabeçalho; o que não reconhece é ignorado (impostos, estoque…).
import { parseCents } from './format.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
const COLS = {
  name: ['nome', 'produto', 'nome do produto', 'item', 'descricao', 'descricao do produto'],
  category: ['categoria', 'grupo', 'secao', 'category', 'categoria do produto'],
  price: ['preco venda', 'preco de venda', 'valor venda', 'valor de venda', 'preco', 'valor', 'price', 'preco unitario'],
  cost: ['preco custo', 'preco de custo', 'custo', 'valor custo', 'custo unitario'],
  sku: ['cod pdv', 'codigo pdv', 'codigo', 'cod', 'sku', 'codigo interno', 'cod interno', 'referencia'],
  codes: ['cod busca', 'codigo de barras', 'cod barras', 'codigos de barras', 'ean', 'gtin', 'codigos de leitura'],
  unit: ['medida', 'unidade', 'unid', 'un', 'unidade de venda'],
  status: ['status venda', 'status', 'situacao', 'ativo', 'disponivel'],
  sector: ['setor', 'setor de producao'],
  description: ['observacao', 'detalhes', 'descricao detalhada'],
};
export const COL_LABEL = { name: 'Nome', category: 'Categoria', price: 'Preço de venda', cost: 'Preço de custo', sku: 'Código', codes: 'Código de barras', unit: 'Medida', status: 'Situação', sector: 'Setor', description: 'Descrição' };

const money = (v) => {
  const s = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) { const n = Number(s); return n >= 0 ? Math.round(n * 100) : null; } // número do Excel (12.99)
  return parseCents(s);
};
const UNITS = { un: 'un', und: 'un', unid: 'un', unidade: 'un', pc: 'un', kg: 'kg', g: 'g', gr: 'g', l: 'L', lt: 'L', litro: 'L', ml: 'ml' };
const off = /^(pausado|inativo|nao|n|0|false|indisponivel|esgotado|desativado)$/;

/** @param {string[][]} grid @returns {{ items, errors: string[], skipped: number, columns: string[], missing: string[] }} */
export function parseMenuGrid(grid) {
  const h = grid.findIndex((r) => r && r.some((c) => String(c).trim()));
  if (h < 0) return { items: [], errors: ['A planilha está vazia.'], skipped: 0, columns: [], missing: ['name', 'price'] };
  const head = grid[h].map(norm);
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) {
    let i = -1;
    for (const n of names) { i = head.indexOf(n); if (i >= 0) break; }
    idx[k] = i;
  }
  // "Descrição" vira nome só se não houver coluna de nome
  if (idx.name >= 0 && COLS.name.slice(4).includes(head[idx.name]) && head.includes('nome')) idx.name = head.indexOf('nome');
  const missing = ['name', 'price'].filter((k) => idx[k] < 0);
  if (missing.length) return { items: [], errors: [`Não achei a coluna ${missing.map((k) => `"${COL_LABEL[k]}"`).join(' nem ')} na primeira linha.`], skipped: 0, columns: [], missing };
  const items = []; const errors = []; let skipped = 0;
  const cell = (r, k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    if (!r.some((c) => String(c).trim())) continue;
    const name = cell(r, 'name').replace(/\s+/g, ' ').slice(0, 120);
    const price = money(cell(r, 'price'));
    if (!name || /^total\b/i.test(name)) { skipped++; continue; } // linha de total/rodapé
    if (price == null) { if (errors.length < 10) errors.push(`Linha ${i + 1}: preço inválido em "${name}".`); skipped++; continue; }
    const st = norm(cell(r, 'status'));
    const unit = UNITS[norm(cell(r, 'unit'))] || null;
    const codes = cell(r, 'codes').split(/[\s,;|]+/).map((c) => c.trim()).filter((c) => c && !/^0+$/.test(c)).slice(0, 10);
    items.push({
      line: i + 1, name, category: cell(r, 'category').slice(0, 80) || null, price_cents: price,
      cost_cents: idx.cost >= 0 ? money(cell(r, 'cost')) : null, sku: cell(r, 'sku').slice(0, 40) || null, codes, unit,
      sector: cell(r, 'sector').slice(0, 60) || null, description: cell(r, 'description').slice(0, 500) || null,
      available: !(st && off.test(st)),
    });
  }
  if (!items.length && !errors.length) errors.push('Nenhum produto encontrado abaixo do cabeçalho.');
  return { items, errors, skipped, columns: Object.keys(COLS).filter((k) => idx[k] >= 0), missing: [] };
}

/** Linhas da planilha de exportação (mesmas colunas que a importação entende). */
export function menuExportRows(products) {
  const KIND = { resale: 'Revenda', recipe: 'Preparado', produced: 'Produção própria', combo: 'Combo', addon: 'Adicional', weight: 'Por peso' };
  return [
    ['Código', 'Código de barras', 'Categoria', 'Nome', 'Preço Custo', 'Preço Venda', 'Medida', 'Setor', 'Tipo', 'Status Venda', 'Descrição'],
    ...products.map((p) => [p.sku || '', p.codes || '', p.category || '', p.name, p.cost_cents == null ? '' : p.cost_cents / 100, p.price_cents / 100, p.unit,
      p.sector || '', KIND[p.kind] || p.kind, p.active ? 'Ativo' : 'Pausado', p.description || '']),
  ];
}
