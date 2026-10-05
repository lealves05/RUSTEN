// F05: token de renovação em cookie HttpOnly (o JavaScript da página não consegue lê-lo) e token de acesso só em memória.
// Ativado pelo site com o cabeçalho "x-session-mode: cookie". Sem ele, a API responde como antes (refresh no corpo),
// para que a versão anterior do site continue funcionando durante a transição.
//
// Proteções do modo cookie:
//  - cookie __Host- (só HTTPS, Path=/, sem Domain: vale apenas para o endereço exato do site), SameSite=Strict
//  - renovação/saída exigem o cabeçalho próprio (navegador não envia de outro site sem permissão de CORS) e Origin igual
//    ao endereço do site (informado pelo Worker em x-edge-site) ou a uma origem configurada em CORS_ORIGINS
import { HttpError } from './core.js';
import { REFRESH_TTL_DAYS } from './auth.js';
import { env } from './env.js';

export const COOKIE = '__Host-rusten_rt';

export const cookieMode = (req) => String(req.get('x-session-mode') || '').toLowerCase() === 'cookie';

export function readCookie(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Recusa chamadas com cookie vindas de outra origem (CSRF). */
export function assertSameOrigin(req) {
  const origin = String(req.get('origin') || '');
  if (!origin) throw new HttpError(403, 'Origem da requisição não informada.', 'csrf');
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Origem inválida.', 'csrf'); }
  const site = String(req.get('x-edge-site') || '');
  const allowed = String(env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const dev = env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  if (!(site && host === site) && !allowed.includes(origin) && !dev) throw new HttpError(403, 'Origem não autorizada.', 'csrf');
}

const cookieValue = (v, maxAge) =>
  `${COOKIE}=${v ? encodeURIComponent(v) : ''}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

/** Envia os tokens: no modo cookie, o refresh vai só no cookie (fora do corpo). */
export function sendTokens(req, res, tokens, status = 200) {
  if (!cookieMode(req)) return res.status(status).json(tokens);
  const { refresh_token: rt, ...rest } = tokens;
  res.append('Set-Cookie', cookieValue(rt, REFRESH_TTL_DAYS * 86400));
  res.set('Cache-Control', 'no-store');
  return res.status(status).json({ ...rest, session: 'cookie' });
}

export function clearRefreshCookie(res) {
  res.append('Set-Cookie', cookieValue('', 0));
}

/**
 * Token de renovação da requisição: do corpo (modo antigo, e migração do site novo que ainda achou um token guardado)
 * ou do cookie (modo cookie, com verificação de origem).
 */
export function readRefresh(req) {
  const body = String(req.body?.refresh_token || '');
  if (cookieMode(req)) assertSameOrigin(req);
  if (body) return body;
  return cookieMode(req) ? String(readCookie(req) || '') : '';
}
