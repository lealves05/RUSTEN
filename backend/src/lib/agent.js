// Agente de atendimento (WhatsApp): regras determinísticas — cardápio, preços, horário, pedido com resumo e confirmação,
// status de pedido (identidade pelo número do WhatsApp), reservas e encaminhamento à equipe.
// O simulador usa o mesmo motor, mas nunca cria pedidos ou reservas reais.
import { q, tx, randomToken } from './core.js';
import { deliveryConfig, createDeliveryOrder, priceCart, STATUS_LABEL } from './delivery.js';
import { onlyDigits } from './customers.js';

export const agentConfig = (settings) => ({
  enabled: false, name: 'Atendente virtual',
  greeting: 'Olá! Sou o atendimento virtual. Posso mostrar o *cardápio*, informar *horário*, montar seu *pedido*, ver o *status* do pedido ou fazer uma *reserva*. Para falar com a equipe, digite *atendente*.',
  handoff_message: 'Certo! Vou chamar alguém da equipe para continuar com você. Aguarde um instante.',
  closed_message: 'No momento não estamos recebendo pedidos. Veja nossos horários digitando *horário*.',
  reservation_max_people: 12, reservation_min_hours: 2,
  ...(settings?.agent || {}),
});

// Horário local do estabelecimento → instante UTC (respeita o fuso configurado da empresa)
function zonedToUtc(local, tz) {
  const guess = new Date(`${local}Z`);
  if (Number.isNaN(guess.getTime())) return guess;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess).map((x) => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const brl = (c) => `R$ ${(Number(c) / 100).toFixed(2).replace('.', ',')}`;
const has = (t, ...words) => words.some((w) => new RegExp(`(^|\\W)${w}(\\W|$)`).test(t));

async function menuProducts(companyId) {
  return (await q(`select p.id, p.name, p.price_cents, c.name as category, p.kind,
      exists(select 1 from modifier_groups g where g.product_id = p.id and g.min_select > 0) as required_opts
    from products p left join categories c on c.id = p.category_id
    where p.company_id = $1 and p.active and p.kind <> 'weight' and (('delivery' = any(p.channels)) or ('cardapio_digital' = any(p.channels)) or ('pdv' = any(p.channels)))
    order by c.sort nulls last, c.name, p.name limit 200`, [companyId])).rows;
}

const STOP = new Set(['quanto', 'custa', 'valor', 'preco', 'qual', 'quero', 'uma', 'umas', 'uns', 'com', 'sem', 'por', 'favor', 'tem', 'voces', 'pra', 'para', 'mais', 'esta', 'esse', 'essa']);

function findProduct(products, text) {
  const t = norm(text);
  let best = null; let score = 0;
  for (const p of products) {
    const n = norm(p.name);
    if (t.includes(n)) return p;
    const words = n.split(/\s+/).filter((w) => w.length > 2);
    const qwords = t.split(/\W+/).filter((w) => w.length > 2 && !STOP.has(w));
    const hit = words.filter((w) => t.includes(w)).length;
    const qhit = qwords.filter((w) => words.some((x) => x.startsWith(w) || w.startsWith(x))).length;
    const s = hit ? Math.max(words.length ? hit / words.length : 0, qwords.length ? qhit / qwords.length : 0) : 0;
    if (s > score) { score = s; best = p; }
  }
  return score >= 0.5 ? best : null;
}

function parseQtyLine(products, line) {
  const t = norm(line);
  const m = t.match(/^(\d{1,2})\s*(x\s*)?(.+)$/);
  const qty = m ? Number(m[1]) : 1;
  const p = findProduct(products, m ? m[3] : t);
  return p ? { p, qty: Math.min(Math.max(qty, 1), 50) } : null;
}

const summary = (cart, products) => cart.map((c) => { const p = products.find((x) => x.id === c.product_id); return `${c.qty}× ${p?.name} — ${brl((p?.price_cents || 0) * c.qty)}`; }).join('\n');

/* Processa uma mensagem do cliente. Devolve { replies: [texto], state, handoff }. */
export async function agentReply(company, conv, text, { simulated }) {
  const cfg = agentConfig(company.settings);
  const dcfg = deliveryConfig(company.settings);
  const st = { ...(conv.state || {}) };
  const t = norm(text);
  const out = [];
  const products = await menuProducts(company.id);

  if (has(t, 'atendente', 'humano', 'pessoa', 'gerente', 'reclamacao', 'reclamar', 'problema', 'desconto', 'cobranca', 'estorno', 'reembolso')) {
    return { replies: [cfg.handoff_message], state: { step: null }, handoff: true };
  }
  if (has(t, 'cancelar', 'cancela', 'sair', 'recomecar') && st.step && !has(t, 'reserva')) {
    return { replies: ['Tudo bem, cancelei o que estávamos montando. Posso ajudar em algo mais?'], state: { step: null } };
  }

  // Fluxos em andamento ------------------------------------------------------------------------
  if (st.step === 'pedido') {
    if (has(t, 'finalizar', 'fechar', 'pronto', 'so isso', 'e isso', 'acabou')) {
      if (!st.cart?.length) return { replies: ['Seu pedido ainda está vazio. Envie, por exemplo: *2 pilsen*.'], state: st };
      const modes = [dcfg.delivery && '*entrega*', dcfg.pickup && '*retirada*'].filter(Boolean).join(' ou ');
      return { replies: [`Seu pedido:\n${summary(st.cart, products)}\n\nVai ser ${modes}?`], state: { ...st, step: 'modo' } };
    }
    const added = [];
    for (const line of String(text).split(/\n|,| e (?=\d)/)) {
      if (!line.trim()) continue;
      const r = parseQtyLine(products, line);
      if (!r) continue;
      if (r.p.required_opts) { out.push(`*${r.p.name}* tem opções para escolher — peça esse item pelo cardápio digital${company.slug ? `: /c/${company.slug}` : ''}.`); continue; }
      st.cart = [...(st.cart || []), { product_id: r.p.id, qty: r.qty }];
      added.push(`${r.qty}× ${r.p.name}`);
    }
    if (added.length) out.push(`Anotado: ${added.join(', ')}. Algo mais? Quando terminar, digite *finalizar*.`);
    else if (!out.length) out.push('Não encontrei esse item no cardápio. Digite *cardápio* para ver as opções ou envie como *2 pilsen*.');
    return { replies: out, state: st };
  }
  if (st.step === 'modo') {
    if (has(t, 'entrega', 'entregar', 'delivery') && dcfg.delivery) return { replies: ['Qual o endereço? Envie *rua, número e bairro*.'], state: { ...st, step: 'endereco', mode: 'entrega' } };
    if (has(t, 'retirada', 'retirar', 'buscar', 'balcao') && dcfg.pickup) return { replies: ['Em nome de quem fica o pedido?'], state: { ...st, step: 'nome', mode: 'retirada' } };
    return { replies: ['Responda *entrega* ou *retirada*.'], state: st };
  }
  if (st.step === 'endereco') {
    const parts = String(text).split(',').map((s) => s.trim());
    if (parts.length < 2 || !/\d/.test(parts[1])) return { replies: ['Preciso de rua e número, separados por vírgula. Ex.: *Rua das Flores, 120, Centro*.'], state: st };
    return { replies: ['Em nome de quem fica o pedido?'], state: { ...st, step: 'nome', address: { street: parts[0], number: parts[1], district: parts[2] || '' } } };
  }
  if (st.step === 'nome') {
    const name = String(text).trim().slice(0, 60);
    if (name.length < 2) return { replies: ['Qual o nome?'], state: st };
    const { subtotal } = await priceCart({ query: q }, company.id, st.cart).catch(() => ({ subtotal: 0 }));
    const fee = st.mode === 'entrega' ? dcfg.fee_cents : 0;
    return { replies: [`Confira:\n${summary(st.cart, products)}\n${fee ? `Taxa de entrega: ${brl(fee)}\n` : ''}*Total: ${brl(subtotal + fee)}*\n${st.mode === 'entrega' ? `Entrega em: ${st.address.street}, ${st.address.number}` : 'Retirada no balcão'} · Nome: ${name}\nPagamento na ${st.mode === 'entrega' ? 'entrega' : 'retirada'}.\n\nResponda *confirmar* para enviar ou *cancelar*.`],
      state: { ...st, step: 'confirmar', name } };
  }
  if (st.step === 'confirmar') {
    if (!has(t, 'confirmar', 'confirmo', 'sim', 'pode', 'ok')) return { replies: ['Responda *confirmar* para enviar o pedido ou *cancelar*.'], state: st };
    if (simulated) return { replies: ['✅ (Simulação) Pedido montado corretamente. Nada foi enviado à cozinha nem registrado nas vendas.'], state: { step: null } };
    try {
      const o = await tx((db) => createDeliveryOrder(db, company.id, { channel: 'whatsapp', mode: st.mode, customer_name: st.name, phone: conv.contact,
        address: st.address, cart: st.cart, client_key: `wa${conv.id}x${randomToken(6)}` }, null));
      return { replies: [`✅ Pedido *#${o.number}* recebido! Total ${brl(o.total)}. Avisaremos quando for confirmado. Para acompanhar, digite *status*.`], state: { step: null } };
    } catch (e) {
      return { replies: [`Não consegui registrar o pedido: ${e.message}`], state: { step: null } };
    }
  }
  if (st.step === 'reserva') {
    const d = String(text).match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\D+(\d{1,2})(?:[:h](\d{2}))?\D+(\d{1,3})/i);
    if (!d) return { replies: ['Envie *dia/mês, horário e pessoas*. Ex.: *25/10 20:30 4 pessoas*.'], state: st };
    const year = d[3] ? (d[3].length === 2 ? 2000 + Number(d[3]) : Number(d[3])) : new Date().getFullYear();
    const tz = company.timezone || 'America/Sao_Paulo';
    const local = `${year}-${String(d[2]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}T${String(d[4]).padStart(2, '0')}:${d[5] || '00'}:00`;
    const when = zonedToUtc(local, tz);
    const people = Number(d[6]);
    if (Number.isNaN(when.getTime())) return { replies: ['Data inválida. Ex.: *25/10 20:30 4 pessoas*.'], state: st };
    if (when.getTime() < Date.now() + cfg.reservation_min_hours * 3600000) return { replies: [`Reservas precisam de pelo menos ${cfg.reservation_min_hours}h de antecedência.`], state: st };
    if (people < 1 || people > cfg.reservation_max_people) return { replies: [`Para grupos acima de ${cfg.reservation_max_people} pessoas, a equipe vai te atender.`], state: { step: null }, handoff: true };
    if (simulated) return { replies: [`✅ (Simulação) Reserva para ${people} pessoa(s) em ${d[1]}/${d[2]} às ${d[4]}:${d[5] || '00'} — nada foi gravado.`], state: { step: null } };
    const u = (await q('select id from units where company_id = $1 and active order by id limit 1', [company.id])).rows[0];
    await q(`insert into reservations (company_id, unit_id, customer_name, phone, people, starts_at, status, source) values ($1,$2,$3,$4,$5,$6,'pendente','agente')`,
      [company.id, u.id, conv.contact_name || 'Cliente WhatsApp', conv.contact, people, when]);
    return { replies: [`Pedido de reserva para *${people}* pessoa(s) em *${d[1]}/${d[2]} às ${d[4]}:${d[5] || '00'}* registrado. A equipe confirma em breve.`], state: { step: null } };
  }

  // Intenções -----------------------------------------------------------------------------------
  if (has(t, 'oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'menu inicial', 'ajuda', 'opcoes') && t.length < 30) return { replies: [cfg.greeting], state: { step: null } };
  if (has(t, 'horario', 'horarios', 'funciona', 'funcionamento', 'aberto', 'abre', 'fecha')) {
    return { replies: [`${dcfg.hours ? `Nosso horário: ${dcfg.hours}` : 'Consulte nosso horário com a equipe.'}${dcfg.enabled ? (dcfg.accepting ? '\nEstamos recebendo pedidos agora.' : '\nNo momento não estamos recebendo pedidos.') : ''}`], state: st };
  }
  if (has(t, 'cardapio', 'menu', 'opcoes de', 'o que tem', 'tem o que')) {
    const byCat = {};
    for (const p of products) (byCat[p.category || 'Outros'] ||= []).push(`• ${p.name} — ${brl(p.price_cents)}`);
    const body = Object.entries(byCat).map(([c, l]) => `*${c}*\n${l.slice(0, 12).join('\n')}`).join('\n\n').slice(0, 3500);
    return { replies: [body || 'Cardápio indisponível no momento.', 'Para pedir, digite *pedido*.'], state: st };
  }
  if (has(t, 'status', 'meu pedido', 'cade', 'acompanhar', 'demora')) {
    // identidade: só pedidos feitos com o mesmo número de WhatsApp
    const o = (await q(`select number, status, mode, eta_minutes, created_at from delivery_orders where company_id = $1 and phone = $2 order by id desc limit 1`,
      [company.id, onlyDigits(conv.contact)])).rows[0];
    if (!o) return { replies: ['Não encontrei pedidos feitos por este número. Se pediu por outro número, fale com um *atendente*.'], state: st };
    return { replies: [`Pedido *#${o.number}*: *${STATUS_LABEL[o.status]}*${['recebido', 'confirmado', 'em_preparo'].includes(o.status) && o.eta_minutes ? ` · previsão de ${o.eta_minutes} min` : ''}.`], state: st };
  }
  if (has(t, 'reserva', 'reservar', 'mesa para')) {
    if (has(t, 'cancelar', 'cancela', 'desmarcar')) {
      if (simulated) return { replies: ['✅ (Simulação) Reserva cancelada — nada foi alterado.'], state: { step: null } };
      const r = (await q(`update reservations set status = 'cancelada' where id = (select id from reservations where company_id = $1 and phone = $2
          and status in ('pendente','confirmada') and starts_at > now() order by starts_at limit 1) returning starts_at`, [company.id, onlyDigits(conv.contact)])).rows[0];
      return { replies: [r ? 'Sua próxima reserva foi cancelada.' : 'Não encontrei reserva futura neste número.'], state: { step: null } };
    }
    if (has(t, 'remarcar', 'mudar', 'alterar')) return { replies: ['Para remarcar, cancele a atual (*cancelar reserva*) e faça uma nova (*reserva*). Se preferir, chame um *atendente*.'], state: st };
    return { replies: ['Vamos reservar! Envie *dia/mês, horário e número de pessoas*. Ex.: *25/10 20:30 4 pessoas*.'], state: { step: 'reserva' } };
  }
  if (has(t, 'pedido', 'pedir', 'quero', 'encomendar', 'delivery', 'entrega')) {
    if (!dcfg.enabled || !dcfg.accepting) return { replies: [cfg.closed_message], state: st };
    const first = parseQtyLine(products, t.replace(/\b(quero|pedir|pedido|fazer|um|uma)\b/g, ' ').trim());
    const cart = first && !first.p.required_opts ? [{ product_id: first.p.id, qty: first.qty }] : [];
    return { replies: [`${cart.length ? `Anotado: ${cart[0].qty}× ${first.p.name}. ` : ''}Me diga os itens, um por linha, com a quantidade. Ex.:\n*2 pilsen*\n*1 batata frita*\nQuando terminar, digite *finalizar*.`], state: { step: 'pedido', cart } };
  }
  if (has(t, 'preco', 'quanto', 'valor', 'custa')) {
    const p = findProduct(products, t);
    return { replies: [p ? `*${p.name}*: ${brl(p.price_cents)}.` : 'De qual item? Digite *cardápio* para ver todos os preços.'], state: st };
  }
  const p = findProduct(products, t);
  if (p) return { replies: [`*${p.name}*: ${brl(p.price_cents)}. Para pedir, digite *pedido*.`], state: st };
  const misses = (st.misses || 0) + 1;
  if (misses >= 3) return { replies: [cfg.handoff_message], state: { step: null }, handoff: true };
  return { replies: [`Não entendi. ${cfg.greeting}`], state: { ...st, misses } };
}

/* Envio pela API oficial do WhatsApp Cloud. Sem credenciais, registra a falha — nunca finge que enviou. */
export async function sendWhatsApp(companyId, to, body) {
  const s = Object.fromEntries((await q("select key, value from company_secrets where company_id = $1 and key in ('wa_token','wa_phone_number_id')", [companyId])).rows.map((r) => [r.key, r.value]));
  if (!s.wa_token || !s.wa_phone_number_id) return { ok: false, error: 'Integração do WhatsApp não configurada' };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${encodeURIComponent(s.wa_phone_number_id)}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${s.wa_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: onlyDigits(to), type: 'text', text: { body: body.slice(0, 4000) } }),
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j?.error?.message?.slice(0, 200) || `HTTP ${r.status}` };
    return { ok: true, id: j?.messages?.[0]?.id };
  } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
}

