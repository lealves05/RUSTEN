// KDS — filas de produção por setor: NOVO → ACEITO → PREPARANDO → PRONTO → ENTREGUE.
// Atualiza sozinho; ao reconectar, recarrega a fila inteira (nenhum item reconhecido volta a "novo").
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Ban, BellRing, ChefHat, Flame, Maximize2, Megaphone, PartyPopper, Tv, Volume2, VolumeX } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useToast } from '../components/ui.jsx';
import { beep } from '../pdv/useScanner.js';

const NEXT = { novo: ['aceito', 'Aceitar'], aceito: ['preparando', 'Preparar'], preparando: ['pronto', 'Pronto'], pronto: ['entregue', 'Entregue'] };
const COLS = [['novo', 'Novos'], ['preparando', 'Em preparo'], ['pronto', 'Prontos']];
// Avisa o Painel da TV aberto neste navegador para atualizar na hora (outras TVs atualizam pela consulta a cada 2 s)
let tvChannel;
const notifyTv = (msg = { type: 'changed' }) => { try { tvChannel ||= new BroadcastChannel('rusten-kds'); tvChannel.postMessage(msg); } catch { /* sem BroadcastChannel */ } };
const origin = (i) => (i.delivery_number ? `Delivery #${i.delivery_number}${i.delivery_mode === 'retirada' ? ' (retirada)' : ''}` : i.table_number
  ? `Mesa ${i.table_number}${i.card_number ? ` · Cmd ${i.card_number}` : ''}` : i.card_number ? `Comanda ${i.card_number}` : i.label || (i.kind === 'balcao' ? 'Balcão' : `#${i.session_id}`));

