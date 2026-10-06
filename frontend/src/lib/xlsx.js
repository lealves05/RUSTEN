// Leitor mínimo de planilhas .xlsx no navegador (primeira aba), sem biblioteca externa:
// abre o ZIP (DecompressionStream) e lê as células do XML. Devolve linhas como listas de textos.
const td = new TextDecoder();

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Lista os arquivos do ZIP: { nome → () => Promise<Uint8Array> } */
function unzip(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Arquivo .xlsx inválido ou corrompido');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true); const extraLen = dv.getUint16(p + 30, true); const commLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files[name] = async () => {
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return inflate(data);
      throw new Error('Compressão do .xlsx não suportada');
    };
    p += 46 + nameLen + extraLen + commLen;
  }
  return files;
}

const xml = (bytes) => new DOMParser().parseFromString(td.decode(bytes), 'application/xml');
const colIndex = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const textOf = (el) => [...el.getElementsByTagName('t')].map((t) => t.textContent).join('');

/** @returns {Promise<string[][]>} linhas da primeira aba, na posição da planilha (linha vazia = []) */
export async function readXlsx(arrayBuffer) {
  const files = unzip(arrayBuffer);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  try { // primeira aba de verdade, pela ordem do workbook
    const wb = xml(await files['xl/workbook.xml']());
    const rid = wb.getElementsByTagName('sheet')[0]?.getAttribute('r:id');
    const rels = xml(await files['xl/_rels/workbook.xml.rels']());
    const target = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  } catch { /* usa sheet1 */ }
  if (!files[sheetPath]) sheetPath = Object.keys(files).filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  if (!sheetPath) throw new Error('A planilha não tem abas');
  const shared = files['xl/sharedStrings.xml'] ? [...xml(await files['xl/sharedStrings.xml']()).getElementsByTagName('si')].map(textOf) : [];
  const sheet = xml(await files[sheetPath]());
  const rows = [];
  for (const row of sheet.getElementsByTagName('row')) {
    const r = Number(row.getAttribute('r')) - 1;
    const cells = [];
    let next = 0;
    for (const c of row.getElementsByTagName('c')) {
      const i = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : next;
      next = i + 1;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      cells[i] = t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? textOf(c) : t === 'b' ? (v === '1' ? 'sim' : 'nao') : v;
    }
    rows[r >= 0 ? r : rows.length] = Array.from(cells, (x) => (x == null ? '' : String(x).trim()));
  }
  return Array.from(rows, (r) => r || []); // posição = número da linha − 1
}

/** Número de série do Excel (dias desde 1899-12-30) → AAAA-MM-DD */
export const excelDate = (v) => {
  const n = Number(v);
  if (!/^\d+(\.\d+)?$/.test(String(v)) || n < 1 || n > 80000) return null;
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
};
