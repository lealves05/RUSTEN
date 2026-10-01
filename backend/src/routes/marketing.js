// Marketing: campanhas segmentadas (só clientes com consentimento), modelos, descadastro, avaliações e satisfação.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, bad, notFound, conflict } from '../lib/core.js';
import { need, audit, deriveKey } from '../lib/auth.js';
import { sendWhatsApp } from '../lib/agent.js';
import { reviewToken } from '../lib/delivery.js';

export const router = Router();

export const unsubscribeToken = (customerId) => `${customerId}.${crypto.createHmac('sha256', deriveKey('unsubscribe')).update(String(customerId)).digest('base64url').slice(0, 16)}`;
export function parseUnsubscribe(token) {
  const [id] = String(token || '').split('.');
  return /^\d+$/.test(id || '') && unsubscribeToken(id) === token ? Number(id) : null;
}

const segmentSchema = z.object({
  birthday_month: z.boolean().optional(), inactive_days: z.number().int().min(1).max(3650).optional(),
  tag: z.string().trim().max(30).optional(), min_visits: z.number().int().min(1).max(1000).optional(),
}).default({});

function segmentWhere(seg, channel, params) {
  let w = `c.company_id = $1 and c.anonymized_at is null and c.unsubscribed_at is null and ${channel === 'whatsapp' ? 'c.consent_whatsapp and c.phone is not null' : 'c.consent_email and c.email is not null'}`;
  if (seg.birthday_month) w += ' and extract(month from c.birthday) = extract(month from current_date)';
  if (seg.tag) { params.push(seg.tag); w += ` and $${params.length} = any(c.tags)`; }
  if (seg.inactive_days) { params.push(seg.inactive_days); w += ` and not exists (select 1 from consumption_sessions s where s.customer_id = c.id and s.opened_at > now() - make_interval(days => $${params.length}))`; }
  if (seg.min_visits) { params.push(seg.min_visits); w += ` and (select count(*) from consumption_sessions s where s.customer_id = c.id and s.status = 'encerrada') >= $${params.length}`; }
  return w;
}

const render = (tpl, c, company) => tpl.replaceAll('{nome}', (c.name || '').split(' ')[0]).replaceAll('{empresa}', company).replaceAll('{pontos}', String(c.points ?? 0));

router.post('/segments/preview', need('marketing.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ channel: z.enum(['whatsapp', 'email']), segment: segmentSchema }), req.body);
  const params = [req.ctx.companyId];
  const w = segmentWhere(b.segment, b.channel, params);
  const n = (await q(`select count(*)::int as n from customers c where ${w}`, params)).rows[0].n;
  const total = (await q('select count(*)::int as n from customers where company_id = $1 and anonymized_at is null', [req.ctx.companyId])).rows[0].n;
  res.json({ recipients: n, without_consent: total - n });
}));

router.get('/campaigns', need('marketing.gerenciar'), h(async (req, res) => {
  res.json((await q(`select c.*, u.name as user_name,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'enviado') as sent,
      (select count(*)::int from campaign_recipients r where r.campaign_id = c.id and r.status = 'falhou') as failed
    from campaigns c left join users u on u.id = c.created_by where c.company_id = $1 order by c.id desc limit 100`, [req.ctx.companyId])).rows);
}));

router.post('/campaigns', need('marketing.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ name: z.string().trim().min(3).max(80), channel: z.enum(['whatsapp', 'email']), segment: segmentSchema,
    message: z.string().trim().min(10).max(1500) }), req.body);
  const r = await q('insert into campaigns (company_id, name, channel, segment, message, created_by) values ($1,$2,$3,$4,$5,$6) returning id',
    [req.ctx.companyId, b.name, b.channel, b.segment, b.message, req.ctx.userId]);
  res.status(201).json({ id: r.rows[0].id });
}));

// Preparar: congela a lista de destinatários (consentimento conferido no momento)
router.post('/campaigns/:id/prepare', need('marketing.gerenciar'), h(async (req, res) => {
  const out = await tx(async (db) => {
    const c = (await db.query('select * from campaigns where id = $1 and company_id = $2 for update', [Number(req.params.id), req.ctx.companyId])).rows[0];
    if (!c) throw notFound('Campanha não encontrada');
    if (c.status !== 'rascunho') throw conflict('Campanha já preparada');
    const params = [req.ctx.companyId];
    const w = segmentWhere(c.segment, c.channel, params);
    params.push(c.id);
    const r = await db.query(`insert into campaign_recipients (company_id, campaign_id, customer_id) select $1, $${params.length}, c.id from customers c where ${w}`, params);
    await db.query("update campaigns set status = 'preparada', recipients = $2, prepared_at = now() where id = $1", [c.id, r.rowCount]);
    await audit(db, req.ctx, 'marketing.campanha_preparada', { entity: 'campaign', entityId: c.id, data: { recipients: r.rowCount } });
    return { recipients: r.rowCount };
  });
  res.json(out);
}));

