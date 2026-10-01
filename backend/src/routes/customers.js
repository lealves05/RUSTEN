// Clientes: busca por CPF (preenche a comanda), cadastro, histórico, fidelidade, importação/exportação e anonimização.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict, csvCell, businessDate } from '../lib/core.js';
import { need, audit, assertCan } from '../lib/auth.js';
import { lockSession, assertUnitScope, sessionTotals } from '../lib/pdv.js';
import { normalizeCpf, onlyDigits, presentCustomer, loyaltyConfig, expirePoints, redeemPoints, addLedger, fmtCpf } from '../lib/customers.js';

export const router = Router();

const base = z.object({
  name: z.string().trim().min(2).max(100),
  cpf: z.string().max(20).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal('')),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('')),
  address: z.object({ street: z.string().max(120).optional(), number: z.string().max(20).optional(), district: z.string().max(80).optional(),
    city: z.string().max(80).optional(), complement: z.string().max(80).optional(), reference: z.string().max(120).optional() }).partial().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  preferences: z.string().max(300).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  consent_whatsapp: z.boolean().optional(),
  consent_email: z.boolean().optional(),
});

const phoneNorm = (p) => { const d = onlyDigits(p); return d ? d.slice(-13) : null; };

async function stats(db, companyId, ids) {
  if (!ids.length) return {};
  const r = await db.query(
    `select s.customer_id, count(*)::int as visits, max(s.closed_at) as last_visit,
            coalesce(sum((select coalesce(sum(i.total_cents),0) from order_items i where i.session_id = s.id and i.status = 'ativo')),0)::bigint as spent_cents
       from consumption_sessions s where s.company_id = $1 and s.customer_id = any($2) and s.status = 'encerrada' group by s.customer_id`, [companyId, ids]);
  return Object.fromEntries(r.rows.map((x) => [x.customer_id, x]));
}

// Busca rápida pelo CPF (abrir comanda): devolve só o necessário para identificar
router.get('/lookup', need('clientes.visualizar'), h(async (req, res) => {
  const cpf = normalizeCpf(req.query.cpf, { required: true });
  const c = (await q('select * from customers where company_id = $1 and cpf = $2 and anonymized_at is null', [req.ctx.companyId, cpf])).rows[0];
  if (!c) return res.json({ found: false, cpf: fmtCpf(cpf) });
  const open = (await q(`select s.id, s.kind, t.number as table_number, cd.number as card_number from consumption_sessions s
      left join dining_tables t on t.id = s.table_id left join tab_cards cd on cd.id = s.card_id
     where s.company_id = $1 and s.customer_id = $2 and s.status in ('aberta','em_fechamento') limit 3`, [req.ctx.companyId, c.id])).rows;
  res.json({ found: true, customer: { id: c.id, name: c.name, points: c.points, tags: c.tags, preferences: c.preferences }, open_sessions: open });
}));

router.get('/', need('clientes.visualizar'), h(async (req, res) => {
  const params = [req.ctx.companyId];
  let where = 'c.company_id = $1 and c.anonymized_at is null';
  const term = String(req.query.q || '').trim().slice(0, 80);
  if (term) {
    const d = onlyDigits(term);
    params.push(`%${term.toLowerCase()}%`);
    where += ` and (lower(c.name) like $${params.length}`;
    if (d.length >= 3) { params.push(`%${d}%`); where += ` or c.cpf like $${params.length} or regexp_replace(coalesce(c.phone,''),'\\D','','g') like $${params.length}`; }
    where += ')';
  }
  if (req.query.tag) { params.push(String(req.query.tag)); where += ` and $${params.length} = any(c.tags)`; }
  if (req.query.birthday === 'mes') where += ' and extract(month from c.birthday) = extract(month from current_date)';
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const total = (await q(`select count(*)::int as n from customers c where ${where}`, params)).rows[0].n;
  const rows = (await q(`select c.* from customers c where ${where} order by lower(c.name) limit ${limit} offset ${offset}`, params)).rows;
  const st = await stats({ query: q }, req.ctx.companyId, rows.map((r) => r.id));
  res.json({ total, items: rows.map((r) => presentCustomer({ ...r, ...(st[r.id] || { visits: 0, spent_cents: 0, last_visit: null }) }, req.ctx)) });
}));

