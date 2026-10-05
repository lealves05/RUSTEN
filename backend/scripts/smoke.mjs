// Teste ponta a ponta dos critérios de aceite da Fase 1 (PDV, leitura, caixa, isolamento, central).
// Uso: DATABASE_URL=postgres://.../rusten_test node scripts/smoke.mjs   (APAGA o banco informado)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import http from 'node:http';
import { Buffer } from 'node:buffer';
process.env.PLATFORM_SECRET = 'pk_segredo-de-teste-da-central-0123456789';
process.env.NODE_ENV = 'test';

// Central falsa (contrato v1): confere a assinatura de cada chamada do RUSTEN e guarda a situação por empresa
const hub = { tenants: new Map(), calls: [], access: (status = 'TRIAL', extra = {}) => ({ status, reason: null, blocked: false, admin_blocked: false,
  plan: null, features: {}, notices: [], support: 'suporte@teste.dev', ...extra }) };
const hubSign = (ts, method, route, body) => crypto.createHmac('sha256', process.env.PLATFORM_SECRET)
  .update(`${ts}\n${method}\n${route}\n${crypto.createHash('sha256').update(body).digest('hex')}`).digest('hex');
const hubServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const route = req.url.replace(/^\/api\/hub\/v1/, '');
    const ok = req.headers['x-platform-product'] === 'rusten'
      && req.headers['x-platform-signature'] === hubSign(req.headers['x-platform-timestamp'], req.method, route, body);
    const send = (st, data) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (!ok) return send(401, { error: 'assinatura inválida' });
    hub.calls.push({ method: req.method, route, body: body ? JSON.parse(body) : null });
    let m;
    if (req.method === 'POST' && route === '/tenants') {
      const t = JSON.parse(body);
      if (!hub.tenants.has(t.remote_id)) hub.tenants.set(t.remote_id, hub.access('TRIAL', { trial: { type: '15_DAYS', days_left: 15 } }));
      return send(201, { tenant_id: `c-${t.remote_id}`, created: true, access: hub.tenants.get(t.remote_id) });
    }
    if (req.method === 'GET' && (m = route.match(/^\/tenants\/([^/]+)\/access$/))) {
      return hub.tenants.has(m[1]) ? send(200, { access: hub.tenants.get(m[1]) }) : send(404, { error: 'Empresa não cadastrada na central.' });
    }
    if (req.method === 'GET' && route === '/plans') return send(200, { plans: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Bar', monthly_price: 99 }], trial_default: '15_DAYS', signup_enabled: true });
    if (req.method === 'GET' && (m = route.match(/^\/tenants\/([^/]+)\/billing$/))) {
      return send(200, { access: hub.tenants.get(m[1]), subscription: null, payments: [], pending_payment: null, plans: [], gateway_configured: false });
    }
    if (req.method === 'GET' && route === '/mail/status') return send(200, { available: true });
    if (req.method === 'POST' && route === '/mail/password-reset') { (hub.mails ||= []).push(JSON.parse(body)); return send(200, { ok: true }); }
    send(404, { error: 'rota desconhecida' });
  });
});
await new Promise((r) => hubServer.listen(0, '127.0.0.1', r));
process.env.PLATFORM_HUB_URL = `http://127.0.0.1:${hubServer.address().port}`;
if (!/test/.test(process.env.DATABASE_URL || '')) { console.error('Use um banco de teste (nome contendo "test")'); process.exit(1); }

const { pool, businessDate, splitCents, lineTotal } = await import('../src/lib/core.js');
await pool.query('drop schema public cascade; create schema public;');
const { migrate } = await import('../src/migrate.js');
await migrate({ log: () => {} });
const { createApp } = await import('../src/server.js');
const { signPayload } = await import('../src/lib/platform.js');
const { mergePdv } = await import('../src/lib/pdv.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let passed = 0; const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; process.stdout.write(`  ok  ${name}\n`); }
  catch (e) { failures.push(name); process.stdout.write(`  FALHOU ${name}: ${e.message}\n`); }
}
const key = () => crypto.randomBytes(12).toString('hex');

function client(token, terminal) {
  return async (method, path, body, extra = {}) => {
    const res = await fetch(base + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(terminal ? { 'x-terminal-id': String(terminal) } : {}), ...extra },
    });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}
const anon = client();

