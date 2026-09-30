// Formatação brasileira. Dinheiro sempre em centavos inteiros.
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents) => (cents == null ? '—' : brl.format(Number(cents) / 100));

// "12,50" | "12.50" | "1.234,5" → 1250 / 123450, sem ponto flutuante
export function parseCents(input) {
  let s = String(input ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [int, dec = ''] = s.split('.');
  return Number(int) * 100 + Number((dec + '00').slice(0, 2));
}
export const centsToInput = (c) => (c == null ? '' : (Number(c) / 100).toFixed(2).replace('.', ','));

export function qtyFmt(q, unit = 'un') {
  const n = Number(q);
  return unit === 'un' ? `${n}` : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${unit}`;
}
export const dateTime = (d, tz) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }) : '—');
export const time = (d, tz) => (d ? new Date(d).toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '—');
export const dateBR = (s) => (s ? s.split('-').reverse().join('/') : '—');
export const bp = (v) => `${(Number(v) / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