export default function Kitchen() {
  const s = useSession();
  const toast = useToast();
  const [sectors, setSectors] = useState(null);
  const [sector, setSector] = useState(() => localStorage.getItem('rusten.kds.sector') || '');
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(() => localStorage.getItem('rusten.kds.sound') !== 'off');
  const seen = useRef(new Set());
  const [refusing, setRefusing] = useState(null); // { title, items }
  const [refuseReason, setRefuseReason] = useState('');
  const first = useRef(true);

  useEffect(() => { api('/api/kitchen/sectors').then(setSectors).catch(setErr); }, []);
  const load = useCallback(async () => {
    try {
      const r = await api(`/api/kitchen/queue${sector ? `?sector_id=${sector}` : ''}`);
      const fresh = r.items.filter((i) => i.kitchen_status === 'novo' && !seen.current.has(i.id));
      r.items.forEach((i) => seen.current.add(i.id));
      if (!first.current && fresh.length && sound) beep('ok');
      first.current = false;
      setData(r); setErr(null);
    } catch (e) { setErr(e); }
  }, [sector, sound]);
  useEffect(() => { first.current = true; seen.current = new Set(); load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); window.addEventListener('online', load); return () => { clearInterval(t); window.removeEventListener('online', load); }; }, [load]);

  const move = async (item, to) => {
    try { await api(`/api/kitchen/items/${item.id}/status`, { method: 'POST', body: { to, from: item.kitchen_status } }); notifyTv(); load(); }
    catch (e) { toast(e.message, e.code === 'status_changed' ? 'warn' : 'bad'); load(); }
  };
  const call = async (g) => {
    // chama no painel do(s) setor(es) deste cartão (ex.: só o Bar)
    const sectorIds = [...new Set(g.items.map((i) => i.sector_id).filter(Boolean))];
    try {
      const r = await api(`/api/kitchen/sessions/${g.session_id}/call`, { method: 'POST', body: sectorIds.length ? { sector_ids: sectorIds } : {} });
      notifyTv({ type: 'call', session_id: g.session_id });
      const names = [...new Set(g.items.filter((i) => r.sectors?.includes(i.sector_id)).map((i) => i.sector_name).filter(Boolean))];
      toast(`${g.origin} chamado no Painel da TV${names.length ? ` (${names.join(', ')})` : ''}`);
    }
    catch (e) { toast(e.message, 'bad'); }
  };
  // "Tudo pronto": leva todos os itens do pedido (deste setor, se filtrado) para Pronto de uma vez
  const allReady = async (g) => {
    try { await api(`/api/kitchen/sessions/${g.session_id}/advance`, { method: 'POST', body: { to: 'pronto', ...(sector ? { sector_id: Number(sector) } : {}) } }); notifyTv(); load(); }
    catch (e) { toast(e.message, 'bad'); load(); }
  };
  // Recusar: sai da fila e do Painel da TV, mas continua na comanda (a cobrança não muda)
  const refuse = async () => {
    try {
      const r = await api('/api/kitchen/items/refuse', { method: 'POST', body: { item_ids: refusing.items.map((i) => i.id), reason: refuseReason.trim() || undefined } });
      toast(`${r.refused} item(ns) recusado(s): saíram da fila e da TV e continuam na comanda`);
      setRefusing(null); setRefuseReason(''); notifyTv(); load();
    } catch (e) { toast(e.message, 'bad'); load(); }
  };
  const ack = async (item) => { await api(`/api/kitchen/items/${item.id}/ack-cancel`, { method: 'POST' }).catch(() => {}); load(); };
  const priority = async (item) => {
    const reason = prompt(item.priority ? 'Motivo para tirar a prioridade:' : 'Motivo da prioridade (ex.: cliente com pressa, refazer prato):'); if (!reason) return;
    try { await api(`/api/kitchen/items/${item.id}/priority`, { method: 'POST', body: { priority: !item.priority, reason } }); load(); } catch (e) { toast(e.message, 'bad'); }
  };

  // agrupa por pedido (consumo) dentro de cada coluna
  const columns = useMemo(() => {
    if (!data) return {};
    const out = { novo: [], preparando: [], pronto: [], cancelado: [] };
    const col = (st) => (st === 'aceito' ? 'preparando' : st);
    const groups = {};
    for (const i of data.items) {
      const c = col(i.kitchen_status);
      const k = `${c}-${i.session_id}`;
      if (!groups[k]) { groups[k] = { key: k, col: c, session_id: i.session_id, origin: origin(i), customer: i.customer_name, items: [], since: i.sent_at, priority: false }; out[c]?.push(groups[k]); }
      groups[k].items.push(i);
      if (i.sent_at < groups[k].since) groups[k].since = i.sent_at;
      if (i.priority) groups[k].priority = true;
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => (b.priority - a.priority) || (new Date(a.since) - new Date(b.since)));
    return out;
  }, [data]);

  if (!sectors && !err) return <Loading />;
  const mins = (t) => Math.max(0, Math.floor((now - new Date(t).getTime()) / 60000));
  return (
    <div>
      <PageHeader title="Cozinha" subtitle="Fila de produção em tempo real. Ao marcar Pronto, o número aparece no Painel da TV com fogos de artifício, som e voz. Use Chamar na TV para repetir."
        actions={<>
          <button className="btn-ghost" onClick={() => { const v = !sound; setSound(v); localStorage.setItem('rusten.kds.sound', v ? 'on' : 'off'); }} aria-pressed={sound}>{sound ? <Volume2 size={16} /> : <VolumeX size={16} />} Som</button>
          <a className="btn-ghost" href="/painel-tv" target="_blank" rel="noreferrer" title="Abra numa TV ou monitor voltado para os clientes"><Tv size={16} /> Painel da TV</a>
          <button className="btn-ghost" onClick={() => document.documentElement.requestFullscreen?.()}><Maximize2 size={16} /> Tela cheia</button>
        </>} />
      <div className="mb-3 flex flex-wrap gap-1">
        {[['', 'Todos os setores'], ...(sectors || []).map((x) => [String(x.id), `${x.name}${x.open_count ? ` (${x.open_count})` : ''}`])].map(([k, l]) => (
          <button key={k} onClick={() => { setSector(k); localStorage.setItem('rusten.kds.sector', k); }} aria-pressed={sector === k}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${sector === k ? 'border-copper bg-copper text-white dark:text-black' : 'border-line bg-surface hover:bg-raised'}`}>{l}</button>
        ))}
      </div>
      <ErrorBox error={err} onRetry={load} />
      {!!columns.cancelado?.length && (
        <div className="mb-3 space-y-2" role="alert">
          {columns.cancelado.flatMap((g) => g.items).map((i) => (
            <div key={i.id} className="flex items-center gap-3 rounded-xl border-2 border-rust bg-rust/10 p-3">
              <AlertTriangle className="text-rust" />
              <div className="flex-1"><b>CANCELADO:</b> {Number(i.qty)}× {i.description} — {origin(i)}<div className="text-xs">{i.cancel_reason}</div></div>
              <button className="btn-danger" onClick={() => ack(i)}>Ciente</button>
            </div>
          ))}
        </div>
      )}
      {data && !data.items.filter((i) => i.kitchen_status !== 'cancelado').length ? (
        <Empty icon={ChefHat} title="Fila vazia">Os itens lançados no PDV para este setor aparecem aqui na hora.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          {COLS.map(([c, label]) => (
            <section key={c} className="min-w-0">
              <h2 className="mb-2 flex items-center gap-2 font-display text-2xl">{label} <Badge tone={c === 'novo' ? 'warn' : c === 'pronto' ? 'ok' : 'info'}>{(columns[c] || []).reduce((n, g) => n + g.items.length, 0)}</Badge>
                {(columns[c] || []).length > 1 && (
                  <button className="ml-auto font-sans text-xs font-semibold text-muted underline hover:text-rust" data-kds-refuse-col={c}
                    onClick={() => setRefusing({ title: `todos os itens de "${label}"${sector ? ' deste setor' : ''}`, items: columns[c].flatMap((g) => g.items) })}>recusar todos</button>
                )}
              </h2>
              <div className="space-y-3">
                {(columns[c] || []).map((g) => {
                  const target = g.items[0].target_minutes || 15;
                  const m = mins(g.since);
                  const late = c !== 'pronto' && m > target;
                  return (
                    <article key={g.key} data-kds-order={g.session_id} className={`card overflow-hidden ${late ? 'border-2 border-rust' : g.priority ? 'border-2 border-warn' : ''}`}>
                      <header className={`flex items-center justify-between px-3 py-2 ${late ? 'bg-rust text-white' : 'bg-raised'}`}>
                        <div><div className="font-display text-xl leading-none">{g.origin}</div>{g.customer && <div className="text-xs opacity-80">{g.customer}</div>}</div>
                        <div className="text-right text-sm font-bold">{g.priority && <Flame size={14} className="inline text-warn" />} {m} min{late && <div className="text-[10px] uppercase">atrasado</div>}</div>
                      </header>
                      <div className="flex gap-2 border-b border-line bg-surface px-3 py-2">
                        <button className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-bold uppercase ${c === 'pronto' ? 'bg-copper text-white dark:text-black' : 'border border-copper text-copper'}`}
                          onClick={() => call(g)} data-kds-call={g.session_id} title="Mostra este número no Painel da TV com fogos, som e voz">
                          <Megaphone size={16} /> Chamar na TV
                        </button>
                        {c !== 'pronto' && (
                          <button className="btn-primary min-h-[44px] flex-1 text-sm" onClick={() => allReady(g)} data-kds-allready={g.session_id} title="Marca todos os itens deste pedido como prontos">
                            <PartyPopper size={16} /> Tudo pronto
                          </button>
                        )}
                        <button className="btn-ghost min-h-[44px] px-3 text-rust" onClick={() => setRefusing({ title: `${g.origin} (${g.items.length} item(ns))`, items: g.items })}
                          data-kds-refuse={g.session_id} title="Recusar: tira da fila e do Painel da TV, mas mantém na comanda" aria-label="Recusar pedido"><Ban size={16} /></button>
                      </div>
                      <ul className="divide-y divide-line">
                        {g.items.map((i) => (
                          <li key={i.id} className="flex items-start gap-2 p-3">
                            <div className="flex-1">
                              <div className="text-lg font-bold leading-tight">{Number(i.qty)}× {i.description}</div>
                              {!!i.modifiers?.length && <div className="text-sm">{i.modifiers.map((o) => o.name).join(' · ')}</div>}
                              {i.notes && <div className="text-sm font-semibold text-warn">Obs.: {i.notes}</div>}
                              <div className="text-[11px] uppercase text-muted">{!sector && `${i.sector_name} · `}{i.user_name || 'online'}{i.added_later && <span className="ml-1 font-bold text-copper"><BellRing size={10} className="inline" /> acréscimo</span>}</div>
                              <div className="flex gap-3">
                                {s.can('pdv.autorizar') && <button className="text-[11px] underline" onClick={() => priority(i)}>{i.priority ? 'tirar prioridade' : 'priorizar'}</button>}
                                <button className="text-[11px] text-rust underline" onClick={() => setRefusing({ title: `${Number(i.qty)}× ${i.description} — ${g.origin}`, items: [i] })} data-kds-refuse-item={i.id}>recusar</button>
                              </div>
                            </div>
                            {NEXT[i.kitchen_status] && (
                              <button className={`${i.kitchen_status === 'preparando' ? 'btn-primary' : 'btn-ghost'} min-h-[48px] min-w-[96px]`} onClick={() => move(i, NEXT[i.kitchen_status][0])}>
                                {NEXT[i.kitchen_status][1]}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      {refusing && (
        <Modal open onClose={() => setRefusing(null)} title="Recusar na produção"
          footer={<><button className="btn-ghost" onClick={() => setRefusing(null)}>Voltar</button>
            <button className="btn-danger" onClick={refuse} data-kds-refuse-confirm><Ban size={16} /> Recusar {refusing.items.length} item(ns)</button></>}>
          <div className="space-y-3 text-sm">
            <p>Recusar <b>{refusing.title}</b>?</p>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li>Sai da fila da produção e do <b>Painel da TV</b>.</li>
              <li><b>Continua na comanda</b>: o valor e a cobrança não mudam. Para tirar da conta, cancele o item no PDV.</li>
              <li>Fica registrado na auditoria, com quem recusou.</li>
            </ul>
            <Field label="Motivo (opcional)"><input className="input" value={refuseReason} maxLength={200} onChange={(e) => setRefuseReason(e.target.value)} placeholder="ex.: servido direto no balcão" data-kds-refuse-reason /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
