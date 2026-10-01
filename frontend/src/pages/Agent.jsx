// Agente WhatsApp: caixa de entrada (assumir, pausar, responder, devolver), simulador isolado e configuração.
import { useEffect, useRef, useState } from 'react';
import { Bot, Hand, KeyRound, MessageCircle, Pause, Play, RotateCcw, Send, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { time, dateTime } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, PageHeader, Toggle, useLoad, useToast } from '../components/ui.jsx';

const TABS = [['inbox', 'Caixa de entrada'], ['simulador', 'Simulador'], ['config', 'Configuração']];
const MODE = { agente: ['info', 'Agente', Bot], humano: ['warn', 'Equipe', UserRound], pausado: ['muted', 'Pausado', Pause] };

export default function Agent() {
  const s = useSession();
  const [tab, setTab] = useState(s.can('agente.atender') ? 'inbox' : 'simulador');
  const cfg = useLoad(() => (s.can('agente.gerenciar') ? api('/api/agent/settings') : Promise.resolve(null)), []);
  return (
    <div>
      <PageHeader title="Agente" subtitle="Atendimento por WhatsApp: cardápio, preços, horário, pedidos com confirmação, status e reservas. Exceções vão para a equipe." />
      {cfg.data && !cfg.data.enabled && <div className="mb-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">O agente está <b>desligado</b> para clientes reais. Teste no simulador e ligue em Configuração.</div>}
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {TABS.filter(([k]) => k === 'inbox' ? s.can('agente.atender') : s.can('agente.gerenciar')).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`border-b-2 px-4 py-2 text-sm font-semibold uppercase tracking-wide ${tab === k ? 'border-copper text-copper' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>)}
      </div>
      {tab === 'inbox' && <Inbox />}
      {tab === 'simulador' && <Simulator />}
      {tab === 'config' && cfg.data && <Config data={cfg.data} reload={cfg.reload} />}
    </div>
  );
}

function Bubble({ m, tz }) {
  const out = m.direction === 'out';
  if (m.author === 'sistema') return <div className="my-2 text-center text-xs text-muted">— {m.body} · {time(m.created_at, tz)} —</div>;
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`my-1 max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm shadow-sm ${out ? (m.author === 'equipe' ? 'bg-copper/25' : 'bg-copper/10') : 'bg-surface border border-line'}`}>
        {m.body.split(/(\*[^*]+\*)/).map((part, i) => (part.startsWith('*') && part.endsWith('*') ? <b key={i}>{part.slice(1, -1)}</b> : part))}
        <div className="mt-0.5 text-right text-[10px] text-muted">{out && (m.author === 'equipe' ? m.user_name || 'equipe' : 'agente')} · {time(m.created_at, tz)}
          {m.delivery_status === 'falhou' && <span className="text-rust" title={m.error}> · não enviada</span>}</div>
      </div>
    </div>
  );
}

function Inbox() {
  const s = useSession();
  const toast = useToast();
  const list = useLoad(() => api('/api/agent/conversations'), []);
  const [open, setOpen] = useState(null);
  const [conv, setConv] = useState(null);
  const [text, setText] = useState('');
  const end = useRef(null);
  const load = async (id = open) => { if (!id) return; try { setConv(await api(`/api/agent/conversations/${id}`)); } catch (e) { toast(e.message, 'bad'); } };
  useEffect(() => { load(); const t = setInterval(() => { load(); list.reload(); }, 8000); return () => clearInterval(t); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [conv?.messages?.length]);
  const mode = async (m) => { await api(`/api/agent/conversations/${open}/mode`, { method: 'POST', body: { mode: m } }).catch((e) => toast(e.message, 'bad')); load(); list.reload(); };
  const reply = async () => {
    if (!text.trim()) return;
    try { const r = await api(`/api/agent/conversations/${open}/reply`, { method: 'POST', body: { body: text } }); if (!r.ok) toast(`Não enviada: ${r.error}`, 'warn'); setText(''); load(); } catch (e) { toast(e.message, 'bad'); }
  };
  if (list.loading && !list.data) return <Loading />;
  if (!list.data?.length) return <Empty icon={MessageCircle} title="Nenhuma conversa">Quando a integração oficial do WhatsApp estiver configurada, as conversas dos clientes aparecem aqui.</Empty>;
  const c = conv?.conversation;
  return (
    <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
      <ul className="card max-h-[70vh] divide-y divide-line overflow-y-auto">{list.data.map((x) => { const [tone, label] = MODE[x.mode]; return (
        <li key={x.id}><button className={`w-full p-3 text-left hover:bg-raised ${open === x.id ? 'bg-raised' : ''}`} onClick={() => { setOpen(x.id); load(x.id); }}>
          <div className="flex items-center justify-between gap-2"><b className="truncate">{x.contact_name || x.contact}</b><span className="text-[10px] text-muted">{time(x.last_message_at, s.tz)}</span></div>
          <div className="truncate text-xs text-muted">{x.last_body}</div>
          <div className="mt-1 flex gap-1">{x.needs_human && <Badge tone="bad">precisa da equipe</Badge>}<Badge tone={tone}>{label}{x.assigned_name ? `: ${x.assigned_name}` : ''}</Badge>{x.failures > 0 && <Badge tone="warn">{x.failures} falha(s)</Badge>}</div>
        </button></li>); })}</ul>
      <div className="card flex min-h-[60vh] flex-col">
        {!c ? <div className="m-auto text-sm text-muted">Escolha uma conversa.</div> : <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <b>{c.contact_name || c.contact}</b><span className="text-xs text-muted">{c.contact}</span>
            <div className="ml-auto flex gap-2">
              {c.mode !== 'humano' && <button className="btn-primary py-1" onClick={() => mode('humano')}><Hand size={14} /> Assumir</button>}
              {c.mode !== 'pausado' && <button className="btn-ghost py-1" onClick={() => mode('pausado')}><Pause size={14} /> Pausar agente</button>}
              {c.mode !== 'agente' && <button className="btn-ghost py-1" onClick={() => mode('agente')}><Play size={14} /> Devolver ao agente</button>}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-raised/40 p-3">{conv.messages.map((m) => <Bubble key={m.id} m={m} tz={s.tz} />)}<div ref={end} /></div>
          <div className="flex gap-2 border-t border-line p-3">
            <input className="input" placeholder={c.mode === 'agente' ? 'Assuma a conversa para responder' : 'Escreva a resposta…'} disabled={c.mode === 'agente'} value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && reply()} />
            <button className="btn-primary" disabled={c.mode === 'agente'} onClick={reply} aria-label="Enviar"><Send size={16} /></button>
          </div>
        </>}
      </div>
    </div>
  );
}

function Simulator() {
  const s = useSession();
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const end = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  const send = async (body = text, reset = false) => {
    if (!body.trim()) return;
    setBusy(true); setText('');
    const at = new Date().toISOString();
    setMsgs((m) => [...(reset ? [] : m), { id: `u${Date.now()}`, direction: 'in', author: 'cliente', body, created_at: at }]);
    try {
      const r = await api('/api/agent/simulate', { method: 'POST', body: { body, contact: phone.replace(/\D/g, '') || undefined, reset } });
      setMsgs((m) => [...m, ...r.replies.map((x, i) => ({ id: `a${Date.now()}${i}`, direction: 'out', author: 'agente', body: x, created_at: new Date().toISOString() })),
        ...(r.handoff ? [{ id: `s${Date.now()}`, author: 'sistema', body: 'Conversa encaminhada para a equipe', created_at: new Date().toISOString() }] : [])]);
    } catch (e) { setMsgs((m) => [...m, { id: `e${Date.now()}`, author: 'sistema', body: e.message, created_at: at }]); }
    setBusy(false);
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
      <div className="card flex h-[65vh] flex-col">
        <div className="flex items-center gap-2 border-b border-line p-3"><ShieldCheck size={16} className="text-ok" /><span className="text-sm">Simulação isolada: nada vira pedido, reserva ou mensagem real.</span>
          <button className="btn-ghost ml-auto py-1" onClick={() => send('oi', true)}><RotateCcw size={14} /> Recomeçar</button></div>
        <div className="flex-1 overflow-y-auto bg-raised/40 p-3" data-sim-chat>{!msgs.length && <p className="text-center text-sm text-muted">Escreva como se fosse um cliente. Ex.: “oi”, “cardápio”, “quanto custa a caipirinha”, “quero fazer um pedido”.</p>}
          {msgs.map((m) => <Bubble key={m.id} m={m} tz={s.tz} />)}<div ref={end} /></div>
        <div className="flex gap-2 border-t border-line p-3">
          <input className="input" placeholder="Mensagem do cliente…" value={text} disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} data-sim-input />
          <button className="btn-primary" onClick={() => send()} disabled={busy} aria-label="Enviar"><Send size={16} /></button>
        </div>
      </div>
      <div className="card p-3 text-sm">
        <h3 className="font-display text-xl">Atalhos</h3>
        <div className="mt-2 flex flex-wrap gap-1">{['oi', 'cardápio', 'horário', 'quanto custa o chope?', 'quero fazer um pedido', 'status do meu pedido', 'reserva', 'falar com atendente'].map((x) => (
          <button key={x} className="chip border-line hover:bg-raised" onClick={() => send(x)} disabled={busy}>{x}</button>))}</div>
        <Field label="Número simulado (para status/reservas)" className="mt-3"><input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Opcional" /></Field>
      </div>
    </div>
  );
}

function Config({ data, reload }) {
  const toast = useToast();
  const s = useSession();
  const [f, setF] = useState(data);
  const [sec, setSec] = useState({ wa_token: '', wa_phone_number_id: '', wa_app_secret: '', wa_verify_token: '' });
  useEffect(() => setF(data), [data]);
  const save = async () => {
    try { await api('/api/agent/settings', { method: 'PUT', body: { enabled: f.enabled, name: f.name, greeting: f.greeting, handoff_message: f.handoff_message, closed_message: f.closed_message,
      reservation_max_people: Number(f.reservation_max_people), reservation_min_hours: Number(f.reservation_min_hours) } }); toast('Agente salvo'); reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  const saveSecrets = async () => {
    const body = Object.fromEntries(Object.entries(sec).filter(([, v]) => v !== ''));
    if (!Object.keys(body).length) return;
    try { await api('/api/agent/secrets', { method: 'PUT', body }); setSec({ wa_token: '', wa_phone_number_id: '', wa_app_secret: '', wa_verify_token: '' }); toast('Credenciais salvas'); reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  const webhook = data.webhook_path ? `${import.meta.env.VITE_API_URL || location.origin}${data.webhook_path}` : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h3 className="font-display text-xl">Identidade e mensagens</h3>
        <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Agente respondendo clientes reais" hint="Desligado, as mensagens chegam na caixa de entrada sem resposta automática." />
        <Field label="Nome do atendente virtual"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Saudação"><textarea className="input" rows={3} value={f.greeting} onChange={(e) => setF({ ...f, greeting: e.target.value })} /></Field>
        <Field label="Ao passar para a equipe"><input className="input" value={f.handoff_message} onChange={(e) => setF({ ...f, handoff_message: e.target.value })} /></Field>
        <Field label="Fora do horário de pedidos"><input className="input" value={f.closed_message} onChange={(e) => setF({ ...f, closed_message: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reserva: máximo de pessoas"><input className="input" inputMode="numeric" value={f.reservation_max_people} onChange={(e) => setF({ ...f, reservation_max_people: e.target.value })} /></Field>
          <Field label="Reserva: antecedência (h)"><input className="input" inputMode="numeric" value={f.reservation_min_hours} onChange={(e) => setF({ ...f, reservation_min_hours: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-muted">Gatilhos de transferência para a equipe: reclamação, desconto, cobrança, estorno, “atendente” ou 3 mensagens não entendidas.</p>
        <button className="btn-primary" onClick={save}>Salvar</button>
      </section>
      <section className="card space-y-3 p-4">
        <h3 className="flex items-center gap-2 font-display text-xl"><KeyRound size={18} /> Integração oficial (WhatsApp Cloud API)</h3>
        <p className="text-sm text-muted">Use as credenciais do app da Meta. Elas ficam guardadas no servidor e nunca voltam para esta tela.</p>
        {[['wa_phone_number_id', 'ID do número de telefone'], ['wa_token', 'Token de acesso permanente'], ['wa_app_secret', 'Chave secreta do app (assinatura do webhook)'], ['wa_verify_token', 'Token de verificação do webhook']].map(([k, l]) => (
          <Field key={k} label={<span>{l} {data.secrets[k] ? <Badge tone="ok">definido</Badge> : <Badge tone="muted">vazio</Badge>}</span>}>
            <input className="input font-mono" type="password" autoComplete="off" value={sec[k]} onChange={(e) => setSec({ ...sec, [k]: e.target.value })} placeholder={data.secrets[k] ? 'manter o atual' : ''} /></Field>))}
        {s.can('configuracoes.gerenciar') && <button className="btn-primary" onClick={saveSecrets}>Salvar credenciais</button>}
        {webhook ? <div className="rounded-lg bg-raised p-2 text-xs">URL do webhook (cadastre na Meta): <span className="break-all font-mono">{webhook}</span></div>
          : <p className="text-xs text-warn">Defina o endereço da empresa em Delivery › Cardápio digital para gerar a URL do webhook.</p>}
        {!!data.failures.length && <div><h4 className="font-semibold">Últimas falhas de envio</h4>
          <ul className="text-xs text-muted">{data.failures.map((x, i) => <li key={i}>{dateTime(x.created_at, s.tz)} — {x.error}</li>)}</ul></div>}
      </section>
      <ErrorBox error={null} />
    </div>
  );
}