router.get('/summary', need('clientes.visualizar'), h(async (req, res) => {
  const r = (await q(`select count(*)::int as total,
      count(*) filter (where extract(month from birthday) = extract(month from current_date))::int as birthdays,
      count(*) filter (where consent_whatsapp and unsubscribed_at is null)::int as whatsapp_ok,
      coalesce(sum(points),0)::int as points
    from customers where company_id = $1 and anonymized_at is null`, [req.ctx.companyId])).rows[0];
  const tags = (await q(`select t as tag, count(*)::int as n from customers, unnest(tags) t where company_id = $1 and anonymized_at is null group by t order by n desc limit 20`, [req.ctx.companyId])).rows;
  const c = (await q('select settings from companies where id = $1', [req.ctx.companyId])).rows[0];
  res.json({ ...r, tags, loyalty: loyaltyConfig(c.settings) });
}));

router.get('/:id', need('clientes.visualizar'), h(async (req, res) => {
  const id = Number(req.params.id);
  await tx((db) => expirePoints(db, req.ctx.companyId, id));
  const c = (await q('select * from customers where id = $1 and company_id = $2', [id, req.ctx.companyId])).rows[0];
  if (!c) throw notFound('Cliente não encontrado');
  const st = (await stats({ query: q }, req.ctx.companyId, [id]))[id] || { visits: 0, spent_cents: 0, last_visit: null };
  const history = (await q(`select s.id, s.kind, s.opened_at, s.closed_at, s.status,
       (select coalesce(sum(total_cents),0)::bigint from order_items i where i.session_id = s.id and i.status = 'ativo') as items_cents,
       (select string_agg(i.description, ', ' order by i.id) from (select description, id from order_items where session_id = s.id and status = 'ativo' limit 6) i) as items
     from consumption_sessions s where s.company_id = $1 and s.customer_id = $2 order by s.opened_at desc limit 30`, [req.ctx.companyId, id])).rows;
  const ledger = (await q(`select id, kind, points, expires_at, reason, session_id, created_at from loyalty_ledger where company_id = $1 and customer_id = $2 order by id desc limit 50`, [req.ctx.companyId, id])).rows;
  const reviews = (await q('select id, score, comment, created_at from reviews where company_id = $1 and customer_id = $2 order by id desc limit 10', [req.ctx.companyId, id])).rows;
  const ticket = st.visits ? Math.round(Number(st.spent_cents) / st.visits) : 0;
  res.json({ customer: presentCustomer({ ...c, ...st }, req.ctx), ticket_cents: ticket, history, ledger, reviews });
}));

function values(b, ctx) {
  return {
    cpf: b.cpf !== undefined ? normalizeCpf(b.cpf) : undefined,
    phone: b.phone !== undefined ? (b.phone || null) : undefined,
    email: b.email !== undefined ? (b.email || null) : undefined,
    birthday: b.birthday !== undefined ? (b.birthday || null) : undefined,
    consent_at: b.consent_whatsapp || b.consent_email ? new Date() : undefined,
    by: ctx.userId,
  };
}

