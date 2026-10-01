// RUSTEN API — carregadora (gerada por scripts/build-edge.mjs). Publique como Edge Function "rusten-api" (verify_jwt = false).
// O código da API é publicado junto com o site; cada instância nova baixa a versão atual.
import 'npm:bcryptjs@3.0.3';
import 'npm:cors@2.8.6';
import 'npm:express@5.2.1';
import 'npm:helmet@8.3.0';
import 'npm:jsonwebtoken@9.0.3';
import 'npm:pg@8.23.1';
import 'npm:zod@4.6.5';

const BUNDLE = Deno.env.get('RUSTEN_BUNDLE_URL') || 'https://rusten.vercel.app/edge/rusten-api.js';
const res = await fetch(`${BUNDLE}?t=${Date.now()}`);
if (!res.ok) throw new Error(`Não foi possível baixar a API (${res.status})`);
await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(await res.text()));
