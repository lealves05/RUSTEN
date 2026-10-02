// Leitura do "Relatório de vendas — InfinitePay" (PDF do app/portal). Função pura: recebe as linhas do PDF
// (cada linha = células de texto da esquerda para a direita) e devolve os números em centavos.
// O servidor confere de novo a consistência antes de gravar.

const MONEY = /^-?R\$\s*([\d.]+,\d{2})/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export const toCents = (s) => {
  const m = String(s).trim().match(MONEY);
  if (!m) return null;
  const v = Math.round(Number(m[1].replace(/\./g, '').replace(',', '.')) * 100);
  return String(s).trim().startsWith('-') ? -v : v;
};
const toIso = (s) => { const m = String(s).trim().match(DATE); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const toInt = (s) => (/^\d[\d.]*$/.test(String(s).trim()) ? Number(String(s).trim().replace(/\./g, '')) : null);
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * @param {string[][]} rows linhas do PDF, na ordem de leitura (todas as páginas)
 * @returns {{ ok: boolean, errors: string[], report: object }}
 */
export function parseInfinitePayReport(rows) {
  const errors = [];
  const R = rows.map((r) => r.map((c) => String(c).trim()).filter(Boolean)).filter((r) => r.length);
  const flat = R.map((r) => r.join(' '));
  const after = (label) => { const i = R.findIndex((r) => r.length === 1 && norm(r[0]) === label); return i >= 0 && R[i + 1] ? R[i + 1].join(' ') : null; };
  // pares de indicadores: ["RECEITA BRUTA","RECEITA LÍQUIDA"] seguido de ["R$ ...","R$ ..."]
  const kpi = {};
  R.forEach((r, i) => {
    const next = R[i + 1] || [];
    r.forEach((c, j) => { if (/^[A-ZÀ-Ú ]+$/.test(c) && next[j] != null && !kpi[norm(c)]) kpi[norm(c)] = next[j]; });
  });

  const report = { account: after('CONTA / CONTEXTO'), generated_on: toIso(after('GERADO EM') || ''), period_from: null, period_to: null,
    gross_cents: null, net_cents: null, fee_cents: null, tx_count: null, days: [], methods: [], products: [], categories: [], notes: [] };

  if (!flat.some((l) => /RELATORIO DE VENDAS/.test(norm(l)))) errors.push('Não parece o "Relatório de vendas" da InfinitePay.');
  const per = flat.map((l) => l.match(/(\d{2}\/\d{2}\/\d{4})\s+a\s+(\d{2}\/\d{2}\/\d{4})/)).find(Boolean);
  if (per) { report.period_from = toIso(per[1]); report.period_to = toIso(per[2]); } else errors.push('Período do relatório não encontrado.');

  report.gross_cents = toCents(kpi['RECEITA BRUTA'] || '');
  report.net_cents = toCents(kpi['RECEITA LIQUIDA'] || '');
  report.tx_count = toInt(kpi.TRANSACOES || '');
  report.fee_cents = toCents(kpi.TAXAS || '');
  if (report.gross_cents == null || report.net_cents == null) errors.push('Receita bruta/líquida não encontrada.');
  if (report.tx_count == null) errors.push('Número de transações não encontrado.');
  if (report.fee_cents == null && report.gross_cents != null && report.net_cents != null) report.fee_cents = report.gross_cents - report.net_cents;

  // tabelas "Dados do gráfico": cabeçalho seguido das linhas (o cabeçalho pode se repetir na página seguinte)
  const table = (header, rowFn) => {
    const out = [];
    for (let i = 0; i < R.length; i++) {
      if (norm(R[i][0]) !== header) continue;
      for (let j = i + 1; j < R.length; j++) {
        if (norm(R[j][0]) === header) continue; // cabeçalho repetido
        if (/^PAGINA \d+ DE \d+$/.test(norm(R[j].join(' ')))) continue;
        const v = rowFn(R[j]);
        if (!v) break;
        out.push(v);
      }
    }
    // a mesma linha pode ter sido lida duas vezes (cabeçalho repetido): remove duplicadas exatas
    const seen = new Set();
    return out.filter((x) => { const k = JSON.stringify(x); if (seen.has(k)) return false; seen.add(k); return true; });
  };
  let grouped = false;
  report.days = table('PERIODO', (r) => {
    if (r.length !== 4) return null;
    const day = toIso(r[0]);
    if (!day) { if (toCents(r[1]) != null) grouped = true; return null; }
    const g = toCents(r[1]); const n = toCents(r[2]); const t = toInt(r[3]);
    return g != null && n != null && t != null ? { day, gross_cents: g, net_cents: n, tx_count: t } : null;
  });
  if (grouped) errors.push('O relatório está agrupado por semana ou mês. Gere-o com os valores por dia.');
  if (!report.days.length && !grouped) errors.push('Tabela de valores por dia não encontrada.');

  report.methods = table('METODO', (r) => (r.length === 2 && toCents(r[1]) != null && toCents(r[0]) == null ? { label: r[0], gross_cents: toCents(r[1]) } : null));
  report.products = table('PRODUTO', (r) => (r.length === 2 && toInt(r[1]) != null ? { name: r[0].slice(0, 120), qty: toInt(r[1]) } : null));
  report.categories = table('CATEGORIA', (r) => (r.length === 2 && toInt(r[1]) != null ? { name: r[0].slice(0, 120), qty: toInt(r[1]) } : null));
  const obs = R.findIndex((r) => norm(r[0]) === 'OBSERVACOES SOBRE OS DADOS');
  if (obs >= 0) for (let j = obs + 1; j < R.length && R[j][0] === '•'; j++) report.notes.push(R[j].slice(1).join(' ').slice(0, 300));

  // conferências locais (o servidor repete)
  if (!errors.length) {
    const sg = report.days.reduce((s, d) => s + d.gross_cents, 0);
    const st = report.days.reduce((s, d) => s + d.tx_count, 0);
    if (Math.abs(sg - report.gross_cents) > Math.max(2, report.days.length)) errors.push(`A soma dos dias (${(sg / 100).toFixed(2)}) não bate com a receita bruta.`);
    if (st !== report.tx_count) errors.push(`A soma das transações por dia (${st}) não bate com o total (${report.tx_count}).`);
  }
  return { ok: !errors.length, errors, report };
}

/** Agrupa os textos de uma página do pdf.js em linhas (mesma altura) e células (ordem horizontal). */
export function pageRows(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5]; const x = it.transform[4];
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) { row = { y, cells: [] }; rows.push(row); }
    row.cells.push({ x, s: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.cells.sort((a, b) => a.x - b.x).map((c) => c.s));
}
