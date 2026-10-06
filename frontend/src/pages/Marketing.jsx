// Marketing: campanhas segmentadas (só para quem consentiu), link de descadastro, avaliações e satisfação.
import { useEffect, useState } from 'react';
import { Megaphone, MessageCircle, Plus, Send, Star } from 'lucide-react';
import { api } from '../lib/api.js';
import { dateTime } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useLoad, useToast, useAsk } from '../components/ui.jsx';

const TABS = [['avaliacoes', 'Avaliações'], ['campanhas', 'Campanhas']];
const STATUS = { rascunho: ['muted', 'Rascunho'], preparada: ['warn', 'Preparada'], enviada: ['ok', 'Enviada'], cancelada: ['muted', 'Cancelada'] };

export default function Marketing() {
  const [tab, setTab] = useState('avaliacoes');
  return (
    <div>
      <PageHeader title="Marketing" subtitle="Satisfação dos clientes e campanhas com consentimento registrado. Todo envio leva link de descadastro." />
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`border-b-2 px-4 py-2 text-sm font-semibold uppercase tracking-wide ${tab === k ? 'border-copper text-copper' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>)}
      </div>
      {tab === 'avaliacoes' ? <Reviews /> : <Campaigns />}
    </div>
  );
}

function Reviews() {
  const ask = useAsk();
  const s = useSession();
  const toast = useToast();
  const [days, setDays] = useState(30);
  const r = useLoad(() => api(`/api/marketing/reviews?days=${days}`), [days]);
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  const { stats, distribution, items } = r.data;
  const handle = async (x) => { const note = await ask.reason({ title: 'Avaliação tratada', label: 'O que foi feito?', reasons: ['Liguei e pedi desculpas', 'Ofereci cortesia na próxima visita', 'Respondi por WhatsApp', 'Repassei à equipe'] }); if (!note) return; try { await api(`/api/marketing/reviews/${x.id}/handled`, { method: 'POST', body: { note } }); r.reload(); } catch (e) { toast(e.message, 'bad'); } };
  const max = Math.max(1, ...distribution.map((d) => d.n));
  return (
    <div className="space-y-4">
      <div className="flex gap-1">{[7, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} aria-pressed={days === d} className={`rounded-full border px-3 py-1 text-sm ${days === d ? 'border-copper bg-copper text-white dark:text-black' : 'border-line'}`}>{d} dias</button>)}</div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="card p-3"><div className="text-xs uppercase text-muted">Média</div><div className="font-display text-3xl">{stats.average ? `${stats.average.toLocaleString('pt-BR')} ★` : '—'}</div></div>
        <div className="card p-3"><div className="text-xs uppercase text-muted">Avaliações</div><div className="font-display text-3xl">{stats.total}</div></div>
        <div className="card p-3"><div className="text-xs uppercase text-muted">Satisfeitos (4–5)</div><div className="font-display text-3xl">{stats.total ? Math.round((stats.positive / stats.total) * 100) : 0}%</div></div>
        <div className="card p-3"><div className="text-xs uppercase text-muted">Pendentes de retorno</div><div className={`font-display text-3xl ${stats.pending ? 'text-rust' : ''}`}>{stats.pending}</div></div>
      </div>
      <div className="card p-4"><h3 className="font-display text-xl">Distribuição</h3>
        {[5, 4, 3, 2, 1].map((n) => { const v = distribution.find((d) => d.score === n)?.n || 0; return (
          <div key={n} className="mt-1 grid grid-cols-[40px_1fr_40px] items-center gap-2 text-sm"><span>{n} ★</span><div className="h-4 rounded bg-raised"><div className="h-4 rounded bg-copper" style={{ width: `${(v / max) * 100}%` }} /></div><span className="text-right">{v}</span></div>); })}
        <p className="mt-2 text-xs text-muted">O link de avaliação aparece na pré-conta e no fechamento (QR). Cada consumo pode ser avaliado uma vez.</p>
      </div>
      {!items.length ? <Empty icon={Star} title="Sem avaliações no período" /> : (
        <div className="space-y-2">{items.map((x) => (
          <div key={x.id} className={`card p-3 ${x.score <= 2 && !x.handled_at ? 'border-rust/60' : ''}`}>
            <div className="flex flex-wrap items-center gap-2"><span className="text-copper">{'★'.repeat(x.score)}<span className="text-line">{'★'.repeat(5 - x.score)}</span></span>
              <span className="text-sm text-muted">{dateTime(x.created_at, s.tz)}{x.customer_name ? ` · ${x.customer_name}` : ''}</span>
              {x.handled_at ? <Badge tone="ok">retorno feito{x.handled_name ? ` por ${x.handled_name}` : ''}</Badge> : x.score <= 2 && <button className="btn-ghost ml-auto py-1" onClick={() => handle(x)}>Registrar retorno</button>}</div>
            {x.comment && <p className="mt-1 text-sm">“{x.comment}”</p>}
          </div>))}</div>
      )}
    </div>
  );
}

function Campaigns() {
  const ask = useAsk();
  const s = useSession();
  const toast = useToast();
  const c = useLoad(() => api('/api/marketing/campaigns'), []);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState(null);
  if (c.loading && !c.data) return <Loading />;
  const prepare = async (x) => { try { const r = await api(`/api/marketing/campaigns/${x.id}/prepare`, { method: 'POST' }); toast(`${r.recipients} destinatário(s)`); c.reload(); } catch (e) { toast(e.message, 'bad'); } };
  const send = async (x) => {
    if (!await ask.confirm({ title: 'Enviar campanha', message: `Enviar "${x.name}" pelo WhatsApp oficial para ${x.recipients} cliente(s)?`, confirmLabel: 'Enviar agora' })) return;
    try { const r = await api(`/api/marketing/campaigns/${x.id}/send`, { method: 'POST', body: { base_url: location.origin } }); toast(`${r.sent} enviada(s), ${r.failed} falha(s)`, r.failed ? 'warn' : 'ok'); c.reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <div className="space-y-3">
      <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Nova campanha</button>
      {!c.data?.length ? <Empty icon={Megaphone} title="Nenhuma campanha">Crie uma campanha para aniversariantes, clientes sumidos ou uma etiqueta. Só entra quem consentiu receber.</Empty> : (
        <div className="card overflow-x-auto"><table className="table-clean">
          <thead><tr><th>Campanha</th><th>Canal</th><th>Situação</th><th className="text-right">Destinatários</th><th className="text-right">Enviadas</th><th /></tr></thead>
          <tbody>{c.data.map((x) => (
            <tr key={x.id}><td className="font-semibold">{x.name}<div className="max-w-md truncate text-xs font-normal text-muted">{x.message}</div></td><td>{x.channel}</td>
              <td><Badge tone={STATUS[x.status][0]}>{STATUS[x.status][1]}</Badge></td><td className="text-right">{x.recipients}</td><td className="text-right">{x.sent}{x.failed ? ` (${x.failed} falha)` : ''}</td>
              <td className="whitespace-nowrap text-right">{x.status === 'rascunho' && <button className="text-xs underline" onClick={() => prepare(x)}>preparar lista</button>}
                {x.status === 'preparada' && <>{s.can('dados.pessoais') && <button className="text-xs underline" onClick={() => setView(x)}>ver mensagens</button>}
                  {x.channel === 'whatsapp' && <> · <button className="text-xs underline" onClick={() => send(x)}><Send size={11} className="inline" /> enviar</button></>}</>}</td></tr>
          ))}</tbody></table></div>
      )}
      <CampaignModal open={creating} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); c.reload(); }} />
      <RecipientsModal campaign={view} onClose={() => setView(null)} />
    </div>
  );
}

function CampaignModal({ open, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState(null);
  const tags = useLoad(() => (open ? api('/api/customers/summary') : Promise.resolve(null)), [open]);
  useEffect(() => { if (open) { setErr(null); setF({ name: '', channel: 'whatsapp', birthday_month: false, inactive_days: '', tag: '', message: 'Oi {nome}! Sentimos sua falta no {empresa}. Esta semana o chope é em dobro das 18h às 20h. 🍺' }); } }, [open]);
  const segment = () => ({ ...(f.birthday_month ? { birthday_month: true } : {}), ...(Number(f.inactive_days) ? { inactive_days: Number(f.inactive_days) } : {}), ...(f.tag ? { tag: f.tag } : {}) });
  useEffect(() => {
    if (!open || !f.channel) return;
    const t = setTimeout(() => api('/api/marketing/segments/preview', { method: 'POST', body: { channel: f.channel, segment: segment() } }).then(setPreview).catch(() => setPreview(null)), 300);
    return () => clearTimeout(t);
  }, [open, f.channel, f.birthday_month, f.inactive_days, f.tag]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const save = async () => { try { await api('/api/marketing/campaigns', { method: 'POST', body: { name: f.name, channel: f.channel, segment: segment(), message: f.message } }); onSaved(); } catch (e) { setErr(e); } };
  return (
    <Modal open wide onClose={onClose} title="Nova campanha" footer={<><span className="mr-auto text-sm">{preview ? <><b>{preview.recipients}</b> cliente(s) recebem · {preview.without_consent} sem consentimento ficam de fora</> : ''}</span>
      <button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar rascunho</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome interno"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Volta dos sumidos — outubro" /></Field>
        <Field label="Canal"><select className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="email">E-mail (exportar lista)</option></select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.birthday_month} onChange={(e) => setF({ ...f, birthday_month: e.target.checked })} /> Só aniversariantes do mês</label>
        <Field label="Sem visitar há (dias)"><input className="input" inputMode="numeric" value={f.inactive_days} onChange={(e) => setF({ ...f, inactive_days: e.target.value.replace(/\D/g, '') })} placeholder="Ex.: 30" /></Field>
        <Field label="Etiqueta"><select className="input" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}><option value="">Qualquer</option>{tags.data?.tags.map((t) => <option key={t.tag}>{t.tag}</option>)}</select></Field>
        <Field label="Mensagem" hint="Use {nome}, {empresa} e {pontos}. O link de descadastro é incluído automaticamente." className="sm:col-span-2">
          <textarea className="input" rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function RecipientsModal({ campaign, onClose }) {
  const toast = useToast();
  const r = useLoad(() => (campaign ? api(`/api/marketing/campaigns/${campaign.id}/recipients?base=${encodeURIComponent(location.origin)}`) : Promise.resolve(null)), [campaign?.id]);
  if (!campaign) return null;
  const mark = async (x) => { await api(`/api/marketing/campaigns/${campaign.id}/recipients/${x.id}/sent`, { method: 'POST' }).catch((e) => toast(e.message, 'bad')); r.reload(); };
  return (
    <Modal open wide onClose={onClose} title={campaign.name}>
      <p className="text-sm text-muted">Envio manual: abra no WhatsApp, envie e marque como enviado. Ou use “enviar” para o WhatsApp oficial (exige integração configurada no Agente).</p>
      {r.loading ? <Loading /> : <ul className="mt-2 divide-y divide-line">{(r.data || []).map((x) => (
        <li key={x.id} className="flex items-start gap-2 py-2 text-sm"><div className="flex-1"><b>{x.name}</b> · {x.phone || x.email}<div className="whitespace-pre-wrap text-xs text-muted">{x.message}</div></div>
          {x.status === 'enviado' ? <Badge tone="ok">enviado</Badge> : <div className="flex flex-col gap-1">
            {x.phone && <a className="btn-ghost py-1 text-xs" href={`https://wa.me/55${String(x.phone).replace(/\D/g, '').replace(/^55/, '')}?text=${encodeURIComponent(x.message)}`} target="_blank" rel="noreferrer"><MessageCircle size={12} /> abrir</a>}
            <button className="btn-ghost py-1 text-xs" onClick={() => mark(x)}>marcar enviado</button></div>}</li>))}</ul>}
    </Modal>
  );
}
