// Códigos de barras de compras: chave da NF-e (DANFE, 44 dígitos) e pedido de compra emitido pelo RUSTEN.
const UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL',
  28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };

/** Dígito verificador da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda). */
export function nfeKeyDigit(first43) {
  let sum = 0; let w = 2;
  for (let i = first43.length - 1; i >= 0; i -= 1) { sum += Number(first43[i]) * w; w = w === 9 ? 2 : w + 1; }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export function isNfeKey(k) {
  return /^\d{44}$/.test(k) && nfeKeyDigit(k.slice(0, 43)) === Number(k[43]) && !!UF[k.slice(0, 2)];
}

/** O que dá para saber só pela chave: UF, mês/ano de emissão, CNPJ do emitente, modelo, série e número. */
export function parseNfeKey(k) {
  return {
    uf: UF[k.slice(0, 2)], issued: `20${k.slice(2, 4)}-${k.slice(4, 6)}`, cnpj: k.slice(6, 20), model: k.slice(20, 22),
    series: Number(k.slice(22, 25)), number: Number(k.slice(25, 34)),
  };
}

// Pedido de compra do RUSTEN: "PC" + número com 8 dígitos + dígito verificador (módulo 10). Ex.: PC000001234 + 7
const mod10 = (s) => { let sum = 0; for (let i = 0; i < s.length; i += 1) sum += Number(s[s.length - 1 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (sum % 10)) % 10; };
export const purchaseCode = (id) => { const n = String(id).padStart(8, '0'); return `PC${n}${mod10(n)}`; };

/** Classifica o texto lido pelo leitor/câmera. */
export function classifyCode(raw) {
  const s = String(raw || '').trim().toUpperCase();
  const digits = s.replace(/\D/g, '');
  if (/^PC\d{9}$/.test(s.replace(/[\s-]/g, ''))) {
    const c = s.replace(/[\s-]/g, '');
    const n = c.slice(2, 10);
    if (mod10(n) !== Number(c[10])) return { kind: 'invalido', message: 'Código do pedido com dígito inválido. Leia de novo.' };
    return { kind: 'pedido', purchase_id: Number(n) };
  }
  // DANFE: o código de barras traz só os 44 dígitos; digitado pode vir com espaços
  if (digits.length === 44 && /^[\d\s.-]+$/.test(s)) {
    if (!isNfeKey(digits)) return { kind: 'invalido', message: 'Chave de acesso inválida (dígito verificador não confere). Leia de novo.' };
    const info = parseNfeKey(digits);
    if (!['55', '65'].includes(info.model)) return { kind: 'invalido', message: 'Este código não é de uma NF-e.' };
    return { kind: 'nfe', key: digits, info };
  }
  return { kind: 'invalido', message: 'Código não reconhecido. Leia o código de barras do DANFE (44 dígitos) ou de um pedido de compra do RUSTEN.' };
}
