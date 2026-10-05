// Busca do XML de uma NF-e recebida pela chave (Focus NFe — manifestação do destinatário).
// Exige que a empresa tenha conta na Focus NFe com o CNPJ do restaurante e o certificado digital cadastrados.
import { Buffer } from 'node:buffer';
import { q, bad, HttpError } from './core.js';

const BASE = () => String(process.env.FOCUS_API_URL || 'https://api.focusnfe.com.br').replace(/\/$/, '');

export async function focusToken(companyId) {
  return (await q("select value from company_secrets where company_id = $1 and key = 'focus_token'", [companyId])).rows[0]?.value || null;
}

async function call(token, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${BASE()}${path}`, {
      method, signal: AbortSignal.timeout(20000),
      headers: { authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { throw new HttpError(502, 'Focus NFe não respondeu. Tente de novo em instantes.', 'focus_unavailable'); }
  const text = await res.text();
  return { status: res.status, text };
}

/**
 * Devolve { xml } quando o XML completo está disponível; senão registra a ciência da operação
 * (necessária para a SEFAZ liberar o XML) e devolve { pending: true, message }.
 */
export async function xmlByKey(companyId, key) {
  const token = await focusToken(companyId);
  if (!token) throw bad('Busca do XML pela chave não configurada. Informe o token da Focus NFe ou importe o arquivo XML.', 'focus_not_configured');
  const r = await call(token, `/v2/nfes_recebidas/${key}.xml`);
  if (r.status === 200 && /<infNFe[\s>]/.test(r.text) && r.text.includes(key)) return { xml: r.text };
  if (r.status === 401 || r.status === 403) throw bad('A Focus NFe recusou o token. Confira em Estoque › Lançar nota.', 'focus_auth');
  // XML resumido/sem itens: pede a ciência da operação e avisa que fica disponível em alguns minutos
  const m = await call(token, `/v2/nfes_recebidas/${key}/manifesto`, { method: 'POST', body: { tipo: 'ciencia' } });
  if (m.status >= 500) throw new HttpError(502, 'Focus NFe indisponível no momento.', 'focus_unavailable');
  const already = /j[aá] (foi )?(realizad|registrad|manifest)/i.test(m.text);
  if (m.status >= 400 && !already) {
    let msg = ''; try { msg = JSON.parse(m.text).mensagem || ''; } catch { /* texto livre */ }
    throw bad(`A Focus NFe não encontrou esta nota para o CNPJ da empresa${msg ? `: ${msg}` : ''}. Importe o XML enviado pelo fornecedor.`, 'focus_not_found');
  }
  return { pending: true, message: 'Ciência da nota registrada na SEFAZ. O XML com os itens costuma ficar disponível em alguns minutos: leia o código de novo.' };
}