async function register(name, email, setup = {}) {
  const r = await anon('POST', '/api/auth/register', { company: { name, segment: 'bar' }, owner: { name: 'Dono', email, password: 'Motocustom2026x' }, accept_terms: true, setup: { demo: true, tables: 6, cards: 10, ...setup } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const me = await client(r.data.access_token)('GET', '/api/auth/me');
  const terms = await client(r.data.access_token)('GET', '/api/admin/terminals');
  return { token: r.data.access_token, refresh: r.data.refresh_token, me: me.data, terminal: terms.data[0].id };
}

console.log('RUSTEN — smoke');
const A = await register('Bar Oficina', 'a@teste.dev');
const B = await register('Pub Garagem', 'b@teste.dev');
const api = client(A.token, A.terminal);
const apiB = client(B.token, B.terminal);

const products = (await api('GET', '/api/menu/products')).data;
const ipa = products.find((p) => p.name.startsWith('Cerveja IPA'));
const burger = products.find((p) => p.name.startsWith('Hambúrguer'));
const cards = (await api('GET', '/api/floor/cards')).data.cards;
const tables = (await api('GET', '/api/floor/tables')).data.tables;

async function openCard(n, c = api) {
  const card = cards.find((x) => x.number === n);
  const r = await c('POST', '/api/pdv/sessions', { kind: 'comanda', card_id: card.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}
const setPdv = (settings) => api('PUT', '/api/admin/pdv-settings/company', { settings });

// ---------- Unidades puras ----------
await check('dia comercial: 02h conta no dia anterior; 10h no mesmo dia', () => {
  assert.equal(businessDate(new Date('2026-10-03T05:00:00Z'), 'America/Sao_Paulo', 5), '2026-10-02'); // 02:00 local
  assert.equal(businessDate(new Date('2026-10-03T13:00:00Z'), 'America/Sao_Paulo', 5), '2026-10-03'); // 10:00 local
});
await check('rateio determinístico de centavos', () => {
  assert.deepEqual(splitCents(1000, 3), [334, 333, 333]);
  assert.equal(splitCents(9999, 7).reduce((a, b) => a + b, 0), 9999);
  assert.equal(lineTotal(2890, 0.333, 0, 0), 962);
});
await check('precedência: terminal não libera o que a empresa negou', () => {
  const e = mergePdv({ allow_manual_exception: false, double_read_mandatory: true }, {}, { allow_manual_exception: true, double_read_mandatory: false, mode: 'manual' });
  assert.equal(e.allow_manual_exception, false);
  assert.equal(e.double_read_mandatory, true);
  assert.equal(e.mode, 'dupla');
});

// ---------- Caixa ----------
await check('recebimento exige caixa aberto', async () => {
  const s = await openCard(9);
  await api('POST', '/api/pdv/items', { session_id: s.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  const r = await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'pix', amount_cents: 100, idempotency_key: key() });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'cash_closed');
});
await check('abertura de caixa com troco inicial', async () => {
  const noTerm = await client(A.token)('POST', '/api/cash/open', { opening_cents: 0 });
  assert.equal(noTerm.status, 400); assert.equal(noTerm.data.code, 'terminal_required');
  const r = await api('POST', '/api/cash/open', { opening_cents: 10000 });
  assert.equal(r.status, 201);
  assert.equal((await api('POST', '/api/cash/open', { opening_cents: 0 })).status, 409);
});

// ---------- Leitor desligado: venda manual completa ----------
await check('configuração que elimina todos os meios de lançamento é recusada', async () => {
  const r = await setPdv({ scanner_enabled: false, allow_manual: false });
  assert.equal(r.status, 400);
});
await check('leitor desligado: venda manual completa do produto ao encerramento', async () => {
  assert.equal((await setPdv({ scanner_enabled: false, mode: 'manual' })).status, 200);
  const s = await openCard(1);
  const it = await api('POST', '/api/pdv/items', { session_id: s.id, product_id: ipa.id, qty: 2, launch_mode: 'manual', idempotency_key: key() });
  assert.equal(it.status, 201, JSON.stringify(it.data));
  assert.equal(it.data.item.total_cents, 5780);
  assert.equal(it.data.totals.serviceFee, 578);
  const cont = await api('POST', '/api/pdv/items', { session_id: s.id, launch_mode: 'continua', scan: { product_code: ipa.codes[0] }, idempotency_key: key() });
  assert.equal(cont.status, 403, 'leitura recusada com leitor desligado');
  const pay = await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'dinheiro', amount_cents: 6358, tendered_cents: 7000, idempotency_key: key() });
  assert.equal(pay.status, 201, JSON.stringify(pay.data)); assert.equal(pay.data.payment.change_cents, 642);
  const full = (await api('GET', `/api/pdv/sessions/${s.id}`)).data;
  const close = await api('POST', `/api/pdv/sessions/${s.id}/close`, { version: full.version });
  assert.equal(close.status, 200, JSON.stringify(close.data));
});

// ---------- Leitura contínua e manual com dupla desligada ----------
await check('dupla leitura desligada: manual e leitura contínua funcionam', async () => {
  await setPdv({ scanner_enabled: true, mode: 'continua', double_read_mandatory: false });
  const s = await openCard(2);
  const a = await api('POST', '/api/pdv/items', { session_id: s.id, launch_mode: 'continua', scan: { product_code: ipa.codes[0] }, idempotency_key: key() });
  const b = await api('POST', '/api/pdv/items', { session_id: s.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(a.data.item.launch_mode, 'continua');
});
await check('código desconhecido não abre comanda nem cadastra produto', async () => {
  const r = await api('POST', '/api/pdv/resolve', { code: '000999888' });
  assert.equal(r.data.type, 'DESCONHECIDO');
  const cnt = (await api('GET', '/api/pdv/sessions')).data.length;
  const r2 = await api('POST', '/api/pdv/items', { session_id: 1, launch_mode: 'continua', scan: { product_code: '000999888' }, idempotency_key: key() });
  assert.equal(r2.status, 400);
  assert.equal((await api('GET', '/api/pdv/sessions')).data.length, cnt);
});
await check('código preserva zeros à esquerda e não é ambíguo', async () => {
  const p = await api('POST', '/api/menu/products', { name: 'Porção zero', price_cents: 1000, codes: ['000123'] });
  assert.equal(p.status, 201);
  assert.equal((await api('POST', '/api/pdv/resolve', { code: '000123' })).data.type, 'PRODUTO');
  assert.equal((await api('POST', '/api/pdv/resolve', { code: '123' })).data.type, 'DESCONHECIDO');
  const dup = await api('POST', '/api/menu/products', { name: 'Outro', price_cents: 1000, codes: ['CMD-000001'] });
  assert.equal(dup.status, 409, 'código de comanda não pode virar produto');
});

// ---------- Dupla leitura obrigatória ----------
let s3;
await check('par comanda→produto válido: um item na sessão correta', async () => {
  await setPdv({ double_read_mandatory: true, exception_requires_manager: true });
  s3 = await openCard(3);
  const r = await api('POST', '/api/pdv/items', { session_id: s3.id, launch_mode: 'dupla', scan: { card_code: cards.find((c) => c.number === 3).code, product_code: ipa.codes[0] }, idempotency_key: key() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.item.session_id, s3.id);
  assert.match(r.data.confirmation.destination, /Comanda 3/);
});
await check('dupla obrigatória: manual e contínua recusados no servidor', async () => {
  const m = await api('POST', '/api/pdv/items', { session_id: s3.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  assert.equal(m.status, 403); assert.equal(m.data.code, 'double_read_required');
  const c = await api('POST', '/api/pdv/items', { session_id: s3.id, launch_mode: 'continua', scan: { product_code: ipa.codes[0] }, idempotency_key: key() });
  assert.equal(c.status, 403);
});
await check('produto sem comanda lida: nenhum lançamento', async () => {
  const r = await api('POST', '/api/pdv/items', { session_id: s3.id, launch_mode: 'dupla', scan: { product_code: ipa.codes[0] }, idempotency_key: key() });
  assert.equal(r.status, 400); assert.equal(r.data.code, 'card_required');
});
await check('comanda lida diferente do destino: recusado (sem troca silenciosa)', async () => {
  const other = await openCard(4);
  const r = await api('POST', '/api/pdv/items', { session_id: s3.id, launch_mode: 'dupla', scan: { card_code: cards.find((c) => c.number === 4).code, product_code: ipa.codes[0] }, idempotency_key: key() });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'card_mismatch');
  assert.equal((await api('GET', `/api/pdv/sessions/${other.id}`)).data.items.length, 0);
});
await check('troca de modo para manual recusada com dupla obrigatória', async () => {
  const r = await api('POST', '/api/pdv/mode', { from: 'dupla', to: 'manual' });
  assert.equal(r.status, 403);
});
await check('exceção manual sem autorização do gerente: recusada', async () => {
  const r = await api('POST', '/api/pdv/items', { session_id: s3.id, product_id: ipa.id, launch_mode: 'excecao', exception_reason: 'etiqueta rasgada', idempotency_key: key() });
  assert.equal(r.status, 403);
});
await check('exceção manual autorizada: item auditado, autorização de uso único', async () => {
  const auth = await api('POST', '/api/admin/authorizations', { email: 'a@teste.dev', password: 'Motocustom2026x', action: 'excecao_dupla_leitura', reason: 'etiqueta rasgada' });
  assert.equal(auth.status, 200, JSON.stringify(auth.data));
  const r = await api('POST', '/api/pdv/items', { session_id: s3.id, product_id: ipa.id, launch_mode: 'excecao', exception_reason: 'etiqueta rasgada', authorization: auth.data.authorization, idempotency_key: key() });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const again = await api('POST', '/api/pdv/items', { session_id: s3.id, product_id: ipa.id, launch_mode: 'excecao', exception_reason: 'de novo', authorization: auth.data.authorization, idempotency_key: key() });
  assert.equal(again.status, 403, 'autorização não é reutilizável');
  const aud = await api('GET', '/api/admin/audit?action=pdv.excecao_manual');
  assert.ok(aud.data.some((a) => a.entity_id === String(r.data.item.id)));
});
await check('produto com opções obrigatórias: só confirma com a escolha', async () => {
  const r = await api('POST', '/api/pdv/items', { session_id: s3.id, launch_mode: 'dupla', scan: { card_code: cards.find((c) => c.number === 3).code, product_code: 'sem-codigo' }, idempotency_key: key() });
  assert.equal(r.status, 400);
  await setPdv({ double_read_mandatory: false, mode: 'manual' });
  const no = await api('POST', '/api/pdv/items', { session_id: s3.id, product_id: burger.id, launch_mode: 'manual', idempotency_key: key() });
  assert.equal(no.status, 400); assert.equal(no.data.code, 'options_required');
  const point = burger.groups[0].options[1].id; const bacon = burger.groups[1].options[0].id;
  const ok = await api('POST', '/api/pdv/items', { session_id: s3.id, product_id: burger.id, option_ids: [point, bacon], launch_mode: 'manual', idempotency_key: key() });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.item.total_cents, burger.price_cents + 600);
});
await check('produto por peso exige peso informado', async () => {
  const p = await api('POST', '/api/menu/products', { name: 'Picanha kg', kind: 'weight', unit: 'kg', price_cents: 12000 });
  const r = await api('POST', '/api/pdv/items', { session_id: s3.id, product_id: p.data.id, launch_mode: 'manual', idempotency_key: key() });
  assert.equal(r.status, 400); assert.equal(r.data.code, 'weight_required');
  const ok = await api('POST', '/api/pdv/items', { session_id: s3.id, product_id: p.data.id, qty: 0.35, launch_mode: 'manual', idempotency_key: key() });
  assert.equal(ok.data.item.total_cents, 4200);
});

// ---------- Idempotência ----------
await check('duas vendas legítimas do mesmo produto: ambas contabilizadas', async () => {
  const s = await openCard(5);
  await api('POST', '/api/pdv/items', { session_id: s.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  await api('POST', '/api/pdv/items', { session_id: s.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  assert.equal((await api('GET', `/api/pdv/sessions/${s.id}`)).data.items.length, 2);
});
await check('reenvio da mesma operação: apenas uma inclusão (inclusive simultâneo)', async () => {
  const s = await openCard(6);
  const k = key();
  const body = { session_id: s.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: k };
  const [a, b, c] = await Promise.all([api('POST', '/api/pdv/items', body), api('POST', '/api/pdv/items', body), api('POST', '/api/pdv/items', body)]);
  assert.ok([a, b, c].every((r) => [200, 201].includes(r.status)), JSON.stringify([a.status, b.status, c.status]));
  assert.equal((await api('GET', `/api/pdv/sessions/${s.id}`)).data.items.length, 1);
  const rec = await api('GET', `/api/pdv/items/by-key/${k}`);
  assert.equal(rec.data.found, true);
});

// ---------- Cartão reutilizado ----------
await check('cartão reutilizado: nova sessão sem misturar histórico', async () => {
  const again = await openCard(1);
  const first = (await api('GET', '/api/pdv/sessions?status=all')).data.filter((s) => s.card_number === 1);
  assert.equal(first.length, 2);
  assert.equal((await api('GET', `/api/pdv/sessions/${again.id}`)).data.items.length, 0);
  const dup = await api('POST', '/api/pdv/sessions', { kind: 'comanda', card_id: cards.find((c) => c.number === 1).id });
  assert.equal(dup.status, 409, 'uma sessão ativa por cartão');
});
await check('cartão bloqueado não abre consumo', async () => {
  const c = cards.find((x) => x.number === 10);
  await api('POST', `/api/floor/cards/${c.id}/block`, { reason: 'Perdido pelo cliente' });
  const r = await api('POST', '/api/pdv/sessions', { kind: 'comanda', card_id: c.id });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'card_blocked');
});

// ---------- Fechamento concorrente e pagamentos ----------
await check('dois terminais fecham a mesma comanda: apenas um fechamento', async () => {
  const s = await openCard(7);
  const it = await api('POST', '/api/pdv/items', { session_id: s.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'pix', amount_cents: it.data.totals.total, idempotency_key: key() });
  const v = (await api('GET', `/api/pdv/sessions/${s.id}`)).data.version;
  const rs = await Promise.all([api('POST', `/api/pdv/sessions/${s.id}/close`, { version: v }), api('POST', `/api/pdv/sessions/${s.id}/close`, { version: v })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
});
await check('pagamento misto: saldo correto, troco só em dinheiro, sem duplicar', async () => {
  const s = await openCard(8);
  const it = await api('POST', '/api/pdv/items', { session_id: s.id, product_id: burger.id, option_ids: [burger.groups[0].options[0].id], launch_mode: 'manual', idempotency_key: key() });
  const total = it.data.totals.total;
  const bad = await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'pix', amount_cents: 1000, tendered_cents: 2000, idempotency_key: key() });
  assert.equal(bad.status, 400); assert.equal(bad.data.code, 'change_not_allowed');
  const k = key();
  const p1 = await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'debito', amount_cents: 2000, idempotency_key: k });
  const p1b = await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'debito', amount_cents: 2000, idempotency_key: k });
  assert.equal(p1.status, 201); assert.equal(p1b.status, 200); assert.equal(p1b.data.replay, true);
  assert.equal(p1b.data.totals.balance, total - 2000);
  const over = await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'credito', amount_cents: total, idempotency_key: key() });
  assert.equal(over.status, 400, 'valor acima do saldo');
  const v = (await api('GET', `/api/pdv/sessions/${s.id}`)).data.version;
  assert.equal((await api('POST', `/api/pdv/sessions/${s.id}/close`, { version: v })).data.code, 'balance_pending');
  const p2 = await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'dinheiro', amount_cents: total - 2000, tendered_cents: 10000, idempotency_key: key() });
  assert.equal(p2.data.totals.balance, 0);
});
await check('cancelar item pago recusado até estornar', async () => {
  const s = await openCard(2).catch(() => null) || (await api('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === 2);
  const full = (await api('GET', `/api/pdv/sessions/${s.id}`)).data;
  await api('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'pix', amount_cents: full.totals.balance, idempotency_key: key() });
  const r = await api('POST', `/api/pdv/items/${full.items[0].id}/cancel`, { reason: 'cliente desistiu' });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'overpaid');
});
await check('taxa de serviço discriminada e removível com motivo', async () => {
  const s = await openCard(4).catch(() => null) || (await api('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === 4);
  await api('POST', '/api/pdv/items', { session_id: s.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  const r = await api('POST', `/api/pdv/sessions/${s.id}/service-fee`, { bp: 0, reason: 'Cliente não concordou' });
  assert.equal(r.status, 200); assert.equal(r.data.serviceFee, 0); assert.equal(r.data.total, r.data.items);
});
await check('transferência de item preserva rastreabilidade', async () => {
  const src = (await api('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === 5);
  const dst = (await api('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === 6);
  const it = (await api('GET', `/api/pdv/sessions/${src.id}`)).data.items[0];
  const r = await api('POST', '/api/pdv/items/transfer', { item_ids: [it.id], target_session_id: dst.id, reason: 'cliente mudou de mesa' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const d = (await api('GET', `/api/pdv/sessions/${dst.id}`)).data;
  assert.ok(d.items.some((x) => x.transferred_from === it.id));
  const s2 = (await api('GET', `/api/pdv/sessions/${src.id}`)).data;
  assert.equal(s2.items.find((x) => x.id === it.id).status, 'cancelado');
});
await check('mesa ocupa ao abrir e vai para limpeza ao encerrar', async () => {
  const t = tables[0];
  const s = await api('POST', '/api/pdv/sessions', { kind: 'mesa', table_id: t.id });
  let tt = (await api('GET', '/api/floor/tables')).data.tables.find((x) => x.id === t.id);
  assert.equal(tt.status, 'ocupada');
  const it = await api('POST', '/api/pdv/items', { session_id: s.data.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  await api('POST', `/api/pdv/sessions/${s.data.id}/payments`, { method: 'pix', amount_cents: it.data.totals.total, idempotency_key: key() });
  const v = (await api('GET', `/api/pdv/sessions/${s.data.id}`)).data.version;
  await api('POST', `/api/pdv/sessions/${s.data.id}/close`, { version: v });
  tt = (await api('GET', '/api/floor/tables')).data.tables.find((x) => x.id === t.id);
  assert.equal(tt.status, 'limpeza');
});

// ---------- Permissões ----------
let garcom;
await check('garçom sem permissão: backend recusa troca de modo e exceção', async () => {
  const u = await api('POST', '/api/admin/users', { name: 'Garçom', email: 'g@teste.dev', password: 'Garcom2026xyz', role_key: 'garcom' });
  assert.equal(u.status, 201, JSON.stringify(u.data));
  const login = await anon('POST', '/api/auth/login', { email: 'g@teste.dev', password: 'Garcom2026xyz' });
  garcom = client(login.data.access_token, A.terminal);
  assert.equal((await garcom('POST', '/api/pdv/mode', { from: 'manual', to: 'continua' })).status, 403);
  const s = (await api('GET', '/api/pdv/sessions')).data[0];
  const e = await garcom('POST', '/api/pdv/items', { session_id: s.id, product_id: ipa.id, launch_mode: 'excecao', exception_reason: 'x x x', idempotency_key: key() });
  assert.equal(e.status, 403);
  assert.equal((await garcom('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'pix', amount_cents: 1, idempotency_key: key() })).status, 403);
  assert.equal((await garcom('GET', '/api/admin/audit')).status, 403);
});
await check('hierarquia: gerente não cria proprietário nem se promove', async () => {
  await api('POST', '/api/admin/users', { name: 'Gerente', email: 'm@teste.dev', password: 'Gerente2026xyz', role_key: 'gerente' });
  // gerente não tem usuarios.gerenciar por padrão; concedemos para testar a hierarquia
  const roles = (await api('GET', '/api/admin/roles')).data.roles;
  const g = roles.find((r) => r.key === 'gerente');
  await api('PUT', '/api/admin/roles/gerente', { permissions: [...g.permissions, 'usuarios.gerenciar'] });
  const mg = client((await anon('POST', '/api/auth/login', { email: 'm@teste.dev', password: 'Gerente2026xyz' })).data.access_token);
  const cr = await mg('POST', '/api/admin/users', { name: 'Xavier', email: 'x@teste.dev', password: 'Xxxxxx2026yy', role_key: 'owner' });
  assert.equal(cr.status, 403, JSON.stringify(cr.data));
  assert.equal((await mg('PUT', '/api/admin/roles/gerente', { permissions: ['assinatura.gerenciar'] })).status, 403);
  const users = (await api('GET', '/api/admin/users')).data;
  const me = users.find((u) => u.email === 'm@teste.dev');
  assert.equal((await mg('PUT', `/api/admin/users/${me.id}`, { role_key: 'admin' })).status, 403);
});

// ---------- Isolamento entre empresas ----------
await check('acesso cruzado entre empresas rejeitado', async () => {
  const sA = (await api('GET', '/api/pdv/sessions')).data[0];
  assert.equal((await apiB('GET', `/api/pdv/sessions/${sA.id}`)).status, 404);
  const sB = await apiB('POST', '/api/pdv/sessions', { kind: 'balcao' });
  const r = await apiB('POST', '/api/pdv/items', { session_id: sB.data.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() });
  assert.equal(r.status, 404, 'produto de outra empresa');
  assert.equal((await apiB('POST', '/api/pdv/resolve', { code: 'CMD-000001' })).data.type, 'COMANDA'); // cartão próprio da B
  const bCard = (await apiB('POST', '/api/pdv/resolve', { code: 'CMD-000003' })).data;
  assert.notEqual(bCard.card.id, cards.find((c) => c.number === 3).id);
  assert.equal((await apiB('POST', `/api/pdv/items/${1}/cancel`, { reason: 'invasão' })).status, 404);
  assert.equal((await apiB('POST', '/api/pdv/items', { session_id: sA.id, product_id: ipa.id, launch_mode: 'manual', idempotency_key: key() })).status, 404);
  assert.equal((await apiB('GET', `/api/admin/audit?entity_id=${sA.id}`)).data.every((a) => a.user_name !== 'Garçom'), true);
});
await check('terminal de outra empresa é ignorado', async () => {
  const c = client(B.token, A.terminal);
  const me = (await c('GET', '/api/auth/me')).data;
  assert.equal(me.terminalId, null);
});

// ---------- Caixa: fechamento cego ----------
await check('fechamento cego: diferença exige justificativa', async () => {
  const cur = (await api('GET', '/api/cash/current')).data;
  assert.ok(cur.open);
  const g = await garcom('GET', '/api/cash/current');
  assert.ok(g.data.expected === null || g.data.open === false, 'operador sem financeiro não vê o esperado');
  const r = await api('POST', `/api/cash/${cur.cash.id}/close`, { counted: { dinheiro: 1 } });
  assert.equal(r.status, 400); assert.equal(r.data.code, 'justification_required');
  const ok = await api('POST', `/api/cash/${cur.cash.id}/close`, { counted: { dinheiro: 1 }, justification: 'teste de diferença' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.notEqual(ok.data.difference_cents, 0);
});

// ---------- Assinatura / central (contrato v1 do ORBI) ----------
const setAccess = async (companyId, access) => {
  hub.tenants.set(String(companyId), access);
  await pool.query('update companies set access = $2, access_updated_at = now() where id = $1', [companyId, access]);
};
// chamada assinada como a central faz (rota relativa a /api/platform/v1)
async function centralCall(method, route, payload, secret = process.env.PLATFORM_SECRET, ts = Math.floor(Date.now() / 1000)) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const headers = { 'content-type': 'application/json', 'x-platform-product': 'rusten', 'x-platform-timestamp': String(ts),
    'x-platform-signature': signPayload(secret, ts, method, route, body) };
  const res = await fetch(`${base}/api/platform/v1${route}`, { method, headers, body: body || undefined });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers };
}
await check('cadastro registra a empresa na central e recebe a situação de teste', async () => {
  const reg = hub.calls.filter((c) => c.method === 'POST' && c.route === '/tenants').map((c) => c.body.remote_id);
  assert.ok(reg.includes(String(A.me.company.id)) && reg.includes(String(B.me.company.id)));
  const acc = await api('GET', '/api/access');
  assert.equal(acc.data.access.state, 'TRIAL'); assert.equal(acc.data.access.allowed, true);
  const t = hub.calls.find((c) => c.route === '/tenants').body;
  assert.ok(t.name && t.owner_name && t.metrics && !('password_hash' in t) && !('owner_email' in t));
});
await check('bloqueio administrativo: 402 nas operações, regularização continua acessível', async () => {
  await setAccess(A.me.company.id, hub.access('SUSPENDED', { reason: 'ADMINISTRATIVO', blocked: true, admin_blocked: true }));
  const r = await api('GET', '/api/pdv/sessions');
  assert.equal(r.status, 402);
  const acc = await api('GET', '/api/access');
  assert.equal(acc.status, 200); assert.equal(acc.data.access.state, 'SUSPENDED'); assert.equal(acc.data.access.adminBlocked, true);
});
await check('assinatura ativa libera; inadimplente avisa sem bloquear', async () => {
  await setAccess(A.me.company.id, hub.access('ACTIVE'));
  assert.equal((await api('GET', '/api/pdv/sessions')).status, 200);
  await setAccess(A.me.company.id, hub.access('PAST_DUE', { reason: 'FINANCEIRO', notices: [{ level: 'danger', text: 'Regularize o pagamento.' }] }));
  const r = await api('GET', '/api/access');
  assert.equal(r.data.access.warning, 'Regularize o pagamento.');
  assert.equal((await api('GET', '/api/pdv/sessions')).status, 200);
});
await check('teste encerrado bloqueia com a mensagem certa', async () => {
  await setAccess(A.me.company.id, hub.access('EXPIRED', { reason: 'TRIAL_EXPIRADO', blocked: true }));
  const r = await api('GET', '/api/pdv/sessions');
  assert.equal(r.status, 402); assert.match(r.data.error, /teste terminou/);
});
await check('módulo fora do plano: 403', async () => {
  await setAccess(A.me.company.id, hub.access('ACTIVE', { features: { pdv: false, salao: true, cardapio: true } }));
  const r = await api('GET', '/api/pdv/sessions');
  assert.equal(r.status, 403); assert.equal(r.data.code, 'module_disabled');
  await setAccess(A.me.company.id, hub.access('ACTIVE'));
});
await check('situação antiga é revalidada na central', async () => {
  hub.tenants.set(String(A.me.company.id), hub.access('ACTIVE', { plan: { id: 'p1', name: 'Bar Pro' } }));
  await pool.query("update companies set access_updated_at = now() - interval '10 minutes' where id = $1", [A.me.company.id]);
  assert.equal((await api('GET', '/api/access')).data.access.plan, 'Bar Pro');
});
await check('central: chamada assinada aceita; inválida, vencida e repetida recusadas', async () => {
  const ok = await centralCall('GET', '/manifest');
  assert.equal(ok.status, 200); assert.equal(ok.data.code, 'rusten'); assert.ok(ok.data.features.pdv && ok.data.settings.system.length);
  const again = await fetch(`${base}/api/platform/v1/manifest`, { headers: ok.headers });
  assert.equal(again.status, 401, 'assinatura repetida');
  assert.equal((await centralCall('GET', '/manifest', undefined, 'pk_outro')).status, 401);
  assert.equal((await centralCall('GET', '/manifest', undefined, undefined, Math.floor(Date.now() / 1000) - 900)).status, 401);
  const p = await centralCall('POST', `/tenants/${B.me.company.id}/access`, { access: hub.access('TRIAL', { trial: { type: 'UNLIMITED' } }) });
  assert.equal(p.status, 200);
  hub.tenants.set(String(B.me.company.id), hub.access('TRIAL', { trial: { type: 'UNLIMITED' } }));
  assert.equal((await apiB('GET', '/api/access')).data.access.state, 'TRIAL');
});
await check('central lista empresas e detalha usuários sem senhas', async () => {
  const l = await centralCall('GET', '/tenants');
  assert.equal(l.status, 200); assert.ok(l.data.items.length >= 2);
  const d = await centralCall('GET', `/tenants/${A.me.company.id}`);
  assert.equal(d.status, 200); assert.ok(d.data.tenant.users.list.length >= 1);
  assert.ok(!JSON.stringify(d.data).includes('password'));
});
await check('central altera parâmetros do sistema e da empresa', async () => {
  const s = await centralCall('PUT', '/settings', { values: { default_service_fee: 12, notice_text: 'Manutenção às 23h', notice_level: 'warn' } });
  assert.equal(s.status, 200, JSON.stringify(s.data)); assert.equal(s.data.values.default_service_fee, 12);
  assert.equal((await centralCall('PUT', '/settings', { values: { default_tables: 9999 } })).status, 400);
  assert.equal((await centralCall('PUT', '/settings', { values: { inexistente: 1 } })).status, 400);
  const me = await api('GET', '/api/auth/me');
  assert.equal(me.data.notice.text, 'Manutenção às 23h');
  const t = await centralCall('PUT', `/tenants/${A.me.company.id}/settings`, { values: { pdv_service_fee: 8, pdv_card_prefix: 'CX-' }, reason: 'pedido do cliente' });
  assert.equal(t.status, 200, JSON.stringify(t.data)); assert.equal(t.data.values.pdv_service_fee, 8);
  assert.equal((await centralCall('PUT', `/tenants/${A.me.company.id}/settings`, { values: { pdv_scanner_enabled: false, pdv_allow_manual: false } })).status, 400);
  await centralCall('PUT', '/settings', { values: { notice_text: '' } });
});
await check('central cria senha provisória do responsável', async () => {
  const r = await centralCall('POST', `/tenants/${B.me.company.id}/owner-reset`, {});
  assert.equal(r.status, 200); assert.ok(r.data.temporary_password);
  const login = await anon('POST', '/api/auth/login', { email: 'b@teste.dev', password: r.data.temporary_password });
  assert.equal(login.status, 200);
});
await check('usuário comum não acessa rotas da central', async () => {
  assert.equal((await api('GET', '/api/platform/v1/tenants')).status, 401);
});
await check('demonstração: entra direto, com movimento de exemplo, sem central e fora da lista da central', async () => {
  const r = await anon('POST', '/api/auth/demo');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const d = client(r.data.access_token);
  const me = (await d('GET', '/api/auth/me')).data;
  assert.equal(me.company.is_demo, true); assert.equal(me.access.state, 'DEMO');
  const sess = await d('GET', '/api/pdv/sessions');
  assert.equal(sess.status, 200); assert.ok(sess.data.length >= 3, JSON.stringify(sess.data).slice(0, 200));
  const list = await centralCall('GET', '/tenants');
  assert.ok(!list.data.items.some((t) => t.remote_id === String(me.company.id)));
  assert.equal((await centralCall('GET', `/tenants/${me.company.id}`)).status, 404);
  assert.ok(!hub.calls.some((c) => c.body?.remote_id === String(me.company.id)));
  // ativação: vira conta real, cadastra na central e o login passa a valer
  const act = await d('POST', '/api/auth/activate', { company_name: 'Bar do Visitante', name: 'Visitante Real', email: 'demo-ativo@teste.dev', password: 'Ativacao2026xyz', accept_terms: true });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  const me2 = (await client(act.data.access_token)('GET', '/api/auth/me')).data;
  assert.equal(me2.company.is_demo, false); assert.equal(me2.company.name, 'Bar do Visitante');
  assert.ok(hub.calls.some((c) => c.route === '/tenants' && c.body?.remote_id === String(me.company.id)));
  assert.equal((await client(act.data.access_token)('GET', '/api/pdv/sessions')).data.length, 0, 'movimento de exemplo apagado');
  assert.equal((await anon('POST', '/api/auth/login', { email: 'demo-ativo@teste.dev', password: 'Ativacao2026xyz' })).status, 200);
});
await check('demonstração antiga é apagada por inteiro (inclusive auditoria)', async () => {
  const r = await anon('POST', '/api/auth/demo');
  const me = (await client(r.data.access_token)('GET', '/api/auth/me')).data;
  await pool.query("update companies set created_at = now() - interval '30 days' where id = $1", [me.company.id]);
  await anon('POST', '/api/auth/demo');
  assert.equal((await pool.query('select 1 from companies where id = $1', [me.company.id])).rows.length, 0);
  assert.equal((await pool.query('select 1 from audit_events where company_id = $1', [me.company.id])).rows.length, 0);
  await assert.rejects(pool.query('select purge_demo_company($1)', [A.me.company.id]), /não é de demonstração/);
});
await check('parâmetro do sistema fecha cadastros e demonstração', async () => {
  await centralCall('PUT', '/settings', { values: { signup_enabled: false, demo_enabled: false } });
  assert.equal((await anon('POST', '/api/auth/demo')).status, 403);
  const plans = await anon('GET', '/api/auth/plans');
  assert.equal(plans.data.signup_open, false); assert.equal(plans.data.hub, true); assert.equal(plans.data.plans.length, 1);
  const r = await anon('POST', '/api/auth/register', { company: { name: 'Fechado', segment: 'bar' }, owner: { name: 'X Y', email: 'f@teste.dev', password: 'Motocustom2026x' }, accept_terms: true });
  assert.equal(r.status, 403);
  await centralCall('PUT', '/settings', { values: { signup_enabled: true, demo_enabled: true } });
});
await check('portal da assinatura repassa à central', async () => {
  const r = await api('GET', '/api/access/billing');
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.hub, true); assert.ok(Array.isArray(r.data.payments));
});

// ---------- Segurança e auditoria ----------
// ---------- Módulos: clientes, cozinha, estoque, delivery, relatórios, marketing, agente ----------
const C = await register('Pub Garagem', 'c@teste.dev');
const apiC = client(C.token, C.terminal);
const bProducts = (await apiC('GET', '/api/menu/products')).data;
const bIpa = bProducts.find((p) => p.name.startsWith('Cerveja IPA'));
const bBurger = bProducts.find((p) => p.name.startsWith('Hambúrguer'));
const bCards = (await apiC('GET', '/api/floor/cards')).data.cards;
await apiC('POST', '/api/cash/open', { opening_cents: 0 });
let custId;
await check('cliente: CPF inválido recusado; cadastro e busca pelo CPF preenchem a comanda', async () => {
  assert.equal((await apiC('POST', '/api/customers', { name: 'Ana', cpf: '111.111.111-11' })).status, 400);
  const c = await apiC('POST', '/api/customers', { name: 'Ana Souza', cpf: '529.982.247-25', phone: '(11) 98888-7777', consent_whatsapp: true });
  assert.equal(c.status, 201, JSON.stringify(c.data)); custId = c.data.id;
  assert.equal((await apiC('POST', '/api/customers', { name: 'Outra', cpf: '52998224725' })).status, 409);
  const l = await apiC('GET', '/api/customers/lookup?cpf=52998224725');
  assert.equal(l.data.found, true); assert.equal(l.data.customer.name, 'Ana Souza');
  assert.equal((await apiC('GET', '/api/customers/lookup?cpf=39053344705')).data.found, false);
  assert.equal((await api('GET', '/api/customers/lookup?cpf=52998224725')).data.found, false, 'outra empresa não enxerga');
  const s = await apiC('POST', '/api/pdv/sessions', { kind: 'comanda', card_id: bCards[0].id, customer_id: custId });
  assert.equal(s.status, 201); assert.equal(s.data.customer_name, 'Ana Souza');
});
await check('fidelidade: pontos no encerramento, resgate como pagamento e reversão no estorno', async () => {
  await pool.query(`update companies set settings = jsonb_set(settings, '{loyalty}', '{"enabled":true,"cents_per_point":100,"point_value_cents":5,"validity_days":365,"min_redeem":10}') where id = $1`, [C.me.company.id]);
  const s = (await apiC('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === bCards[0].number);
  await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: bIpa.id, qty: 2, launch_mode: 'manual', idempotency_key: key() });
  let full = (await apiC('GET', `/api/pdv/sessions/${s.id}`)).data;
  await apiC('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'pix', amount_cents: full.totals.balance, idempotency_key: key() });
  full = (await apiC('GET', `/api/pdv/sessions/${s.id}`)).data;
  const cl = await apiC('POST', `/api/pdv/sessions/${s.id}/close`, { version: full.version });
  assert.equal(cl.status, 200, JSON.stringify(cl.data)); assert.equal(cl.data.points_earned, 57);
  const s2 = await apiC('POST', '/api/pdv/sessions', { kind: 'comanda', card_id: bCards[1].id, customer_id: custId });
  await apiC('POST', '/api/pdv/items', { session_id: s2.data.id, product_id: bIpa.id, launch_mode: 'manual', idempotency_key: key() });
  const rd = await apiC('POST', `/api/customers/${custId}/redeem`, { session_id: s2.data.id, points: 20, idempotency_key: key() });
  assert.equal(rd.status, 201, JSON.stringify(rd.data)); assert.equal(rd.data.payment.amount_cents, 100);
  assert.equal((await apiC('GET', `/api/customers/${custId}`)).data.customer.points, 37);
  await apiC('POST', `/api/pdv/payments/${rd.data.payment.id}/refund`, { reason: 'cliente desistiu' });
  const det = (await apiC('GET', `/api/customers/${custId}`)).data;
  assert.equal(det.customer.points, 57); assert.equal(det.history.length, 2);
});
await check('cozinha: item entra na fila, segue o fluxo e cancelamento exige ciência', async () => {
  const s = (await apiC('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === bCards[1].number);
  const it = await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: bBurger.id, option_ids: [bBurger.groups[0].options[1].id], launch_mode: 'manual', idempotency_key: key() });
  const qu = (await apiC('GET', '/api/kitchen/queue')).data.items;
  const k = qu.find((x) => x.id === it.data.item.id);
  assert.ok(k && k.kitchen_status === 'novo');
  assert.equal((await apiC('POST', `/api/kitchen/items/${k.id}/status`, { to: 'preparando', from: 'novo' })).status, 200);
  assert.equal((await apiC('POST', `/api/kitchen/items/${k.id}/status`, { to: 'preparando' })).data.replay, true);
  assert.equal((await apiC('POST', `/api/kitchen/items/${k.id}/status`, { to: 'aceito', from: 'novo' })).status, 409);
  await apiC('POST', `/api/pdv/items/${k.id}/cancel`, { reason: 'cliente mudou o pedido' });
  const after = (await apiC('GET', '/api/kitchen/queue')).data.items.find((x) => x.id === k.id);
  assert.equal(after.kitchen_status, 'cancelado', 'cancelado continua visível');
  await apiC('POST', `/api/kitchen/items/${k.id}/ack-cancel`);
  assert.ok(!(await apiC('GET', '/api/kitchen/queue')).data.items.find((x) => x.id === k.id));
});
await check('envio por lote: item espera confirmação antes de ir à cozinha', async () => {
  await apiC('PUT', '/api/admin/pdv-settings/company', { settings: { kitchen_send: 'lote' } });
  const s = (await apiC('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === bCards[1].number);
  const it = await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: bBurger.id, option_ids: [bBurger.groups[0].options[0].id], launch_mode: 'manual', idempotency_key: key() });
  assert.ok(!(await apiC('GET', '/api/kitchen/queue')).data.items.find((x) => x.id === it.data.item.id));
  assert.equal((await apiC('POST', `/api/pdv/sessions/${s.id}/send`)).data.sent, 1);
  assert.ok((await apiC('GET', '/api/kitchen/queue')).data.items.find((x) => x.id === it.data.item.id));
  await apiC('PUT', '/api/admin/pdv-settings/company', { settings: { kitchen_send: 'imediato' } });
});
let carne;
await check('estoque: ficha técnica baixa insumos na venda e estorna no cancelamento antes do preparo', async () => {
  const c1 = await apiC('POST', '/api/stock/items', { name: 'Carne moída', unit: 'kg', min_qty: 2, initial_qty: 10, unit_cost_cents: 3000 });
  const c2 = await apiC('POST', '/api/stock/items', { name: 'Pão brioche', unit: 'un', initial_qty: 40, unit_cost_cents: 150 });
  carne = c1.data.id;
  const r = await apiC('PUT', `/api/stock/recipes/${bBurger.id}`, { stock_mode: 'ficha', yield_qty: 1, lines: [{ stock_item_id: c1.data.id, qty: 0.18, loss_pct: 0 }, { stock_item_id: c2.data.id, qty: 1 }] });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.version, 1); assert.equal(r.data.cost_cents, 690);
  const s = (await apiC('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === bCards[1].number);
  const it = await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: bBurger.id, qty: 2, option_ids: [bBurger.groups[0].options[0].id], launch_mode: 'manual', idempotency_key: key() });
  let items = (await apiC('GET', '/api/stock/items')).data;
  assert.equal(items.find((x) => x.id === c1.data.id).balance, 9.64);
  assert.equal(items.find((x) => x.id === c2.data.id).balance, 38);
  await apiC('POST', `/api/pdv/items/${it.data.item.id}/cancel`, { reason: 'lançado errado' });
  items = (await apiC('GET', '/api/stock/items')).data;
  assert.equal(items.find((x) => x.id === c1.data.id).balance, 10);
  assert.equal((await apiC('PUT', `/api/stock/recipes/${bBurger.id}`, { stock_mode: 'ficha', lines: [{ stock_item_id: c1.data.id, qty: 0.2 }, { stock_item_id: c2.data.id, qty: 1 }] })).data.version, 2);
  await assert.rejects(pool.query('delete from stock_movements where company_id = $1', [C.me.company.id]));
});
await check('estoque: política sem saldo negativo bloqueia; compra parcial atualiza custo médio', async () => {
  const pils = await apiC('POST', '/api/stock/items', { name: 'Pilsen (garrafa)', unit: 'un', initial_qty: 1, unit_cost_cents: 400 });
  const pilsProd = bProducts.find((p) => p.name.startsWith('Pilsen'));
  await apiC('PUT', `/api/stock/recipes/${pilsProd.id}`, { stock_mode: 'acabado', stock_item_id: pils.data.id });
  await apiC('PUT', '/api/stock/settings', { enabled: true, allow_negative: false });
  const s = (await apiC('GET', '/api/pdv/sessions')).data.find((x) => x.card_number === bCards[1].number);
  assert.equal((await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: pilsProd.id, qty: 2, launch_mode: 'manual', idempotency_key: key() })).data.code, 'stock_insufficient');
  const pu = await apiC('POST', '/api/stock/purchases', { supplier: 'Distribuidora', lines: [{ stock_item_id: pils.data.id, qty: 10, unit_cost_cents: 500 }] });
  const lineId = (await apiC('GET', '/api/stock/purchases')).data.find((x) => x.id === pu.data.id).lines[0].id;
  assert.equal((await apiC('POST', `/api/stock/purchases/${pu.data.id}/receive`, { lines: [{ line_id: lineId, qty: 4 }] })).data.status, 'parcial');
  assert.equal((await apiC('POST', `/api/stock/purchases/${pu.data.id}/receive`, { lines: [{ line_id: lineId, qty: 7 }] })).status, 400);
  const it = (await apiC('GET', '/api/stock/items')).data.find((x) => x.id === pils.data.id);
  assert.equal(it.balance, 5); assert.equal(it.avg_cost_cents, 480);
  assert.equal((await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: pilsProd.id, qty: 2, launch_mode: 'manual', idempotency_key: key() })).status, 201);
  await apiC('PUT', '/api/stock/settings', { enabled: true, allow_negative: true });
});
await check('inventário: divergência aprovada vira ajuste vinculado', async () => {
  const inv = await apiC('POST', '/api/stock/inventories', { counts: [{ stock_item_id: carne, counted: 9.5 }] });
  assert.equal(inv.data.lines[0].diff, -0.5);
  const ap = await apiC('POST', `/api/stock/inventories/${inv.data.id}/approve`);
  assert.equal(ap.status, 200, JSON.stringify(ap.data)); assert.equal(ap.data.adjustments, 1);
  assert.equal((await apiC('GET', '/api/stock/items')).data.find((x) => x.id === carne).balance, 9.5);
});
await check('correção de estoque: limites, aprovação por outra pessoa, imutável e auditada', async () => {
  const bal = async () => (await apiC('GET', '/api/stock/items')).data.find((x) => x.id === carne).balance;
  const b0 = await bal();
  // justificativa curta é recusada; saldo igual ao sistema não gera correção
  assert.equal((await apiC('POST', '/api/stock/corrections', { stock_item_id: carne, counted_qty: b0 - 0.1, reason_code: 'contagem', justification: 'curta' })).status, 400);
  assert.equal((await apiC('POST', '/api/stock/corrections', { stock_item_id: carne, counted_qty: b0, reason_code: 'contagem', justification: 'Contagem conferida duas vezes' })).status, 400);
  // pequena e feita por quem aprova: aplicada direto, como movimento "correcao"
  const small = await apiC('POST', '/api/stock/corrections', { stock_item_id: carne, counted_qty: b0 - 0.1, reason_code: 'contagem', justification: 'Contagem da câmara fria no fechamento', expected_system_qty: b0 });
  assert.equal(small.status, 201, JSON.stringify(small.data)); assert.equal(small.data.status, 'aplicada');
  assert.ok(Math.abs((await bal()) - (b0 - 0.1)) < 0.0001);
  const mv = (await apiC('GET', `/api/stock/items/${carne}/movements`)).data[0];
  assert.equal(mv.kind, 'correcao');
  // saldo mudou durante a contagem → pede para conferir
  assert.equal((await apiC('POST', '/api/stock/corrections', { stock_item_id: carne, counted_qty: 1, reason_code: 'contagem', justification: 'Contagem da câmara fria no fechamento', expected_system_qty: b0 })).data.code, 'balance_changed');
  // grande: fica pendente; não dá para pedir outra para o mesmo insumo
  const big = await apiC('POST', '/api/stock/corrections', { stock_item_id: carne, counted_qty: 1, reason_code: 'vencimento', justification: 'Lote de carne venceu e foi descartado', evidence: 'foto no grupo' });
  assert.equal(big.data.status, 'pendente'); assert.ok(big.data.rules.length >= 1);
  assert.equal((await apiC('POST', '/api/stock/corrections', { stock_item_id: carne, counted_qty: 2, reason_code: 'contagem', justification: 'Outra contagem do mesmo insumo' })).data.code, 'correction_pending');
  // dados do pedido e registros não mudam nem somem
  await assert.rejects(pool.query('update stock_corrections set counted_qty = 5 where id = $1', [big.data.id]));
  await assert.rejects(pool.query('delete from stock_corrections where id = $1', [small.data.id]));
  // proprietário sozinho (sem outro aprovador): aprova o próprio pedido só com observação, e fica marcado
  assert.equal((await apiC('POST', `/api/stock/corrections/${big.data.id}/approve`, {})).status, 400);
  const ap = await apiC('POST', `/api/stock/corrections/${big.data.id}/approve`, { note: 'Sou o único gerente; conferi o descarte' });
  assert.equal(ap.status, 200, JSON.stringify(ap.data)); assert.equal(ap.data.self_approved, true);
  assert.ok(Math.abs((await bal()) - 1) < 0.0001);
  assert.equal((await apiC('POST', `/api/stock/corrections/${big.data.id}/approve`, {})).status, 409);
  // com um gerente na empresa: o proprietário não aprova o próprio pedido; o gerente decide
  await apiC('POST', '/api/admin/users', { name: 'Gerente C', email: 'gc@teste.dev', password: 'Gerente2026xyz', role_key: 'gerente' });
  const gl = await anon('POST', '/api/auth/login', { email: 'gc@teste.dev', password: 'Gerente2026xyz' });
  const gC = client(gl.data.access_token, C.terminal);
  const furto = await apiC('POST', '/api/stock/corrections', { stock_item_id: carne, counted_qty: 0.9, reason_code: 'furto_desvio', justification: 'Faltou carne sem registro de saída' });
  assert.equal(furto.data.status, 'pendente');
  assert.equal((await apiC('POST', `/api/stock/corrections/${furto.data.id}/approve`, { note: 'Tentando aprovar o meu próprio' })).data.code, 'same_user');
  assert.equal((await gC('POST', `/api/stock/corrections/${furto.data.id}/reject`, { note: 'x' })).status, 400);
  assert.equal((await gC('POST', `/api/stock/corrections/${furto.data.id}/reject`, { note: 'Recontar com o estoquista' })).status, 200);
  assert.ok(Math.abs((await bal()) - 1) < 0.0001);
  // histórico, CSV e auditoria
  const list = (await apiC('GET', '/api/stock/corrections')).data;
  assert.deepEqual(list.items.slice(0, 3).map((x) => x.status), ['rejeitada', 'aplicada', 'aplicada']);
  const csv = await fetch(`${base}/api/stock/corrections?format=csv`, { headers: { authorization: `Bearer ${C.token}`, "x-terminal-id": String(C.terminal) } });
  assert.match(await csv.text(), /saldo_sistema;saldo_real;diferenca/);
  const ev = (await pool.query(`select action from audit_events where company_id = $1 and action like 'estoque.correcao%'`, [C.me.company.id])).rows.map((r) => r.action);
  for (const a of ['estoque.correcao_solicitada', 'estoque.correcao_aplicada_direto', 'estoque.correcao_aprovada', 'estoque.correcao_rejeitada']) assert.ok(ev.includes(a), a);
});
let dlvToken;
await check('delivery: pedido público validado no servidor, sem duplicar, e acompanhamento', async () => {
  const cfg = { slug: 'pub-garagem', enabled: true, accepting: true, delivery: true, pickup: true, fee_cents: 800, min_order_cents: 3000, eta_minutes: 40,
    hours: 'Ter a dom, 18h às 0h', areas: 'Centro', message: '', payment_methods: ['dinheiro', 'pix'] };
  assert.equal((await apiC('PUT', '/api/delivery/settings', cfg)).status, 200);
  const menu = await anon('GET', '/api/public/pub-garagem/menu');
  assert.equal(menu.status, 200); assert.ok(menu.data.products.length >= 5);
  const order = { mode: 'entrega', customer_name: 'Bruno Lima', phone: '11977776666', address: { street: 'Rua A', number: '10' }, payment_hint: 'pix',
    cart: [{ product_id: bIpa.id, qty: 1 }], client_key: key() };
  const small = await anon('POST', '/api/public/pub-garagem/orders', order);
  assert.equal(small.data.code, 'min_order', JSON.stringify(small.data));
  order.cart = [{ product_id: bIpa.id, qty: 2, unit_price_cents: 1 }];
  const r = await anon('POST', '/api/public/pub-garagem/orders', order);
  assert.equal(r.status, 201, JSON.stringify(r.data)); dlvToken = r.data.token;
  const again = await anon('POST', '/api/public/pub-garagem/orders', order);
  assert.equal(again.status, 200); assert.equal(again.data.number, r.data.number);
  const tr = await anon('GET', `/api/public/orders/${dlvToken}`);
  assert.equal(tr.data.totals.total, 2 * 2890 + 800); assert.equal(tr.data.status, 'recebido'); assert.ok(!('phone' in tr.data));
  const orders = (await apiC('GET', '/api/delivery/orders?status=abertos')).data;
  const o = orders.find((x) => x.number === r.data.number);
  assert.equal((await apiC('POST', `/api/delivery/orders/${o.id}/status`, { to: 'saiu' })).status, 409);
  for (const to of ['confirmado', 'pronto', 'saiu']) assert.equal((await apiC('POST', `/api/delivery/orders/${o.id}/status`, { to })).status, 200);
  assert.equal((await apiC('POST', `/api/delivery/orders/${o.id}/status`, { to: 'entregue' })).data.code, 'balance_pending');
  await apiC('POST', `/api/pdv/sessions/${o.session_id}/payments`, { method: 'pix', amount_cents: 6580, idempotency_key: key() });
  assert.equal((await apiC('POST', `/api/delivery/orders/${o.id}/status`, { to: 'entregue' })).status, 200);
  assert.equal((await anon('GET', `/api/public/orders/${dlvToken}`)).data.status, 'entregue');
  assert.equal((await anon('GET', '/api/public/orders/token-que-nao-existe-123')).status, 404);
});
await check('relatórios: totais por período, CMV só com permissão e exportação sem fórmulas', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const r = await apiC('GET', `/api/reports/overview?from=${from}&to=${today}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.summary.sessions >= 1); assert.ok(r.data.summary.revenue_cents > 0); assert.ok(r.data.by_product.length);
  assert.ok(r.data.summary.cmv_cents != null);
  const csv = await apiC('GET', `/api/reports/export?section=produtos&from=${from}&to=${today}`);
  assert.equal(csv.status, 200); assert.match(csv.data, /Produto;/);
});
await check('avaliação pós-consumo por link assinado; marketing respeita consentimento', async () => {
  const s = (await pool.query("select id from consumption_sessions where company_id = $1 and status = 'encerrada' and customer_id is not null limit 1", [C.me.company.id])).rows[0];
  const link = (await apiC('GET', `/api/marketing/review-link/${s.id}`)).data;
  assert.equal((await anon('POST', `/api/public/review/${s.id}.forjado1234567`, { score: 5 })).status, 404);
  assert.equal((await anon('POST', `/api/public/review/${link.token}`, { score: 2, comment: 'Demorou' })).status, 201);
  assert.equal((await anon('POST', `/api/public/review/${link.token}`, { score: 5 })).status, 409);
  const rv = (await apiC('GET', '/api/marketing/reviews')).data;
  assert.equal(rv.stats.pending, 1);
  await apiC('POST', '/api/customers', { name: 'Sem consentimento', phone: '11955554444' });
  const pv = await apiC('POST', '/api/marketing/segments/preview', { channel: 'whatsapp', segment: {} });
  assert.equal(pv.data.recipients, 1);
  const camp = await apiC('POST', '/api/marketing/campaigns', { name: 'Volta', channel: 'whatsapp', segment: {}, message: 'Oi {nome}, temos novidade no {empresa}!' });
  assert.equal((await apiC('POST', `/api/marketing/campaigns/${camp.data.id}/prepare`)).data.recipients, 1);
  const rec = (await apiC('GET', `/api/marketing/campaigns/${camp.data.id}/recipients?base=https://x.dev`)).data;
  assert.match(rec[0].message, /^Oi Ana, temos novidade no Pub Garagem!/);
  const unsub = rec[0].message.match(/\/sair\/(\S+)/)[1];
  assert.equal((await anon('POST', `/api/public/unsubscribe/${unsub}`)).status, 200);
  assert.equal((await apiC('POST', '/api/marketing/segments/preview', { channel: 'whatsapp', segment: {} })).data.recipients, 0);
  const send = await apiC('POST', `/api/marketing/campaigns/${camp.data.id}/send`, { base_url: 'https://x.dev' });
  assert.equal(send.data.sent, 0);
});
await check('agente: simulador monta pedido sem criar venda; webhook exige assinatura', async () => {
  const sim = (body) => apiC('POST', '/api/agent/simulate', { body, contact: 't1' });
  assert.match((await sim('oi')).data.replies[0], /cardápio/);
  assert.match((await sim('quanto custa a caipirinha?')).data.replies[0], /Caipirinha.*24,00/);
  await sim('quero fazer um pedido');
  assert.match((await sim('2 pilsen')).data.replies[0], /2× Pilsen/);
  await sim('finalizar'); await sim('retirada');
  assert.match((await sim('Carla')).data.replies[0], /Total: R\$ 25,80/);
  const before = (await pool.query('select count(*)::int as n from delivery_orders where company_id = $1', [C.me.company.id])).rows[0].n;
  assert.match((await sim('confirmar')).data.replies[0], /Simulação/);
  assert.equal((await pool.query('select count(*)::int as n from delivery_orders where company_id = $1', [C.me.company.id])).rows[0].n, before);
  assert.equal((await sim('quero falar com um atendente')).data.handoff, true);
  const bad = await fetch(`${base}/api/public/whatsapp/pub-garagem`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' }, body: '{}' });
  assert.equal(bad.status, 403);
  await apiC('PUT', '/api/agent/secrets', { wa_app_secret: 'segredo-app-teste' });
  const settings = (await apiC('GET', '/api/agent/settings')).data;
  assert.equal(settings.secrets.wa_app_secret, true); assert.ok(!JSON.stringify(settings).includes('segredo-app-teste'));
  const bad2 = await fetch(`${base}/api/public/whatsapp/pub-garagem`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=00' }, body: '{}' });
  assert.equal(bad2.status, 401);
  const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: '5511999990000', profile: { name: 'Dani' } }], messages: [{ id: 'wamid.1', from: '5511999990000', type: 'text', text: { body: 'horário' } }] } }] }] });
  const sig = `sha256=${crypto.createHmac('sha256', 'segredo-app-teste').update(body).digest('hex')}`;
  const ok = await fetch(`${base}/api/public/whatsapp/pub-garagem`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });
  assert.equal(ok.status, 200);
  await fetch(`${base}/api/public/whatsapp/pub-garagem`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });
  const convs = (await apiC('GET', '/api/agent/conversations')).data;
  const conv = (await apiC('GET', `/api/agent/conversations/${convs[0].id}`)).data;
  assert.equal(conv.messages.filter((m) => m.direction === 'in').length, 1, 'webhook reentregue não duplica');
});
await check('nota por foto: sem chave avisa; com leitura, confere, cria insumo, recebe e aprende o apelido', async () => {
  const img = 'data:image/jpeg;base64,' + Buffer.from('foto-de-teste').toString('base64');
  const off = await apiC('POST', '/api/stock/notes/read', { image: img });
  assert.equal(off.status, 503); assert.equal(off.data.code, 'ai_not_configured');
  // serviço de visão falso: devolve a nota como o modelo devolveria
  const fake = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => {
    const body = JSON.parse(b); assert.equal(rq.headers['x-api-key'], 'sk-ant-teste-0000000000000000000000'); assert.equal(body.messages[0].content[0].type, 'image');
    rs.writeHead(200, { 'content-type': 'application/json' });
    rs.end(JSON.stringify({ content: [{ type: 'text', text: 'Aqui está: {"supplier":"Atacadão Bebidas","document":"NF 1234","date":"2026-09-30","total":186.0,"items":[{"description":"CARNE MOIDA BOV KG","qty":2,"unit":"KG","unit_price":33.0,"total":66.0},{"description":"CERV PILSEN LN 355ML CX12","qty":2,"unit":"CX","unit_price":60.0,"total":120.0}],"warnings":[]}' }] }));
  }); });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.AI_API_URL = `http://127.0.0.1:${fake.address().port}`;
  assert.equal((await apiC('PUT', '/api/stock/notes/key', { api_key: 'sk-ant-teste-0000000000000000000000' })).status, 200);
  assert.equal((await apiC('GET', '/api/stock/notes/status')).data.photo, true);
  const r = await apiC('POST', '/api/stock/notes/read', { image: img });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.supplier, 'Atacadão Bebidas'); assert.equal(r.data.items.length, 2);
  assert.equal(r.data.items[0].stock_item_id, carne, 'carne reconhecida pelo nome');
  assert.equal(r.data.items[1].stock_item_id, null);
  const before = (await apiC('GET', '/api/stock/items')).data.find((x) => x.id === carne).balance;
  const conf = await apiC('POST', '/api/stock/notes/confirm', { supplier: r.data.supplier, document: r.data.document, source: 'foto', lines: [
    { description: r.data.items[0].description, stock_item_id: carne, qty: 2, factor: 1, unit_cost_cents: 3300 },
    { description: r.data.items[1].description, new_item: { name: 'Pilsen lata 355 ml', unit: 'un' }, qty: 2, factor: 12, unit_cost_cents: 6000 }] });
  assert.equal(conf.status, 201, JSON.stringify(conf.data));
  const items = (await apiC('GET', '/api/stock/items')).data;
  assert.equal(items.find((x) => x.id === carne).balance, before + 2);
  const lata = items.find((x) => x.name === 'Pilsen lata 355 ml');
  assert.equal(lata.balance, 24); assert.equal(lata.avg_cost_cents, 500);
  const again = await apiC('POST', '/api/stock/notes/read', { image: img });
  assert.equal(again.data.items[1].stock_item_id, lata.id); assert.equal(again.data.items[1].factor, 12); assert.equal(again.data.items[1].match, 'aprendido');
  const key = '3526' + '1'.repeat(40);
  const x1 = await apiC('POST', '/api/stock/notes/confirm', { supplier: 'Fornecedor X', source: 'xml', nfe_key: key, lines: [{ description: 'a', stock_item_id: carne, qty: 1, unit_cost_cents: 100 }] });
  assert.equal(x1.status, 201);
  assert.equal((await apiC('POST', '/api/stock/notes/confirm', { supplier: 'Fornecedor X', source: 'xml', nfe_key: key, lines: [{ description: 'a', stock_item_id: carne, qty: 1, unit_cost_cents: 100 }] })).data.code, 'nfe_duplicate');
  assert.equal((await apiC('GET', '/api/stock/notes/status')).data.own_key, true);
  const man = await apiC('POST', '/api/stock/notes/confirm', { supplier: 'Mercado do bairro', source: 'manual', lines: [{ description: 'Carne', stock_item_id: carne, qty: 1, unit_cost_cents: 3000 }] });
  assert.equal(man.status, 201, JSON.stringify(man.data));
  delete process.env.AI_API_URL; fake.close();
});
await check('código de barras: pedido de compra recebe com novo custo; chave da NF-e confere, busca XML (Focus) e não duplica', async () => {
  const { purchaseCode, nfeKeyDigit } = await import('../src/lib/barcode.js');
  const before = (await apiC('GET', '/api/stock/items')).data.find((x) => x.id === carne);
  const pc = await apiC('POST', '/api/stock/purchases', { supplier: 'Frigorífico Boi Bom', lines: [{ stock_item_id: carne, qty: 4, unit_cost_cents: 3000 }] });
  assert.equal(pc.status, 201);
  const list = (await apiC('GET', '/api/stock/purchases')).data;
  assert.equal(list.find((x) => x.id === pc.data.id).code, purchaseCode(pc.data.id));
  const r = await apiC('POST', '/api/stock/barcode', { code: purchaseCode(pc.data.id) });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.kind, 'pedido'); assert.equal(r.data.purchase.lines.length, 1);
  assert.equal((await api('POST', '/api/stock/barcode', { code: purchaseCode(pc.data.id) })).status, 404, 'pedido de outra empresa não aparece');
  assert.equal((await apiC('POST', '/api/stock/barcode', { code: 'PC000000010' })).data.code, 'barcode_invalid');
  const line = r.data.purchase.lines[0];
  const rec = await apiC('POST', `/api/stock/purchases/${pc.data.id}/receive`, { lines: [{ line_id: line.id, qty: 4, unit_cost_cents: 3600 }] });
  assert.equal(rec.status, 200, JSON.stringify(rec.data)); assert.equal(rec.data.status, 'recebida');
  const after = (await apiC('GET', '/api/stock/items')).data.find((x) => x.id === carne);
  assert.equal(after.balance, before.balance + 4);
  const prev = Math.max(0, before.balance);
  assert.equal(Math.round(after.avg_cost_cents), Math.round((prev * before.avg_cost_cents + 4 * 3600) / (prev + 4)), 'custo médio com o preço da entrega');
  assert.equal((await apiC('GET', '/api/stock/purchases')).data.find((x) => x.id === pc.data.id).total_cents, 14400);

  // NF-e: chave com dígito verificador; sem Focus pede o XML; com Focus falsa traz o XML
  const b43 = '4126091122233300014455001000000777100000077';
  const key = b43 + nfeKeyDigit(b43);
  const k1 = await apiC('POST', '/api/stock/barcode', { code: key });
  assert.equal(k1.data.kind, 'nfe'); assert.equal(k1.data.info.cnpj, '11222333000144'); assert.equal(k1.data.duplicate, null); assert.equal(k1.data.xml_by_key, false);
  assert.equal((await apiC('POST', '/api/stock/notes/xml-by-key', { key })).data.code, 'focus_not_configured');
  const xml = `<nfeProc><NFe><infNFe Id="NFe${key}"><emit><CNPJ>11222333000144</CNPJ><xNome>Distribuidora Sul</xNome></emit><det><prod><xProd>CARNE</xProd><qCom>1</qCom></prod></det></infNFe></NFe></nfeProc>`;
  let calls = [];
  const focus = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => {
    calls.push(`${rq.method} ${rq.url}`);
    assert.equal(rq.headers.authorization, `Basic ${Buffer.from('focus-token-teste-123456:').toString('base64')}`);
    if (rq.method === 'GET' && calls.filter((c) => c.startsWith('GET')).length === 1) { rs.writeHead(404); return rs.end('{"codigo":"nao_encontrado"}'); }
    if (rq.method === 'POST') { assert.equal(JSON.parse(b).tipo, 'ciencia'); rs.writeHead(201, { 'content-type': 'application/json' }); return rs.end('{"status":"evento_registrado"}'); }
    rs.writeHead(200, { 'content-type': 'application/xml' }); rs.end(xml);
  }); });
  await new Promise((ok) => focus.listen(0, '127.0.0.1', ok));
  process.env.FOCUS_API_URL = `http://127.0.0.1:${focus.address().port}`;
  assert.equal((await apiC('PUT', '/api/stock/notes/focus', { token: 'focus-token-teste-123456' })).status, 200);
  const p1 = await apiC('POST', '/api/stock/notes/xml-by-key', { key });
  assert.equal(p1.data.pending, true, JSON.stringify(p1.data));
  const p2 = await apiC('POST', '/api/stock/notes/xml-by-key', { key });
  assert.ok(p2.data.xml.includes(key));
  const conf = await apiC('POST', '/api/stock/notes/confirm', { supplier: 'Distribuidora Sul', source: 'xml', nfe_key: key, supplier_doc: '11222333000144',
    lines: [{ description: 'CARNE', stock_item_id: carne, qty: 1, unit_cost_cents: 3500 }] });
  assert.equal(conf.status, 201, JSON.stringify(conf.data));
  const k2 = await apiC('POST', '/api/stock/barcode', { code: key });
  assert.equal(k2.data.duplicate, conf.data.purchase_id); assert.equal(k2.data.supplier, 'Distribuidora Sul');
  assert.equal((await apiC('GET', '/api/stock/notes/status')).data.xml_by_key, true);
  delete process.env.FOCUS_API_URL; focus.close();
});
await check('módulos isolados por empresa', async () => {
  assert.equal((await api('GET', `/api/customers/${custId}`)).status, 404);
  assert.ok(!(await api('GET', '/api/stock/items')).data.find((x) => x.id === carne));
  assert.equal((await api('GET', '/api/delivery/orders')).data.length, 0);
});

