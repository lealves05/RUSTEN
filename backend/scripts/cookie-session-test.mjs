// F05: sessão com o token de renovação em cookie HttpOnly, testada pelo site (Worker) como o navegador usa.
// Uso: SITE=http://127.0.0.1:3350 node scripts/cookie-session-test.mjs   (site local com wrangler dev e API de teste)
const SITE = (process.env.SITE || 'http://127.0.0.1:3350').replace(/\/$/, '');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(SITE)) { console.error('Só roda contra um site local.'); process.exit(1); }
const NAME = '__Host-rusten_rt';
let pass = 0; const fails = [];
const ok = (c, msg) => { if (c) { pass += 1; console.log('  ok ', msg); } else { fails.push(msg); console.log('  FALHOU', msg); } };

const jar = new Map();
const keep = (res) => {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const v = pair.slice(i + 1);
    if (/max-age=0/i.test(c) || !v) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), v);
  }
};
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function call(path, { method = 'GET', body, access, origin = SITE, cookie = true, mode = 'cookie', extra = {} } = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  if (mode) headers['x-session-mode'] = mode;
  if (origin) headers.origin = origin;
  if (access) headers.authorization = `Bearer ${access}`;
  if (cookie && jar.size) headers.cookie = cookieHeader();
  const res = await fetch(`${SITE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const raw = res.headers.getSetCookie();
  keep(res);
  return { status: res.status, data: await res.json().catch(() => null), setCookie: raw };
}

// 1) entra (demonstração) no modo cookie: o refresh não vem no corpo, vem num cookie protegido
const d = await call('/api/auth/demo', { method: 'POST' });
ok(d.status === 200 || d.status === 201, `entrada na demonstração (${d.status})`);
ok(d.data?.access_token && !d.data?.refresh_token, 'refresh fora do corpo da resposta');
const sc = d.setCookie.find((c) => c.startsWith(`${NAME}=`)) || '';
ok(/HttpOnly/i.test(sc) && /Secure/i.test(sc) && /SameSite=Strict/i.test(sc) && /Path=\//.test(sc) && !/Domain=/i.test(sc), 'cookie __Host- HttpOnly, Secure, SameSite=Strict, sem Domain');
ok((await call('/api/auth/me', { access: d.data.access_token })).status === 200, 'token de acesso (memória) abre /me');

// 2) renovação pelo cookie gira o token
const before = jar.get(NAME);
const r1 = await call('/api/auth/refresh', { method: 'POST', body: {} });
ok(r1.status === 200 && r1.data?.access_token && !r1.data?.refresh_token, 'renovação pelo cookie devolve novo acesso');
ok(jar.get(NAME) && jar.get(NAME) !== before, 'cookie de renovação foi trocado');

// 3) CSRF: sem Origin, outra origem ou sem o cabeçalho próprio
const saved = jar.get(NAME);
ok((await call('/api/auth/refresh', { method: 'POST', body: {}, origin: null })).status === 403, 'sem Origin: recusado (403)');
ok((await call('/api/auth/refresh', { method: 'POST', body: {}, origin: 'https://site-malicioso.example' })).status === 403, 'outra origem: recusado (403)');
const noMode = await call('/api/auth/refresh', { method: 'POST', body: {}, mode: null });
ok(noMode.status === 401, 'sem o cabeçalho do modo cookie o cookie é ignorado (401)');
ok(jar.get(NAME) === saved, 'tentativas recusadas não alteram o cookie');

// 4) reuso do cookie antigo = possível roubo: encerra todas as sessões
jar.set(NAME, before);
const reuse = await call('/api/auth/refresh', { method: 'POST', body: {} });
ok(reuse.status === 401, 'reuso do cookie antigo recusado');
jar.set(NAME, saved);
ok((await call('/api/auth/refresh', { method: 'POST', body: {} })).status === 401, 'depois do reuso, a sessão atual também foi encerrada');
ok(!jar.has(NAME), 'cookie apagado pela API após a sessão ser encerrada');

// 5) modo antigo (site anterior) continua funcionando: refresh no corpo
const old = await call('/api/auth/demo', { method: 'POST', mode: null, cookie: false });
ok(old.data?.refresh_token && !old.setCookie.some((c) => c.startsWith(`${NAME}=`)), 'modo antigo: refresh no corpo, sem cookie');
const oldR = await call('/api/auth/refresh', { method: 'POST', mode: null, cookie: false, body: { refresh_token: old.data.refresh_token } });
ok(oldR.status === 200 && oldR.data?.refresh_token, 'modo antigo: renovação pelo corpo');

// 6) migração: site novo com token antigo guardado manda o token no corpo e passa a usar o cookie
jar.clear();
const mig = await call('/api/auth/refresh', { method: 'POST', body: { refresh_token: oldR.data.refresh_token } });
ok(mig.status === 200 && !mig.data?.refresh_token && jar.has(NAME), 'migração do token antigo para o cookie');

// 7) sair apaga o cookie e encerra a sessão
const out = await call('/api/auth/logout', { method: 'POST', access: mig.data.access_token, body: {} });
ok(out.status === 200 && !jar.has(NAME), 'sair apaga o cookie');
jar.set(NAME, mig.setCookie.find((c) => c.startsWith(`${NAME}=`)).split(';')[0].split('=').slice(1).join('='));
ok((await call('/api/auth/refresh', { method: 'POST', body: {} })).status === 401, 'cookie de sessão encerrada não renova');

// 8) outros cookies do domínio não chegam à API
const other = await call('/api/health', { extra: { cookie: 'rastreio=123' }, cookie: false });
ok(other.status === 200, 'cookies estranhos são descartados pelo site (resposta normal)');

console.log(`\n${pass} verificações OK, ${fails.length} falhas`);
if (fails.length) { fails.forEach((f) => console.log(' -', f)); process.exit(1); }
