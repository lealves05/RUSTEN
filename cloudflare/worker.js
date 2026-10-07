// Cloudflare Worker: site (arquivos estáticos) + BFF em /api no mesmo endereço.
// Mesmo arquivo para ORBI, TORVEN, RUSTEN e Master; o que muda vem das variáveis do wrangler.jsonc:
//   API_UPSTREAM    base fixa da API (Supabase Edge Function), ex.: https://<ref>.supabase.co/functions/v1/orbi-api
//   API_ALLOW       prefixos de /api atendidos (vazio = todos)          ex.: "/api/master,/api/hub/"
//   API_DENY        prefixos de /api recusados com 404 neste endereço   ex.: "/api/master"
//   EXTRA_PROXY     outros prefixos encaminhados à API além de /api      ex.: "/webhooks"
//   CRON_PATH       rota chamada pelo agendamento (Cron Trigger), com Authorization: Bearer CRON_SECRET
//   SESSION_COOKIES nomes dos cookies de sessão repassados (ex.: "__Host-rusten_rt"); os demais cookies nunca passam
//   API_REGION      região onde a Edge Function roda (a mesma do banco), ex.: "sa-east-1"; sem ela a Supabase usa a mais próxima de quem chama
// Segredos (wrangler secret put): EDGE_PROXY_KEY (repasse do IP real à API), CRON_SECRET (só no Master).
// O destino é sempre API_UPSTREAM: nada que venha do navegador escolhe host, porta ou URL de destino.

const HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'];
// cabeçalhos de identidade/encaminhamento enviados pelo navegador nunca chegam à API como se fossem confiáveis
const STRIP_REQ = /^(x-forwarded-|x-real-ip$|forwarded$|cf-|x-edge-|x-orbi-|x-vercel-|x-region$|true-client-ip$|x-client-ip$|cookie$)/i;

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
// x-region: a Edge Function roda na região do banco (cada consulta fica perto dele); só o próprio site escolhe a região
const regionOf = (env) => (/^[a-z]{2}-[a-z]+-\d$/.test(String(env.API_REGION || '').trim()) ? String(env.API_REGION).trim() : '');
const hasPrefix = (path, prefixes) => prefixes.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p.endsWith('/') ? p : `${p}/`));

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

function isApi(path, env) {
  if (path === '/api' || path.startsWith('/api/')) return true;
  return hasPrefix(path, list(env.EXTRA_PROXY));
}

async function proxy(request, env, url) {
  const path = url.pathname;
  const allow = list(env.API_ALLOW);
  if (hasPrefix(path, list(env.API_DENY)) || (allow.length && !hasPrefix(path, allow))) {
    return json(404, { error: 'Rota não encontrada' });
  }
  const base = String(env.API_UPSTREAM || '').replace(/\/$/, '');
  const okBase = /^https:\/\/[a-z0-9.-]+(\/[\w./-]*)?$/i.test(base)
    || (env.ALLOW_HTTP_UPSTREAM === '1' && /^http:\/\/(127\.0\.0\.1|localhost):\d+(\/[\w./-]*)?$/.test(base)); // só testes locais (wrangler dev)
  if (!okBase) return json(500, { error: 'API não configurada neste endereço.' });
  if (path.includes('..') || path.includes('//')) return json(400, { error: 'Requisição inválida.' });
  const target = new URL(base + path + url.search);
  target.searchParams.delete('forceFunctionRegion'); // a região é decidida aqui, não pelo navegador

  const headers = new Headers();
  for (const [k, v] of request.headers) {
    if (HOP.includes(k.toLowerCase()) || STRIP_REQ.test(k)) continue;
    headers.set(k, v);
  }
  // só os cookies de sessão conhecidos seguem para a API (nenhum outro cookie do domínio é repassado)
  const allowCookies = list(env.SESSION_COOKIES);
  if (allowCookies.length) {
    const kept = String(request.headers.get('cookie') || '').split(';').map((c) => c.trim())
      .filter((c) => allowCookies.includes(c.slice(0, c.indexOf('='))));
    if (kept.length) headers.set('cookie', kept.join('; '));
  }
  const ip = request.headers.get('cf-connecting-ip');
  if (env.EDGE_PROXY_KEY && ip) {
    headers.set('x-edge-proxy-key', env.EDGE_PROXY_KEY);
    headers.set('x-edge-client-ip', ip);
  }
  headers.set('x-edge-site', url.host);
  const region = regionOf(env);
  if (region) headers.set('x-region', region);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual', // redirecionamento da API nunca é seguido aqui (não leva credenciais a outro host)
    });
  } catch {
    return json(502, { error: 'Servidor indisponível. Tente novamente em instantes.' });
  }

  const out = new Headers(upstream.headers);
  out.delete('set-cookie');
  // F05: repassa só os cookies de sessão conhecidos, sem atributo Domain (ficam presos a este endereço)
  if (allowCookies.length) {
    const all = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
    for (const c of all) {
      const name = c.slice(0, c.indexOf('=')).trim();
      if (allowCookies.includes(name) && !/;\s*domain\s*=/i.test(c) && /;\s*secure/i.test(c) && /;\s*httponly/i.test(c)) out.append('set-cookie', c);
    }
  }
  for (const h of ['access-control-allow-origin', 'access-control-allow-credentials', 'server', 'x-powered-by', 'sb-gateway-version', 'sb-project-ref', 'x-served-by']) out.delete(h);
  if (!out.has('cache-control')) out.set('Cache-Control', 'no-store');
  out.set('X-Content-Type-Options', 'nosniff');
  const loc = out.get('location');
  if (loc) {
    // redirecionamento para a própria API vira caminho relativo; outros destinos só se forem https
    try {
      const l = new URL(loc, target);
      if (l.origin === target.origin && l.pathname.startsWith(new URL(base).pathname)) out.set('location', l.pathname.slice(new URL(base).pathname.length) + l.search);
      else if (l.protocol !== 'https:') out.delete('location');
    } catch { out.delete('location'); }
  }
  // 404 da plataforma (função inexistente) volta como JSON, nunca como página
  if (upstream.status === 404 && !String(out.get('content-type') || '').includes('json')) return json(404, { error: 'Rota não encontrada' });
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isApi(url.pathname, env)) return proxy(request, env, url);
    // demais caminhos: arquivos do site; rotas da aplicação caem no index.html (not_found_handling)
    return env.ASSETS.fetch(request);
  },

  // Rotinas diárias (antes: Vercel Cron). Só roda se CRON_PATH e o segredo CRON_SECRET estiverem configurados.
  async scheduled(_event, env, ctx) {
    if (!env.CRON_PATH || !env.CRON_SECRET) return;
    const base = String(env.API_UPSTREAM || '').replace(/\/$/, '');
    ctx.waitUntil(fetch(`${base}${env.CRON_PATH}`, { headers: { Authorization: `Bearer ${env.CRON_SECRET}`, ...(regionOf(env) ? { 'x-region': regionOf(env) } : {}) } })
      .then(async (r) => console.log(JSON.stringify({ cron: env.CRON_PATH, status: r.status })))
      .catch((e) => console.log(JSON.stringify({ cron: env.CRON_PATH, error: String(e?.message || e) }))));
  },
};