// Destinatários com a mensagem personalizada e link de descadastro (para envio manual ou conferência)
router.get('/campaigns/:id/recipients', need('marketing.gerenciar', 'dados.pessoais'), h(async (req, res) => {
  const c = (await q('select c.*, co.name as company from campaigns c join companies co on co.id = c.company_id where c.id = $1 and c.company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!c) throw notFound();
  const rows = (await q(`select r.id, r.status, r.sent_at, r.error, cu.id as customer_id, cu.name, cu.phone, cu.email, cu.points, cu.unsubscribed_at
    from campaign_recipients r join customers cu on cu.id = r.customer_id where r.campaign_id = $1 order by cu.name limit 2000`, [c.id])).rows;
  res.json(rows.map((r) => ({ ...r, message: `${render(c.message, r, c.company)}\n\nPara não receber mais: ${req.query.base || ''}/sair/${unsubscribeToken(r.customer_id)}` })));
}));

router.post('/campaigns/:id/recipients/:rid/sent', need('marketing.gerenciar'), h(async (req, res) => {
  const r = await q(`update campaign_recipients set status = 'enviado', sent_at = now() where id = $1 and campaign_id = $2 and company_id = $3 and status in ('pendente','falhou') returning id`,
    [Number(req.params.rid), Number(req.params.id), req.ctx.companyId]);
  res.json({ ok: !!r.rows[0] });
}));

// Envio pela API oficial do WhatsApp (se configurada). Mensagens marketing fora da janela exigem modelo aprovado pela Meta:
// falhas ficam registradas por destinatário.
router.post('/campaigns/:id/send', need('marketing.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ base_url: z.string().url().max(200) }), req.body);
  const c = (await q('select c.*, co.name as company from campaigns c join companies co on co.id = c.company_id where c.id = $1 and c.company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!c) throw notFound();
  if (c.channel !== 'whatsapp') throw bad('Envio automático disponível só para WhatsApp; para e-mail, exporte a lista');
  if (c.status !== 'preparada') throw conflict('Prepare a campanha antes de enviar');
  const rows = (await q(`select r.id, cu.id as customer_id, cu.name, cu.phone, cu.points from campaign_recipients r join customers cu on cu.id = r.customer_id
    where r.campaign_id = $1 and r.status in ('pendente','falhou') and cu.unsubscribed_at is null and cu.consent_whatsapp limit 300`, [c.id])).rows;
  let sent = 0; let failed = 0;
  for (const r of rows) {
    const s = await sendWhatsApp(req.ctx.companyId, r.phone, `${render(c.message, r, c.company)}\n\nPara não receber mais: ${b.base_url}/sair/${unsubscribeToken(r.customer_id)}`);
    await q('update campaign_recipients set status = $2, sent_at = case when $2 = \'enviado\' then now() end, error = $3 where id = $1', [r.id, s.ok ? 'enviado' : 'falhou', s.error || null]);
    if (s.ok) sent++; else failed++;
    if (!s.ok && /não configurada/.test(s.error)) break;
  }
  if (sent && !failed) await q("update campaigns set status = 'enviada' where id = $1", [c.id]);
  await audit({ query: q }, req.ctx, 'marketing.campanha_enviada', { entity: 'campaign', entityId: c.id, data: { sent, failed } });
  res.json({ sent, failed });
}));

router.post('/campaigns/:id/cancel', need('marketing.gerenciar'), h(async (req, res) => {
  const r = await q("update campaigns set status = 'cancelada' where id = $1 and company_id = $2 and status in ('rascunho','preparada') returning id", [Number(req.params.id), req.ctx.companyId]);
  if (!r.rows[0]) throw conflict('Campanha não pode ser cancelada');
  res.json({ ok: true });
}));

// ---- Avaliações ----
router.get('/reviews', need('marketing.gerenciar'), h(async (req, res) => {
  const days = Math.min(365, Number(req.query.days) || 30);
  const stats = (await q(`select count(*)::int as total, round(avg(score)::numeric, 2)::float as average,
      count(*) filter (where score >= 4)::int as positive, count(*) filter (where score <= 2)::int as negative,
      count(*) filter (where score <= 2 and handled_at is null)::int as pending
    from reviews where company_id = $1 and created_at > now() - make_interval(days => $2)`, [req.ctx.companyId, days])).rows[0];
  const dist = (await q(`select score, count(*)::int as n from reviews where company_id = $1 and created_at > now() - make_interval(days => $2) group by score order by score`, [req.ctx.companyId, days])).rows;
  const items = (await q(`select r.id, r.score, r.comment, r.created_at, r.handled_at, r.session_id, cu.name as customer_name, cu.id as customer_id, u.name as handled_name
    from reviews r left join customers cu on cu.id = r.customer_id left join users u on u.id = r.handled_by
    where r.company_id = $1 and r.created_at > now() - make_interval(days => $2) order by (r.score <= 2 and r.handled_at is null) desc, r.id desc limit 200`, [req.ctx.companyId, days])).rows;
  res.json({ stats, distribution: dist, items });
}));

router.post('/reviews/:id/handled', need('marketing.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ note: z.string().trim().min(3).max(300) }), req.body);
  const r = await q('update reviews set handled_at = now(), handled_by = $3 where id = $1 and company_id = $2 and handled_at is null returning id', [Number(req.params.id), req.ctx.companyId, req.ctx.userId]);
  if (!r.rows[0]) throw conflict('Avaliação já tratada');
  await audit({ query: q }, req.ctx, 'marketing.avaliacao_tratada', { entity: 'review', entityId: r.rows[0].id, reason: b.note });
  res.json({ ok: true });
}));

// Link de avaliação de um consumo encerrado (mostrado no recibo/QR)
router.get('/review-link/:sessionId', need('pdv.lancar'), h(async (req, res) => {
  const s = (await q("select id from consumption_sessions where id = $1 and company_id = $2 and status = 'encerrada'", [Number(req.params.sessionId), req.ctx.companyId])).rows[0];
  if (!s) throw notFound('Consumo encerrado não encontrado');
  const c = (await q('select slug from companies where id = $1', [req.ctx.companyId])).rows[0];
  res.json({ token: reviewToken(s.id), path: `/avaliar/${reviewToken(s.id)}`, slug: c.slug });
}));
