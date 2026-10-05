// RUSTEN API — carregadora (gerada por scripts/build-edge.mjs). Publique como Edge Function "rusten-api" (verify_jwt = false).
// O código da API é publicado junto com o site; cada instância nova baixa a versão atual.
import 'npm:bcryptjs@3.0.3';
import 'npm:cors@2.8.6';
import 'npm:express@5.2.1';
import 'npm:helmet@8.3.0';
import 'npm:jsonwebtoken@9.0.3';
import 'npm:pg@8.23.1';
import 'npm:zod@4.6.5';

// Ordem: endereço configurado (secret RUSTEN_BUNDLE_URL), site na Cloudflare e, durante a transição, o site antigo.
const SOURCES = [Deno.env.get('RUSTEN_BUNDLE_URL'), 'https://rusten.lorler.com.br/edge/rusten-api.js', 'https://rusten.vercel.app/edge/rusten-api.js']
  .filter((u, i, a) => u && /^https:\/\//.test(u) && a.indexOf(u) === i);
let code = null;
const errors = [];
for (const url of SOURCES) {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok && /javascript/.test(res.headers.get('content-type') || '')) { code = await res.text(); break; }
    errors.push(`${new URL(url).host}: ${res.status}`);
  } catch (e) { errors.push(`${new URL(url).host}: ${e?.name || 'erro'}`); }
}
if (!code) throw new Error(`Não foi possível baixar a API (${errors.join('; ')})`);
await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(code));