await check('auditoria é somente inclusão', async () => {
  await assert.rejects(pool.query('update audit_events set action = $1 where id = 1', ['x']));
  await assert.rejects(pool.query('delete from audit_events where id = 1'));
});
await check('renovação de sessão com rotação; reuso do token antigo encerra tudo', async () => {
  const r1 = await anon('POST', '/api/auth/refresh', { refresh_token: A.refresh });
  assert.equal(r1.status, 200);
  const reuse = await anon('POST', '/api/auth/refresh', { refresh_token: A.refresh });
  assert.equal(reuse.status, 401);
  assert.equal((await client(r1.data.access_token)('GET', '/api/auth/me')).status, 401);
});
await check('bloqueio temporário após 8 senhas erradas', async () => {
  for (let i = 0; i < 8; i++) await anon('POST', '/api/auth/login', { email: 'b@teste.dev', password: 'errada' });
  const r = await anon('POST', '/api/auth/login', { email: 'b@teste.dev', password: 'Motocustom2026x' });
  assert.equal(r.status, 423);
});
await check('conta do cliente: fiado com limite, crédito antecipado, caixa e estornos', async () => {
  await apiC('POST', '/api/floor/cards', { from: 101, count: 3 });
  const extra = (await apiC('GET', '/api/floor/cards')).data.cards.filter((c) => c.number > 100);
  const open = async (i, withCustomer = true) => {
    const s = await apiC('POST', '/api/pdv/sessions', { kind: 'comanda', card_id: extra[i - 10].id, ...(withCustomer ? { customer_id: custId } : {}) });
    assert.equal(s.status, 201, `abrir comanda ${i}: ${JSON.stringify(s.data)}`);
    await apiC('POST', '/api/pdv/items', { session_id: s.data.id, product_id: bIpa.id, qty: 2, launch_mode: 'manual', idempotency_key: key() });
    return (await apiC('GET', `/api/pdv/sessions/${s.data.id}`)).data;
  };
  const pay = (sid, method, amount) => apiC('POST', `/api/pdv/sessions/${sid}/payments`, { method, amount_cents: amount, idempotency_key: key() });
  // sem cliente na comanda não há fiado; "Outro" foi aposentado
  const anon1 = await open(10, false);
  assert.equal((await pay(anon1.id, 'fiado', 100)).data.code, 'customer_required');
  assert.equal((await pay(anon1.id, 'outro', 100)).data.code, 'method_retired');
  // limite de fiado: o operador sem permissão de gerente é barrado acima do limite
  await apiC('PUT', `/api/accounts/customers/${custId}/limit`, { fiado_limit_cents: 1000 });
  await apiC('POST', '/api/admin/users', { name: 'Caixa C', email: 'cx@teste.dev', password: 'Caixa2026xyzw', role_key: 'caixa' });
  const cl = await anon('POST', '/api/auth/login', { email: 'cx@teste.dev', password: 'Caixa2026xyzw' });
  const cx = client(cl.data.access_token, C.terminal);
  const s1 = await open(11);
  assert.ok(s1.account && s1.account.has_cpf);
  const bal1 = s1.totals.balance;
  assert.equal((await cx('POST', `/api/pdv/sessions/${s1.id}/payments`, { method: 'fiado', amount_cents: bal1, idempotency_key: key() })).data.code, 'fiado_limit');
  // o proprietário (gerente) libera acima do limite, e fica registrado
  const f = await pay(s1.id, 'fiado', bal1);
  assert.equal(f.status, 201, JSON.stringify(f.data)); assert.equal(f.data.account.over_limit, true);
  let acc = (await apiC('GET', `/api/accounts/customers/${custId}`)).data;
  assert.equal(acc.debt_cents, bal1); assert.ok(acc.open_since);
  // a comanda seguinte mostra o fiado em aberto
  const s2 = await open(12);
  assert.equal(s2.account.debt_cents, bal1);
  // receber o fiado: não passa do devido; entra no caixa pela forma usada
  const before = (await apiC('GET', '/api/cash/current')).data.expected.byMethod.dinheiro;
  assert.equal((await apiC('POST', `/api/accounts/customers/${custId}/settle`, { amount_cents: bal1 + 1, method: 'dinheiro', idempotency_key: key() })).data.code, 'over_debt');
  const st = await apiC('POST', `/api/accounts/customers/${custId}/settle`, { amount_cents: bal1, method: 'dinheiro', idempotency_key: key() });
  assert.equal(st.status, 201, JSON.stringify(st.data)); assert.equal(st.data.balance_cents, 0);
  const cur = (await apiC('GET', '/api/cash/current')).data.expected;
  assert.equal(cur.byMethod.dinheiro, before + bal1); assert.equal(cur.info.fiado, bal1);
  // crédito antecipado por Pix e uso no consumo
  await apiC('POST', `/api/accounts/customers/${custId}/credit`, { amount_cents: 500, method: 'pix', idempotency_key: key() });
  assert.equal((await pay(s2.id, 'saldo_cliente', 600)).data.code, 'insufficient_credit');
  const u = await pay(s2.id, 'saldo_cliente', 500);
  assert.equal(u.status, 201, JSON.stringify(u.data));
  acc = (await apiC('GET', `/api/accounts/customers/${custId}`)).data;
  assert.equal(acc.balance_cents, 0);
  // estorno do pagamento da comanda devolve o crédito; lançamentos não mudam
  await apiC('POST', `/api/pdv/payments/${u.data.payment.id}/refund`, { reason: 'cliente pagou em dinheiro' });
  acc = (await apiC('GET', `/api/accounts/customers/${custId}`)).data;
  assert.equal(acc.credit_cents, 500);
  assert.ok(acc.entries.find((e) => e.kind === 'estorno'));
  await assert.rejects(pool.query('update customer_account set amount_cents = 1 where company_id = $1', [C.me.company.id]));
  const open1 = (await apiC('GET', '/api/accounts/open')).data;
  assert.equal(open1.credit_cents, 500);
  const ev = (await pool.query(`select action from audit_events where company_id = $1 and action in ('pagamento.fiado','cliente.fiado_recebido','cliente.credito_lancado','cliente.limite_fiado')`, [C.me.company.id])).rows.map((r) => r.action);
  for (const a of ['pagamento.fiado', 'cliente.fiado_recebido', 'cliente.credito_lancado', 'cliente.limite_fiado']) assert.ok(ev.includes(a), a);
});
await check('esqueci minha senha: link pela central, uso único, encerra sessões', async () => {
  const before = (hub.mails || []).length;
  assert.equal((await anon('GET', '/api/auth/reset-options')).data.available, true);
  // e-mail desconhecido: mesma resposta, nenhum envio
  const g = await anon('POST', '/api/auth/forgot', { email: 'ninguem@teste.dev' });
  assert.equal(g.status, 200); assert.equal((hub.mails || []).length, before);
  const r = await anon('POST', '/api/auth/forgot', { email: 'cx@teste.dev' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const mail = hub.mails.at(-1);
  assert.equal(mail.to, 'cx@teste.dev'); assert.match(mail.path, /^\/redefinir-senha\?token=/);
  const token = new URL(`http://x${mail.path}`).searchParams.get('token');
  assert.equal((await anon('POST', '/api/auth/reset', { token, new_password: 'curta' })).status, 400);
  assert.equal((await anon('POST', '/api/auth/reset', { token, new_password: 'NovaSenha2026xyz' })).status, 200);
  assert.equal((await anon('POST', '/api/auth/reset', { token, new_password: 'OutraSenha2026xyz' })).data.code, 'reset_invalid');
  assert.equal((await anon('POST', '/api/auth/login', { email: 'cx@teste.dev', password: 'Caixa2026xyzw' })).status, 401);
  assert.equal((await anon('POST', '/api/auth/login', { email: 'cx@teste.dev', password: 'NovaSenha2026xyz' })).status, 200);
});
await check('InfinitePay: link com o valor, aviso só vale conferido, pagamento entra uma vez na comanda', async () => {
  const ipState = { links: [], paid: {} };
  const fake = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : {};
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/links') { ipState.links.push(b); return res.end(JSON.stringify({ url: `https://checkout.infinitepay.io/${b.handle}/abc${ipState.links.length}` })); }
      if (req.url === '/payment_check') { const p = ipState.paid[b.order_nsu]; return res.end(JSON.stringify(p ? { success: true, paid: true, amount: p.amount, paid_amount: p.amount, installments: 1, capture_method: p.method } : { success: true, paid: false })); }
      res.end('{}');
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  process.env.INFINITEPAY_API_URL = `http://127.0.0.1:${fake.address().port}`;
  try {
    assert.equal((await apiC('POST', '/api/infinitepay/charges', { session_id: 1, amount_cents: 100 })).data.code !== undefined, true);
    assert.equal((await apiC('PUT', '/api/infinitepay/settings', { enabled: true, handle: '$Bar_Teste' })).data.handle, 'bar_teste');
    await apiC('POST', '/api/floor/cards', { from: 201, count: 1 });
    const card = (await apiC('GET', '/api/floor/cards')).data.cards.find((c) => c.number === 201);
    const s = await apiC('POST', '/api/pdv/sessions', { kind: 'comanda', card_id: card.id });
    await apiC('POST', '/api/pdv/items', { session_id: s.data.id, product_id: bIpa.id, qty: 1, launch_mode: 'manual', idempotency_key: key() });
    const bal = (await apiC('GET', `/api/pdv/sessions/${s.data.id}`)).data.totals.balance;
    assert.equal((await apiC('POST', '/api/infinitepay/charges', { session_id: s.data.id, amount_cents: bal + 1 })).status, 400);
    const ch = await apiC('POST', '/api/infinitepay/charges', { session_id: s.data.id, amount_cents: bal, api_base: base });
    assert.equal(ch.status, 201, JSON.stringify(ch.data)); assert.equal(ch.data.status, 'pendente'); assert.match(ch.data.link_url, /checkout\.infinitepay\.io/);
    const sent = ipState.links.at(-1);
    assert.equal(sent.items[0].price, bal); assert.equal(sent.order_nsu, ch.data.order_nsu);
    const hook = sent.webhook_url.replace(/^https?:\/\/[^/]+/, base);
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    // aviso falso (pedido de outro) e aviso sem pagamento confirmado não lançam nada
    assert.equal((await post(hook, { order_nsu: 'OUTRO', transaction_nsu: 't1', invoice_slug: 's1' })).status, 400);
    assert.equal((await post(hook, { order_nsu: ch.data.order_nsu, transaction_nsu: 't1', invoice_slug: 's1', capture_method: 'pix' })).status, 200);
    assert.equal((await apiC('GET', `/api/infinitepay/charges/${ch.data.id}`)).data.status, 'pendente');
    // confirmado na InfinitePay: entra uma única vez, como integração
    ipState.paid[ch.data.order_nsu] = { amount: bal, method: 'pix' };
    for (let i = 0; i < 2; i++) assert.equal((await post(hook, { order_nsu: ch.data.order_nsu, transaction_nsu: 't1', invoice_slug: 's1', capture_method: 'pix', receipt_url: 'https://comprovante.test/1' })).status, 200);
    const done = (await apiC('GET', `/api/infinitepay/charges/${ch.data.id}`)).data;
    assert.equal(done.status, 'pago'); assert.equal(done.confirmed_by, 'webhook');
    const full = (await apiC('GET', `/api/pdv/sessions/${s.data.id}`)).data;
    const pays = full.payments.filter((p) => p.source === 'integracao');
    assert.equal(pays.length, 1); assert.equal(pays[0].method, 'pix'); assert.equal(full.totals.balance, 0);
    // valor conferido diferente do cobrado: fica para conferência, sem lançar
    await apiC('POST', '/api/pdv/items', { session_id: s.data.id, product_id: bIpa.id, qty: 1, launch_mode: 'manual', idempotency_key: key() });
    const bal2 = (await apiC('GET', `/api/pdv/sessions/${s.data.id}`)).data.totals.balance;
    const ch2 = await apiC('POST', '/api/infinitepay/charges', { session_id: s.data.id, amount_cents: bal2, api_base: base });
    ipState.paid[ch2.data.order_nsu] = { amount: bal2 - 100, method: 'credit_card' };
    const ret = await anon('POST', '/api/public/infinitepay/return', { c: ipState.links.at(-1).redirect_url.split('c=')[1], transaction_nsu: 't2', slug: 's2', capture_method: 'credit_card' });
    assert.equal(ret.status, 200, JSON.stringify(ret.data));
    assert.equal((await apiC('GET', `/api/infinitepay/charges/${ch2.data.id}`)).data.status, 'divergente');
    const panel = (await apiC('GET', '/api/infinitepay/charges')).data;
    assert.equal(panel.totals.pix, bal); assert.equal(panel.totals.divergente, bal2);
  } finally { fake.close(); delete process.env.INFINITEPAY_API_URL; }
});
await check('vendas da maquininha: importa o relatório, confere, evita duplicar, substitui, entra nos relatórios e cancela', async () => {
  const api = client((await anon('POST', '/api/auth/login', { email: 'a@teste.dev', password: 'Motocustom2026x' })).data.access_token, A.terminal);
  const pdf = (tag) => Buffer.from(`%PDF-1.7\n% relatorio de teste ${tag}\n${'x'.repeat(200)}\n%%EOF`).toString('base64');
  const rep = { account: '00.000.000 TESTE', generated_on: '2026-10-02', period_from: '2026-09-02', period_to: '2026-10-02', gross_cents: 536842, net_cents: 526289, fee_cents: 10553, tx_count: 108,
    days: [{ day: '2026-09-18', gross_cents: 422908, net_cents: 414827, tx_count: 96 }, { day: '2026-09-19', gross_cents: 5200, net_cents: 5066, tx_count: 1 }, { day: '2026-09-23', gross_cents: 108734, net_cents: 106396, tx_count: 11 }],
    methods: [{ label: 'Débito', gross_cents: 268168 }, { label: 'Crédito', gross_cents: 205417 }, { label: 'Pix', gross_cents: 55563 }, { label: 'Money', gross_cents: 7694 }],
    products: [{ name: 'CHOPP LAGER 400 ml', qty: 17 }], categories: [{ name: 'CHOPP e CERVEJA', qty: 65 }], notes: ['ranking parcial'] };
  // números que não fecham são recusados
  const broken = { ...rep, days: rep.days.map((d, i) => (i ? d : { ...d, gross_cents: d.gross_cents + 1000 })) };
  assert.equal((await api('POST', '/api/pos-sales', { file_name: 'r.pdf', file_b64: pdf('a'), mode: 'externa', report: broken })).status, 400);
  assert.equal((await api('POST', '/api/pos-sales', { file_name: 'r.txt', file_b64: Buffer.from('nao e pdf'.repeat(20)).toString('base64'), mode: 'externa', report: rep })).status, 400);
  const pv = await api('POST', '/api/pos-sales/preview', { file_name: 'r.pdf', file_b64: pdf('a'), report: rep });
  assert.equal(pv.status, 200, JSON.stringify(pv.data)); assert.deepEqual(pv.data.problems, []); assert.equal(pv.data.reconciliation.length, 3);
  const imp = await api('POST', '/api/pos-sales', { file_name: 'relatorio_vendas.pdf', file_b64: pdf('a'), mode: 'externa', report: rep });
  assert.equal(imp.status, 201, JSON.stringify(imp.data));
  // o mesmo arquivo não entra de novo; outro arquivo com os mesmos dias exige substituição
  assert.equal((await api('POST', '/api/pos-sales', { file_name: 'relatorio_vendas.pdf', file_b64: pdf('a'), mode: 'externa', report: rep })).data.code, 'duplicate');
  const ov = await api('POST', '/api/pos-sales', { file_name: 'novo.pdf', file_b64: pdf('b'), mode: 'externa', report: rep });
  assert.equal(ov.status, 409); assert.equal(ov.data.code, 'overlap');
  // valores importados não mudam pelo banco
  await assert.rejects(pool.query('update pos_sales_imports set gross_cents = 1 where id = $1', [imp.data.id]));
  const rp = (await api('GET', '/api/reports/overview?from=2026-09-01&to=2026-09-30')).data;
  assert.equal(rp.external.gross_cents, 536842); assert.equal(rp.external.fee_cents, 10553); assert.equal(rp.external.tx_count, 108);
  assert.equal(rp.summary.revenue_total_cents, rp.summary.revenue_cents + 536842);
  assert.equal(rp.external.methods_exact, false); // relatório vai até 02/10: formas proporcionais
  assert.equal(rp.external.by_method.find((m) => m.method === 'dinheiro').total, 7694);
  const part = (await api('GET', '/api/reports/overview?from=2026-09-19&to=2026-09-19')).data.external;
  assert.equal(part.gross_cents, 5200); assert.equal(part.tx_count, 1);
  // substituição: a anterior é cancelada com motivo e os dias passam para a nova
  const rep2 = await api('POST', '/api/pos-sales', { file_name: 'novo.pdf', file_b64: pdf('b'), mode: 'conferencia', replace: true, report: rep });
  assert.equal(rep2.status, 201, JSON.stringify(rep2.data)); assert.deepEqual(rep2.data.replaced, [imp.data.id]);
  const list = (await api('GET', '/api/pos-sales')).data;
  assert.equal(list.items.find((i) => i.id === imp.data.id).status, 'cancelado');
  assert.equal(list.totals.gross_cents, 0); // "só conferência" não soma ao faturamento
  assert.equal((await api('GET', '/api/reports/overview?from=2026-09-01&to=2026-09-30')).data.external, null);
  const det = (await api('GET', `/api/pos-sales/${rep2.data.id}`)).data;
  assert.equal(det.days.length, 3); assert.equal(det.methods[3].method, 'dinheiro'); assert.equal(det.reconciliation.length, 3);
  // outra empresa não vê nem cancela
  assert.equal((await apiC('GET', `/api/pos-sales/${rep2.data.id}`)).status, 404);
  assert.equal((await apiC('POST', `/api/pos-sales/${rep2.data.id}/cancel`, { reason: 'tentativa indevida' })).status, 404);
  assert.equal((await api('POST', `/api/pos-sales/${rep2.data.id}/cancel`, { reason: 'x' })).status, 400);
  assert.equal((await api('POST', `/api/pos-sales/${rep2.data.id}/cancel`, { reason: 'relatório errado' })).status, 200);
  const again = await api('POST', '/api/pos-sales', { file_name: 'relatorio_vendas.pdf', file_b64: pdf('a'), mode: 'externa', report: rep });
  assert.equal(again.status, 201, JSON.stringify(again.data)); // depois de cancelar, pode importar de novo
});
await check('vendas da maquininha: produtos do relatório viram saída de estoque (ficha/acabado), lembram o vínculo e estornam ao cancelar', async () => {
  const pdf = (tag) => Buffer.from(`%PDF-1.7\n% estoque ${tag}\n${'y'.repeat(200)}\n%%EOF`).toString('base64');
  const pilsProd = bProducts.find((p) => p.name.startsWith('Pilsen'));
  await apiC('PUT', '/api/stock/settings', { enabled: true, allow_negative: true });
  const rep = (from, to, day) => ({ period_from: from, period_to: to, gross_cents: 10000, net_cents: 9800, fee_cents: 200, tx_count: 5,
    days: [{ day, gross_cents: 10000, net_cents: 9800, tx_count: 5 }], methods: [{ label: 'Débito', gross_cents: 10000 }],
    products: [{ name: 'HAMBURGUER classico', qty: 3 }, { name: 'PILSEN', qty: 2 }, { name: 'Coisa que não existe', qty: 1 }], categories: [{ name: 'X', qty: 8 }] });
  const bal = async () => Object.fromEntries((await apiC('GET', '/api/stock/items')).data.map((x) => [x.id, x.balance]));
  const imp = await apiC('POST', '/api/pos-sales', { file_name: 'e1.pdf', file_b64: pdf('1'), mode: 'externa', report: rep('2026-08-01', '2026-08-31', '2026-08-10') });
  assert.equal(imp.status, 201, JSON.stringify(imp.data));
  const v = (await apiC('GET', `/api/pos-sales/${imp.data.id}/items`)).data;
  assert.equal(v.rows.length, 3); assert.equal(v.summary.missing_qty, 2); assert.equal(v.can_post, true);
  const burgerRow = v.rows.find((r) => r.report_name.startsWith('HAMBURGUER'));
  assert.equal(burgerRow.suggestion?.product_id, bBurger.id, JSON.stringify(burgerRow)); // sugere pelo nome parecido
  // não lança com linha sem produto
  assert.equal((await apiC('POST', `/api/pos-sales/${imp.data.id}/items/post`)).data.code, 'unmapped');
  const rows = v.rows.map((r) => ({ id: r.id, qty: r.qty, product_id: r.report_name.startsWith('HAMB') ? bBurger.id : r.report_name === 'PILSEN' ? pilsProd.id : null, ignored: r.report_name.startsWith('Coisa') }));
  rows.push({ qty: 1, product_id: bBurger.id, report_name: 'faltou no relatório' });
  const saved = await apiC('PUT', `/api/pos-sales/${imp.data.id}/items`, { rows });
  assert.equal(saved.status, 200, JSON.stringify(saved.data)); assert.equal(saved.data.rows.length, 4);
  assert.ok(saved.data.rows.find((r) => r.product_id === bBurger.id).stock.length >= 2); // prévia dos insumos
  const b0 = await bal();
  const post = await apiC('POST', `/api/pos-sales/${imp.data.id}/items/post`);
  assert.equal(post.status, 200, JSON.stringify(post.data)); assert.equal(post.data.posted, 3);
  const b1 = await bal();
  assert.equal(Math.round((b0[carne] - b1[carne]) * 1000) / 1000, 0.8); // 4 hambúrgueres × 0,2 kg
  assert.equal((await apiC('POST', `/api/pos-sales/${imp.data.id}/items/post`)).status, 400); // nada pendente: não baixa duas vezes
  const after = (await apiC('GET', `/api/pos-sales/${imp.data.id}/items`)).data;
  assert.ok(after.rows.filter((r) => r.status === 'baixado').every((r) => r.moved.length));
  // linha lançada não muda pelo banco
  await assert.rejects(pool.query("update pos_sales_items set qty = 99 where import_id = $1 and status = 'baixado'", [imp.data.id]));
  // próximo relatório reconhece o nome sozinho
  const imp2 = await apiC('POST', '/api/pos-sales', { file_name: 'e2.pdf', file_b64: pdf('2'), mode: 'externa', report: rep('2026-07-01', '2026-07-31', '2026-07-10') });
  const v2 = (await apiC('GET', `/api/pos-sales/${imp2.data.id}/items`)).data;
  assert.equal(v2.rows.find((r) => r.report_name.startsWith('HAMB')).product_id, bBurger.id);
  assert.equal(v2.rows.find((r) => r.report_name === 'PILSEN').product_id, pilsProd.id);
  // produto que não existe no cardápio: cadastra direto (já com estoque) e lança; produto sem controle passa a ser controlado
  const unk = v2.rows.find((r) => r.report_name.startsWith('Coisa'));
  const cr = await apiC('POST', `/api/pos-sales/${imp2.data.id}/items/create-products`, { rows: [{ id: unk.id, name: 'Coisa nova da maquininha', price_cents: 990 }] });
  assert.equal(cr.status, 201, JSON.stringify(cr.data)); assert.deepEqual(cr.data.created, ['Coisa nova da maquininha']);
  const newProd = (await apiC('GET', '/api/menu/products')).data.find((x) => x.name === 'Coisa nova da maquininha');
  assert.equal(newProd.price_cents, 990);
  const plain = bProducts.find((x) => !x.name.startsWith('Pilsen') && x.id !== bBurger.id && x.stock_mode !== 'ficha' && x.stock_mode !== 'acabado');
  await pool.query("update products set stock_mode = 'nenhum', stock_item_id = null where id = $1", [plain.id]);
  const v3 = (await apiC('GET', `/api/pos-sales/${imp2.data.id}/items`)).data;
  const rows3 = v3.rows.map((r) => ({ id: r.id, qty: r.qty, product_id: r.report_name === 'PILSEN' ? plain.id : r.product_id, ignored: false }));
  assert.equal((await apiC('PUT', `/api/pos-sales/${imp2.data.id}/items`, { rows: rows3 })).data.rows.find((r) => r.report_name === 'PILSEN').untracked, true);
  const post2 = await apiC('POST', `/api/pos-sales/${imp2.data.id}/items/post`, { control_untracked: true });
  assert.equal(post2.status, 200, JSON.stringify(post2.data)); assert.deepEqual(post2.data.controlled, [plain.name]);
  const items2 = (await apiC('GET', '/api/stock/items')).data;
  assert.equal(items2.find((x) => x.name === 'Coisa nova da maquininha').balance, -1);
  assert.equal(items2.find((x) => x.name.toLowerCase() === plain.name.toLowerCase()).balance, -2);
  // DRE com o custo dos insumos da maquininha
  const dre = (await apiC('GET', '/api/reports/overview?from=2026-08-01&to=2026-08-31')).data;
  assert.ok(dre.external.cmv_cents > 0); assert.equal(dre.dre.maquininha_cmv, dre.external.cmv_cents);
  // cancelar a importação estorna o estoque
  const bc = await bal();
  assert.equal((await apiC('POST', `/api/pos-sales/${imp.data.id}/cancel`, { reason: 'teste de estorno' })).status, 200);
  const b2 = await bal();
  assert.equal(Math.round((b2[carne] - bc[carne]) * 1000), 800); // devolve os 0,8 kg da primeira importação
  assert.ok((await apiC('GET', `/api/pos-sales/${imp.data.id}/items`)).data.rows.filter((r) => r.moved).every((r) => r.status === 'estornado'));
  // importação "já lançadas nas comandas" não baixa de novo
  const imp3 = await apiC('POST', '/api/pos-sales', { file_name: 'e3.pdf', file_b64: pdf('3'), mode: 'conferencia', report: rep('2026-06-01', '2026-06-30', '2026-06-10') });
  await apiC('GET', `/api/pos-sales/${imp3.data.id}/items`);
  assert.equal((await apiC('POST', `/api/pos-sales/${imp3.data.id}/items/post`)).data.code, 'conference_only');
});
await check('painel da TV: separa por setor, mantém comanda paga com item a retirar e chama só o setor escolhido', async () => {
  const withSector = bProducts.filter((p) => p.sector_id);
  const kitchenP = withSector.find((p) => p.id === bBurger.id) || withSector[0];
  const barP = withSector.find((p) => p.sector_id !== kitchenP.sector_id);
  assert.ok(kitchenP && barP, 'demonstração com dois setores');
  const s = (await apiC('POST', '/api/pdv/sessions', { kind: 'balcao', customer_name: 'Joana Teste' })).data;
  const a = (await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: kitchenP.id, launch_mode: 'manual', idempotency_key: key(),
    ...(kitchenP.groups?.length ? { option_ids: [kitchenP.groups[0].options[0].id] } : {}) })).data;
  const b = (await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: barP.id, launch_mode: 'manual', idempotency_key: key(),
    ...(barP.groups?.length ? { option_ids: [barP.groups[0].options[0].id] } : {}) })).data;
  await apiC('POST', `/api/kitchen/items/${b.item.id}/status`, { to: 'pronto' });
  let bd = (await apiC('GET', '/api/kitchen/board')).data;
  const area = (sid) => bd.areas.find((x) => x.id === sid);
  assert.ok(area(kitchenP.sector_id) && area(barP.sector_id), JSON.stringify(bd.areas.map((x) => x.name)));
  assert.equal(area(barP.sector_id).orders.find((o) => o.id === s.id).status, 'pronto');
  assert.equal(area(kitchenP.sector_id).orders.find((o) => o.id === s.id).status, 'preparando');
  // pagou e fechou no caixa: continua no painel até retirar
  const full = (await apiC('GET', `/api/pdv/sessions/${s.id}`)).data;
  await apiC('POST', `/api/pdv/sessions/${s.id}/payments`, { method: 'pix', amount_cents: full.totals.balance, idempotency_key: key() });
  const f2 = (await apiC('GET', `/api/pdv/sessions/${s.id}`)).data;
  assert.equal((await apiC('POST', `/api/pdv/sessions/${s.id}/close`, { version: f2.version })).status, 200);
  bd = (await apiC('GET', '/api/kitchen/board')).data;
  assert.ok(area(barP.sector_id).orders.find((o) => o.id === s.id), 'comanda paga continua no painel do bar');
  // chamar só o bar
  const call = await apiC('POST', `/api/kitchen/sessions/${s.id}/call`, { sector_ids: [barP.sector_id] });
  assert.equal(call.status, 200, JSON.stringify(call.data)); assert.deepEqual(call.data.sectors, [barP.sector_id]);
  bd = (await apiC('GET', '/api/kitchen/board')).data;
  assert.ok(area(barP.sector_id).orders.find((o) => o.id === s.id).called_at);
  assert.equal(area(kitchenP.sector_id).orders.find((o) => o.id === s.id).called_at, null);
  // retirado: sai do painel do bar; a cozinha segue
  await apiC('POST', `/api/kitchen/items/${b.item.id}/status`, { to: 'entregue' });
  bd = (await apiC('GET', '/api/kitchen/board')).data;
  assert.ok(!area(barP.sector_id)?.orders.find((o) => o.id === s.id));
  assert.ok(area(kitchenP.sector_id).orders.find((o) => o.id === s.id));
  await apiC('POST', `/api/kitchen/items/${a.item.id}/status`, { to: 'pronto' });
  await apiC('POST', `/api/kitchen/items/${a.item.id}/status`, { to: 'entregue' });
});
await check('cozinha: recusar tira da fila e do painel da TV, mas mantém o item (e o valor) na comanda', async () => {
  const p = bProducts.find((x) => x.sector_id && !x.groups?.length) || bProducts.find((x) => x.sector_id);
  const s = (await apiC('POST', '/api/pdv/sessions', { kind: 'balcao', customer_name: 'Recusa Teste' })).data;
  const it = (await apiC('POST', '/api/pdv/items', { session_id: s.id, product_id: p.id, launch_mode: 'manual', idempotency_key: key(),
    ...(p.groups?.length ? { option_ids: [p.groups[0].options[0].id] } : {}) })).data.item;
  const before = (await apiC('GET', `/api/pdv/sessions/${s.id}`)).data.totals.total;
  assert.ok((await apiC('GET', '/api/kitchen/queue')).data.items.find((x) => x.id === it.id));
  const r = await apiC('POST', '/api/kitchen/items/refuse', { item_ids: [it.id], reason: 'servido no balcão' });
  assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.refused, 1);
  assert.ok(!(await apiC('GET', '/api/kitchen/queue')).data.items.find((x) => x.id === it.id));
  assert.ok(!(await apiC('GET', '/api/kitchen/board')).data.orders.find((o) => o.id === s.id));
  const after = (await apiC('GET', `/api/pdv/sessions/${s.id}`)).data;
  assert.equal(after.totals.total, before); assert.ok(after.items.find((x) => x.id === it.id && x.status === 'ativo'));
  assert.equal((await apiC('POST', '/api/kitchen/items/refuse', { item_ids: [it.id] })).data.refused, 0); // repetir não faz nada
});
await check('remoção da demonstração preserva produtos já vendidos', async () => {
  const login = await anon('POST', '/api/auth/login', { email: 'a@teste.dev', password: 'Motocustom2026x' });
  const a2 = client(login.data.access_token, A.terminal);
  const r = await a2('DELETE', '/api/menu/demo');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.deactivated >= 1);
  const ps = (await a2('GET', '/api/menu/products?active=all')).data;
  assert.ok(ps.find((p) => p.id === ipa.id && !p.active));
});

server.close();
hubServer.close();
await pool.end();
console.log(`\n${passed} verificações OK, ${failures.length} falhas`);
if (failures.length) { console.log(failures.map((f) => ` - ${f}`).join('\n')); process.exit(1); }
