// Teste ponta a ponta dos critérios de aceite da Fase 1 (PDV, leitura, caixa, isolamento, central).
// Uso: DATABASE_URL=postgres://.../rusten_test node scripts/smoke.mjs   (APAGA o banco informado)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import http from 'node:http';
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
