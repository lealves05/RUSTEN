// Agente WhatsApp (área interna): configuração, credenciais protegidas, caixa de entrada, assumir/pausar/devolver, simulador.
import { Router } from 'express';
import { z } from 'zod';
import { q, tx, h, parse, notFound, conflict, randomToken } from '../lib/core.js';
import { need, audit } from '../lib/auth.js';
import { agentConfig, handleIncoming, sendWhatsApp, storeMessage } from '../lib/agent.js';

export const router = Router();
const SECRET_KEYS = ['wa_token', 'wa_phone_number_id', 'wa_app_secret', 'wa_verify_token'];

router.get('/settings', need('agente.gerenciar'), h(async (req, res) => {
  const c = (await q('select slug, settings from companies where id = $1', [req.ctx.companyId])).rows[0];
  const secrets = (await q('select key, updated_at from company_secrets where company_id = $1 and key = any($2)', [req.ctx.companyId, SECRET_KEYS])).rows;
  const fails = (await q(`select m.created_at, m.error from conversation_messages m where m.company_id = $1 and m.delivery_status = 'falhou' order by m.id desc limit 10`, [req.ctx.companyId])).rows;
  // credenciais nunca voltam ao navegador: só se estão definidas
  res.json({ ...agentConfig(c.settings), slug: c.slug, secrets: Object.fromEntries(SECRET_KEYS.map((k) => [k, !!secrets.find((s) => s.key === k)])),
    webhook_path: c.slug ? `/api/public/whatsapp/${c.slug}` : null, failures: fails });
}));

router.put('/settings', need('agente.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({
    enabled: z.boolean(), name: z.string().trim().min(2).max(40), greeting: z.string().trim().min(5).max(600),
    handoff_message: z.string().trim().min(5).max(300), closed_message: z.string().trim().min(5).max(300),
    reservation_max_people: z.number().int().min(1).max(100), reservation_min_hours: z.number().int().min(0).max(72),
  }), req.body);
  await q(`update companies set settings = jsonb_set(settings, '{agent}', $2::jsonb) where id = $1`, [req.ctx.companyId, JSON.stringify(b)]);
  await audit({ query: q }, req.ctx, 'agente.configuracao', { data: { enabled: b.enabled } });
  res.json({ ok: true });
}));

// Credenciais da API oficial (Meta WhatsApp Cloud). Valor vazio remove.
router.put('/secrets', need('agente.gerenciar', 'configuracoes.gerenciar'), h(async (req, res) => {
  const b = parse(z.object(Object.fromEntries(SECRET_KEYS.map((k) => [k, z.string().trim().max(600).optional()]))), req.body);
  await tx(async (db) => {
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      if (!v) await db.query('delete from company_secrets where company_id = $1 and key = $2', [req.ctx.companyId, k]);
      else await db.query(`insert into company_secrets (company_id, key, value) values ($1,$2,$3)
        on conflict (company_id, key) do update set value = excluded.value, updated_at = now()`, [req.ctx.companyId, k, v]);
    }
    await audit(db, req.ctx, 'agente.credenciais', { data: { keys: Object.keys(b).filter((k) => b[k] !== undefined) } });
  });
  res.json({ ok: true });
}));

router.get('/conversations', need('agente.atender'), h(async (req, res) => {
  const channel = req.query.channel === 'simulador' ? 'simulador' : 'whatsapp';
  res.json((await q(`select c.id, c.channel, c.contact, c.contact_name, c.mode, c.needs_human, c.last_message_at, u.name as assigned_name,
      (select body from conversation_messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_body,
      (select count(*)::int from conversation_messages m where m.conversation_id = c.id and m.delivery_status = 'falhou') as failures
    from conversations c left join users u on u.id = c.assigned_to where c.company_id = $1 and c.channel = $2
    order by c.needs_human desc, c.last_message_at desc limit 100`, [req.ctx.companyId, channel])).rows);
}));

router.get('/conversations/:id', need('agente.atender'), h(async (req, res) => {
  const c = (await q('select * from conversations where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!c) throw notFound('Conversa não encontrada');
  const msgs = (await q(`select m.id, m.direction, m.author, m.body, m.delivery_status, m.error, m.created_at, u.name as user_name
    from conversation_messages m left join users u on u.id = m.user_id where m.conversation_id = $1 order by m.id desc limit 200`, [c.id])).rows.reverse();
  res.json({ conversation: c, messages: msgs });
}));

// Assumir (humano), pausar (ninguém responde automaticamente) ou devolver ao agente
router.post('/conversations/:id/mode', need('agente.atender'), h(async (req, res) => {
  const b = parse(z.object({ mode: z.enum(['agente', 'humano', 'pausado']) }), req.body);
  const r = await q(`update conversations set mode = $3, assigned_to = case when $3 = 'humano' then $4 else null end,
      needs_human = case when $3 = 'agente' then false else needs_human end, state = case when $3 = 'agente' then '{}'::jsonb else state end
    where id = $1 and company_id = $2 returning id`, [Number(req.params.id), req.ctx.companyId, b.mode, req.ctx.userId]);
  if (!r.rows[0]) throw notFound();
  await storeMessage({ query: q }, req.ctx.companyId, r.rows[0].id, { direction: 'out', author: 'sistema', delivery_status: 'simulado',
    body: { agente: 'Conversa devolvida ao agente', humano: `${req.ctx.name} assumiu a conversa`, pausado: 'Agente pausado nesta conversa' }[b.mode], user_id: req.ctx.userId });
  res.json({ ok: true });
}));

// Resposta da equipe (só com a conversa assumida, para o agente não responder por cima)
router.post('/conversations/:id/reply', need('agente.atender'), h(async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body);
  const c = (await q('select * from conversations where id = $1 and company_id = $2', [Number(req.params.id), req.ctx.companyId])).rows[0];
  if (!c) throw notFound();
  if (c.mode === 'agente') throw conflict('Assuma a conversa antes de responder', 'not_assumed');
  let status = 'simulado'; let error = null; let ext = null;
  if (c.channel === 'whatsapp') { const s = await sendWhatsApp(req.ctx.companyId, c.contact, b.body); status = s.ok ? 'ok' : 'falhou'; error = s.error || null; ext = s.id || null; }
  await storeMessage({ query: q }, req.ctx.companyId, c.id, { direction: 'out', author: 'equipe', body: b.body, external_id: ext, delivery_status: status, error, user_id: req.ctx.userId });
  res.status(201).json({ ok: status !== 'falhou', status, error });
}));

// Simulador isolado: mesmo motor, sem pedidos/reservas reais e sem envio ao WhatsApp
router.post('/simulate', need('agente.gerenciar'), h(async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(1000), contact: z.string().trim().max(20).optional(), reset: z.boolean().optional() }), req.body);
  const company = (await q('select id, name, slug, timezone, settings from companies where id = $1', [req.ctx.companyId])).rows[0];
  const contact = `sim-${b.contact || req.ctx.userId}`;
  if (b.reset) await q("delete from conversations where company_id = $1 and channel = 'simulador' and contact = $2", [req.ctx.companyId, contact]);
  const r = await handleIncoming(company, { channel: 'simulador', contact, contactName: 'Simulação', body: b.body, externalId: `sim-${randomToken(8)}` });
  res.json(r);
}));