export async function createCustomer(db, ctx, b) {
  const v = values(b, ctx);
  if (v.phone && phoneNorm(v.phone).length < 10) throw bad('Telefone deve ter DDD');
  const r = await db.query(
    `insert into customers (company_id, cpf, name, phone, email, birthday, address, tags, preferences, notes, consent_whatsapp, consent_email, consent_at, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
    [ctx.companyId, v.cpf ?? null, b.name, v.phone ?? null, v.email ?? null, v.birthday ?? null, b.address || {}, b.tags || [], b.preferences ?? null,
      b.notes ?? null, !!b.consent_whatsapp, !!b.consent_email, v.consent_at ?? null, ctx.userId])
    .catch((e) => { if (e.code === '23505') throw conflict('Já existe cliente com este CPF', 'cpf_in_use'); throw e; });
  await audit(db, ctx, 'cliente.criado', { entity: 'customer', entityId: r.rows[0].id, data: { consent_whatsapp: !!b.consent_whatsapp, consent_email: !!b.consent_email } });
  return r.rows[0];
}

router.post('/', need('clientes.gerenciar'), h(async (req, res) => {
  const b = parse(base, req.body);
  const c = await tx((db) => createCustomer(db, req.ctx, b));
  res.status(201).json(presentCustomer(c, req.ctx));
}));

router.put('/:id', need('clientes.gerenciar'), h(async (req, res) => {
  const b = parse(base.partial(), req.body);
  const id = Number(req.params.id);
  const out = await tx(async (db) => {
    const cur = (await db.query('select * from customers where id = $1 and company_id = $2 for update', [id, req.ctx.companyId])).rows[0];
    if (!cur) throw notFound('Cliente não encontrado');
    if (cur.anonymized_at) throw conflict('Cliente anonimizado não pode ser editado');
    // sem acesso a dados pessoais: não altera campos que não consegue ver
    if (!req.ctx.can('dados.pessoais')) for (const k of ['cpf', 'phone', 'email', 'birthday', 'address']) delete b[k];
    const v = values(b, req.ctx);
    const consentChanged = (b.consent_whatsapp !== undefined && b.consent_whatsapp !== cur.consent_whatsapp)
      || (b.consent_email !== undefined && b.consent_email !== cur.consent_email);
    const r = await db.query(
      `update customers set name = coalesce($3,name), cpf = case when $4::boolean then $5 else cpf end, phone = case when $6::boolean then $7 else phone end,
         email = case when $8::boolean then $9 else email end, birthday = case when $10::boolean then $11::date else birthday end,
         address = coalesce($12,address), tags = coalesce($13,tags), preferences = coalesce($14,preferences), notes = coalesce($15,notes),
         consent_whatsapp = coalesce($16,consent_whatsapp), consent_email = coalesce($17,consent_email),
         consent_at = case when $18::boolean then now() else consent_at end,
         unsubscribed_at = case when coalesce($16,false) or coalesce($17,false) then null else unsubscribed_at end, updated_at = now()
       where id = $1 and company_id = $2 returning *`,
      [id, req.ctx.companyId, b.name ?? null, v.cpf !== undefined, v.cpf ?? null, v.phone !== undefined, v.phone ?? null, v.email !== undefined, v.email ?? null,
        v.birthday !== undefined, v.birthday ?? null, b.address ?? null, b.tags ?? null, b.preferences ?? null, b.notes ?? null,
        b.consent_whatsapp ?? null, b.consent_email ?? null, consentChanged])
      .catch((e) => { if (e.code === '23505') throw conflict('Já existe cliente com este CPF', 'cpf_in_use'); throw e; });
    await audit(db, req.ctx, consentChanged ? 'cliente.consentimento' : 'cliente.alterado', { entity: 'customer', entityId: id,
      data: { fields: Object.keys(b), consent_whatsapp: b.consent_whatsapp, consent_email: b.consent_email } });
    return r.rows[0];
  });
  res.json(presentCustomer(out, req.ctx));
}));

// Ajuste manual de pontos (gerência), com motivo
router.post('/:id/points', need('clientes.gerenciar', 'pdv.autorizar'), h(async (req, res) => {
  const b = parse(z.object({ points: z.number().int().refine((n) => n !== 0).refine((n) => Math.abs(n) <= 100000), reason: z.string().trim().min(3).max(200) }), req.body);
  const id = Number(req.params.id);
  const out = await tx(async (db) => {
    const c = (await db.query('select points from customers where id = $1 and company_id = $2 for update', [id, req.ctx.companyId])).rows[0];
    if (!c) throw notFound('Cliente não encontrado');
    if (c.points + b.points < 0) throw conflict('Saldo não pode ficar negativo');
    const l = await addLedger(db, req.ctx.companyId, id, { kind: 'ajuste', points: b.points, reason: b.reason, user_id: req.ctx.userId });
    await audit(db, req.ctx, 'cliente.pontos_ajustados', { entity: 'customer', entityId: id, reason: b.reason, data: { points: b.points } });
    return l;
  });
  res.status(201).json(out);
}));

// Resgate de pontos como forma de pagamento "vale" no consumo
router.post('/:id/redeem', need('pdv.receber'), h(async (req, res) => {
  const b = parse(z.object({ session_id: z.number().int(), points: z.number().int().positive(), idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/) }), req.body);
  const id = Number(req.params.id);
  const prev = await q('select * from payments where company_id = $1 and idempotency_key = $2', [req.ctx.companyId, b.idempotency_key]);
  if (prev.rows[0]) return res.json({ payment: prev.rows[0], replay: true });
  const out = await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, b.session_id);
    assertUnitScope(req.ctx, s.unit_id);
    if (!['aberta', 'em_fechamento'].includes(s.status)) throw conflict('Consumo encerrado', 'session_not_open');
    if (Number(s.customer_id) !== id) throw conflict('O consumo não está identificado com este cliente', 'customer_mismatch');
    await expirePoints(db, req.ctx.companyId, id);
    const co = (await db.query('select settings, timezone from companies where id = $1', [req.ctx.companyId])).rows[0];
    const cfg = loyaltyConfig(co.settings);
    if (!cfg.enabled) throw conflict('Programa de fidelidade desligado');
    if (b.points < cfg.min_redeem) throw bad(`Resgate mínimo de ${cfg.min_redeem} pontos`);
    const amount = b.points * cfg.point_value_cents;
    const t = await sessionTotals(db, s.id);
    if (amount > t.balance) throw bad('Valor do resgate maior que o saldo do consumo', 'over_balance');
    const u = (await db.query('select day_cutoff from units where id = $1', [s.unit_id])).rows[0];
    const p = (await db.query(
      `insert into payments (company_id, session_id, method, amount_cents, business_date, idempotency_key, user_id)
       values ($1,$2,'vale',$3,$4,$5,$6) returning *`,
      [req.ctx.companyId, s.id, amount, businessDate(new Date(), co.timezone, u.day_cutoff), b.idempotency_key, req.ctx.userId])).rows[0];
    await redeemPoints(db, req.ctx, id, b.points, p.id, s.id);
    await db.query('update consumption_sessions set version = version + 1 where id = $1', [s.id]);
    await audit(db, req.ctx, 'cliente.pontos_resgatados', { entity: 'payment', entityId: p.id, unitId: s.unit_id, data: { customer: id, points: b.points, amount_cents: amount } });
    return { payment: p, totals: await sessionTotals(db, s.id) };
  });
  res.status(201).json(out);
}));

// Identificar (ou trocar) o cliente de um consumo aberto
router.post('/attach', need('pdv.lancar'), h(async (req, res) => {
  const b = parse(z.object({ session_id: z.number().int(), customer_id: z.number().int().nullable() }), req.body);
  const out = await tx(async (db) => {
    const s = await lockSession(db, req.ctx.companyId, b.session_id);
    assertUnitScope(req.ctx, s.unit_id);
    if (!['aberta', 'em_fechamento'].includes(s.status)) throw conflict('Consumo encerrado', 'session_not_open');
    let name = null;
    if (b.customer_id) {
      const c = (await db.query('select name from customers where id = $1 and company_id = $2 and anonymized_at is null', [b.customer_id, req.ctx.companyId])).rows[0];
      if (!c) throw notFound('Cliente não encontrado');
      name = c.name;
    }
    await db.query('update consumption_sessions set customer_id = $2, customer_name = coalesce($3, customer_name), version = version + 1 where id = $1', [s.id, b.customer_id, name]);
    await audit(db, req.ctx, 'consumo.cliente', { entity: 'session', entityId: s.id, data: { customer: b.customer_id } });
    return { ok: true, customer_name: name };
  });
  res.json(out);
}));

// Exportação CSV (dados pessoais só para quem tem permissão; fórmulas neutralizadas)
router.get('/export/csv', need('clientes.gerenciar'), h(async (req, res) => {
  const rows = (await q('select * from customers where company_id = $1 and anonymized_at is null order by name', [req.ctx.companyId])).rows;
  const cols = ['nome', 'cpf', 'telefone', 'email', 'aniversario', 'etiquetas', 'pontos', 'whatsapp', 'email_ok'];
  const lines = [cols.join(';')];
  for (const r of rows) {
    const c = presentCustomer(r, req.ctx);
    lines.push([c.name, c.cpf, c.phone, c.email, c.birthday, (c.tags || []).join('|'), c.points, c.consent_whatsapp ? 'sim' : 'nao', c.consent_email ? 'sim' : 'nao'].map(csvCell).join(';'));
  }
  await audit({ query: q }, req.ctx, 'cliente.exportados', { data: { count: rows.length, full: req.ctx.can('dados.pessoais') } });
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="clientes.csv"');
  res.send(`\ufeff${lines.join('\n')}`);
}));

// Importação: prévia (dry_run) com validação e deduplicação por CPF/telefone; depois grava
router.post('/import', need('clientes.gerenciar', 'dados.pessoais'), h(async (req, res) => {
  const b = parse(z.object({ rows: z.array(z.record(z.string(), z.any())).max(2000), dry_run: z.boolean().default(true) }), req.body);
  const pick = (r, ...keys) => { for (const k of Object.keys(r)) if (keys.includes(k.toLowerCase().trim())) return String(r[k] ?? '').trim(); return ''; };
  const existing = (await q('select cpf, regexp_replace(coalesce(phone,\'\'),\'\\D\',\'\',\'g\') as phone from customers where company_id = $1', [req.ctx.companyId])).rows;
  const cpfs = new Set(existing.map((e) => e.cpf).filter(Boolean));
  const phones = new Set(existing.map((e) => e.phone).filter(Boolean));
  const report = [];
  const ok = [];
  b.rows.forEach((r, i) => {
    const name = pick(r, 'nome', 'name', 'cliente');
    const cpfRaw = pick(r, 'cpf', 'documento');
    const phone = phoneNorm(pick(r, 'telefone', 'celular', 'whatsapp', 'phone'));
    const email = pick(r, 'email', 'e-mail');
    let birthday = pick(r, 'aniversario', 'aniversário', 'nascimento', 'birthday');
    const m = birthday.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) birthday = `${m[3]}-${m[2]}-${m[1]}`;
    const line = i + 2;
    if (name.length < 2) return report.push({ line, status: 'erro', message: 'Nome ausente' });
    let cpf = null;
    if (cpfRaw) { try { cpf = normalizeCpf(cpfRaw); } catch { return report.push({ line, status: 'erro', message: 'CPF inválido' }); } }
    if (cpf && cpfs.has(cpf)) return report.push({ line, status: 'duplicado', message: 'CPF já cadastrado' });
    if (!cpf && phone && phones.has(phone)) return report.push({ line, status: 'duplicado', message: 'Telefone já cadastrado' });
    if (birthday && !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) birthday = '';
    if (cpf) cpfs.add(cpf); if (phone) phones.add(phone);
    ok.push({ name: name.slice(0, 100), cpf, phone, email: /@/.test(email) ? email.slice(0, 120) : null, birthday: birthday || null });
    report.push({ line, status: 'ok', name });
  });
  if (!b.dry_run && ok.length) {
    await tx(async (db) => {
      for (const c of ok) {
        await db.query('insert into customers (company_id, cpf, name, phone, email, birthday, created_by) values ($1,$2,$3,$4,$5,$6,$7)',
          [req.ctx.companyId, c.cpf, c.name, c.phone, c.email, c.birthday, req.ctx.userId]);
      }
      // importação não presume consentimento de marketing
      await audit(db, req.ctx, 'cliente.importados', { data: { count: ok.length } });
    });
  }
  res.json({ dry_run: b.dry_run, valid: ok.length, report: report.slice(0, 500) });
}));

// Anonimização: remove dados pessoais e preserva consumos/pagamentos que devem ser mantidos
router.post('/:id/anonymize', need('clientes.gerenciar', 'dados.pessoais'), h(async (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
  assertCan(req.ctx, 'pdv.autorizar');
  const id = Number(req.params.id);
  await tx(async (db) => {
    const r = await db.query(`update customers set name = 'Cliente anonimizado', cpf = null, phone = null, email = null, birthday = null,
        address = '{}', tags = '{}', preferences = null, notes = null, consent_whatsapp = false, consent_email = false, anonymized_at = now(), updated_at = now()
      where id = $1 and company_id = $2 and anonymized_at is null returning id`, [id, req.ctx.companyId]);
    if (!r.rows[0]) throw notFound('Cliente não encontrado');
    await db.query(`update consumption_sessions set customer_name = null where company_id = $1 and customer_id = $2`, [req.ctx.companyId, id]);
    await db.query(`update delivery_orders set customer_name = 'Anonimizado', phone = '', address = '{}' where company_id = $1 and customer_id = $2`, [req.ctx.companyId, id]);
    await audit(db, req.ctx, 'cliente.anonimizado', { entity: 'customer', entityId: id, reason: b.reason });
  });
  res.json({ ok: true });
}));
