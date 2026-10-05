// IP real do cliente quando a API está atrás do site na Cloudflare (BFF em /api).
// O site envia o IP (CF-Connecting-IP) junto com a chave EDGE_PROXY_KEY, que só o site e a API conhecem.
// Sem a chave correta o cabeçalho é ignorado: o navegador não consegue forjar o IP usado nos limites de tentativas.
import crypto from 'node:crypto';

const env = () => (globalThis.process?.env ?? {});

export function edgeProxyIp(req, _res, next) {
  const key = env().EDGE_PROXY_KEY;
  const sent = req.headers['x-edge-proxy-key'];
  const ip = String(req.headers['x-edge-client-ip'] || '').trim();
  delete req.headers['x-edge-proxy-key'];
  if (key && typeof sent === 'string' && ip && /^[0-9a-fA-F:.]{3,64}$/.test(ip)) {
    const a = crypto.createHash('sha256').update(sent).digest();
    const b = crypto.createHash('sha256').update(key).digest();
    if (crypto.timingSafeEqual(a, b)) Object.defineProperty(req, 'ip', { value: ip, configurable: true });
  }
  next();
}