export async function storeMessage(db, companyId, convId, m) {
  const r = await db.query(`insert into conversation_messages (company_id, conversation_id, direction, author, body, external_id, delivery_status, error, user_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing returning id`,
  [companyId, convId, m.direction, m.author, m.body, m.external_id ?? null, m.delivery_status || 'ok', m.error ?? null, m.user_id ?? null]);
  await db.query('update conversations set last_message_at = now() where id = $1', [convId]);
  return r.rows[0]?.id || null;
}

/* Entrada de mensagem (webhook ou simulador): grava, responde se o agente estiver no controle, envia e registra falhas. */
export async function handleIncoming(company, { channel, contact, contactName, body, externalId }) {
  const simulated = channel === 'simulador';
  const conv = (await q(`insert into conversations (company_id, channel, contact, contact_name) values ($1,$2,$3,$4)
    on conflict (company_id, channel, contact) do update set contact_name = coalesce(excluded.contact_name, conversations.contact_name) returning *`,
  [company.id, channel, contact, contactName ?? null])).rows[0];
  const inId = await storeMessage({ query: q }, company.id, conv.id, { direction: 'in', author: 'cliente', body: String(body).slice(0, 4000), external_id: externalId });
  if (!inId) return { duplicate: true, conversation_id: conv.id, replies: [] }; // webhook reentregue
  const cfg = agentConfig(company.settings);
  if (conv.mode !== 'agente' || (!cfg.enabled && !simulated)) return { conversation_id: conv.id, replies: [], mode: conv.mode };
  const r = await agentReply(company, conv, body, { simulated });
  await q('update conversations set state = $2, needs_human = needs_human or $3, mode = case when $3 then \'humano\' else mode end where id = $1',
    [conv.id, JSON.stringify(r.state || {}), !!r.handoff]);
  for (const text of r.replies) {
    let status = simulated ? 'simulado' : 'pendente'; let error = null; let ext = null;
    if (!simulated) {
      const s = await sendWhatsApp(company.id, contact, text);
      status = s.ok ? 'ok' : 'falhou'; error = s.error || null; ext = s.id || null;
    }
    await storeMessage({ query: q }, company.id, conv.id, { direction: 'out', author: 'agente', body: text, external_id: ext, delivery_status: status, error });
  }
  return { conversation_id: conv.id, replies: r.replies, handoff: !!r.handoff };
}
