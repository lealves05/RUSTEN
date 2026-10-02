// Salão: mapa de mesas e cartões de comanda (gerar em lote, imprimir relação, bloquear, substituir).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ReviewLinkModal from '../components/ReviewLink.jsx';
import { Armchair, CalendarDays, ChefHat, CircleDot, LayoutGrid, List, Lock, Merge, Printer, Unlock } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, time } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useLoad, useToast } from '../components/ui.jsx';

const STATUS = {
  livre: ['ok', 'Livre'], ocupada: ['info', 'Ocupada'], reservada: ['warn', 'Reservada'], conta: ['warn', 'Conta pedida'], limpeza: ['muted', 'Limpeza'],
};

export default function Floor() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('aba') === 'comandas' ? 'comandas' : 'mesas');
  const review = Number(params.get('avaliar')) || null;
  return (
    <div>
      <PageHeader title="Salão" subtitle="Mesas, ocupação e cartões de comanda" actions={<Link className="btn-ghost" to="/salao/reservas"><CalendarDays size={16} /> Reservas</Link>} />
      <div className="mb-4 flex gap-1 border-b border-line">
        {[['mesas', 'Mesas'], ['comandas', 'Cartões de comanda']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 font-semibold ${tab === k ? 'border-copper text-ink' : 'border-transparent text-muted'}`}>{l}</button>
        ))}
      </div>
      {tab === 'mesas' ? <Tables s={s} /> : <Cards s={s} />}
      <ReviewLinkModal sessionId={review} onClose={() => setParams({ aba: tab }, { replace: true })} />
    </div>
  );
}

function Tables({ s }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => api('/api/floor/tables'));
  const [add, setAdd] = useState(false);
  const [sel, setSel] = useState(null);
  const [join, setJoin] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const tables = data.tables;
  const areas = [...new Set(tables.map((t) => t.area))];
  const joinTable = async (t) => {
    try { const sessions = await api('/api/pdv/sessions'); const mine = sessions.find((x) => x.table_id === t.id); setSel(null); setJoin({ target: mine?.id }); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const setStatus = async (t, status) => { try { await api(`/api/floor/tables/${t.id}`, { method: 'PUT', body: { status } }); reload(); setSel(null); } catch (e) { toast(e.message, 'bad'); } };
  const openTable = async (t) => {
    try { const sessions = await api('/api/pdv/sessions'); const mine = sessions.filter((x) => x.table_id === t.id);
      if (mine.length) return nav(`/pdv?sessao=${mine[0].id}`);
      const r = await api('/api/pdv/sessions', { method: 'POST', body: { kind: 'mesa', table_id: t.id } }); nav(`/pdv?sessao=${r.id}`);
    } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {Object.entries(STATUS).map(([k, [tone, l]]) => <Badge key={k} tone={tone}>{l}: {tables.filter((t) => t.status === k).length}</Badge>)}
        {s.can('salao.gerenciar') && <button className="btn-ghost ml-auto" onClick={() => setAdd(true)}>Adicionar mesas</button>}
      </div>
      {!tables.length && <Empty icon={Armchair} title="Nenhuma mesa cadastrada">Adicione mesas para usar o mapa do salão.</Empty>}
      {areas.map((area) => (
        <section key={area} className="mb-6">
          <h2 className="mb-2 font-display text-2xl tracking-wide">{area}</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {tables.filter((t) => t.area === area).map((t) => {
              const [tone, label] = STATUS[t.status];
              return (
                <button key={t.id} onClick={() => setSel(t)}
                  className={`card flex min-h-[104px] flex-col items-center justify-center p-2 transition hover:border-copper ${t.status === 'ocupada' || t.status === 'conta' ? 'stripe' : ''}`}>
                  <span className="font-display text-4xl leading-none">{t.number}</span>
                  <Badge tone={tone}>{label}</Badge>
                  {t.customer_names && <span className="mt-1 max-w-full truncate text-xs font-semibold" title={t.customer_names}>{t.customer_names}</span>}
                  <span className="mt-1 flex gap-2 text-[11px] text-muted">
                    {t.preparing > 0 && <span title="Itens em preparo"><ChefHat size={11} className="inline" /> {t.preparing}</span>}
                    {t.ready > 0 && <span title="Itens prontos"><CircleDot size={11} className="inline" /> {t.ready} pronto</span>}
                    {t.consumed_cents > 0 && <span>{money(t.consumed_cents)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <Modal open={!!sel} onClose={() => setSel(null)} title={`Mesa ${sel?.number}`}>
        {sel && <>
          <p className="text-sm text-muted">{sel.area} · {sel.capacity} lugares · {sel.open_sessions} consumo(s) aberto(s)</p>
          {sel.customer_names && <p className="mt-1 font-semibold">{sel.customer_names}</p>}
          {s.can('pdv.lancar') && <button className="btn-primary btn-xl mt-3 w-full" onClick={() => openTable(sel)}>{sel.open_sessions ? 'Ir para o consumo' : 'Abrir mesa no PDV'}</button>}
          {sel.open_sessions > 0 && s.can('pdv.transferir_item') && <button className="btn-ghost mt-2 w-full" onClick={() => joinTable(sel)}><Merge size={16} /> Juntar com outra mesa ou comanda</button>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {['livre', 'reservada', 'limpeza'].map((k) => <button key={k} className="btn-ghost" disabled={sel.status === k || (k === 'livre' && sel.open_sessions > 0)} onClick={() => setStatus(sel, k)}>Marcar {STATUS[k][1].toLowerCase()}</button>)}
          </div>
          {sel.open_sessions > 0 && <p className="mt-2 text-xs text-muted">Mesa com consumo aberto não pode ser marcada como livre.</p>}
          {sel.code && <p className="mt-3 text-xs text-muted">Código da mesa: <span className="font-mono">{sel.code}</span></p>}
        </>}
      </Modal>
      <JoinModal open={!!join} preset={join} onClose={() => setJoin(null)} onDone={() => { setJoin(null); reload(); }} />
      <AddTables open={add} onClose={() => setAdd(false)} next={Math.max(0, ...tables.map((t) => t.number)) + 1} onDone={reload} />
    </>
  );
}

function AddTables({ open, onClose, next, onDone }) {
  const [f, setF] = useState({ count: 4, area: 'Salão', capacity: 4 });
  const [err, setErr] = useState(null);
  const go = async () => {
    try { await api('/api/floor/tables', { method: 'POST', body: { from: next, count: Number(f.count), area: f.area, capacity: Number(f.capacity) } }); onDone(); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Adicionar mesas" footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={go}>Adicionar</button></>}>
      <p className="text-sm text-muted">Numeração a partir da mesa {next}.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Field label="Quantidade"><input className="input" type="number" min={1} max={200} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></Field>
        <Field label="Ambiente"><input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></Field>
        <Field label="Lugares"><input className="input" type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function Cards({ s }) {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => api('/api/floor/cards'));
  const [gen, setGen] = useState(false);
  const [replace, setReplace] = useState(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem('rusten.comandas.view') || 'cartoes'; } catch { return 'cartoes'; } });
  const [filter, setFilter] = useState('uso');
  const [term, setTerm] = useState('');
  const [join, setJoin] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const cards = data.cards;
  const manage = s.can('comandas.gerenciar');
  const canJoin = s.can('pdv.transferir_item');
  const setV = (v) => { setView(v); try { localStorage.setItem('rusten.comandas.view', v); } catch { /* sem armazenamento */ } };
  const t = term.trim().toLowerCase();
  const shown = cards.filter((c) => (filter === 'uso' ? c.session_id : filter === 'livres' ? c.status === 'ativo' && !c.session_id : filter === 'bloqueadas' ? c.status === 'bloqueado' : true))
    .filter((c) => !t || String(c.number) === t || (c.customer_name || '').toLowerCase().includes(t) || (c.code || '').toLowerCase().includes(t));
  const block = async (c) => { const reason = prompt(`Motivo do bloqueio da comanda ${c.number}:`); if (!reason) return; try { await api(`/api/floor/cards/${c.id}/block`, { method: 'POST', body: { reason } }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const unblock = async (c) => { try { await api(`/api/floor/cards/${c.id}/unblock`, { method: 'POST' }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return toast('Permita pop-ups para imprimir', 'warn');
    const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Comandas</title><style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 8px;text-align:left}</style>
      <h2>Relação de cartões de comanda</h2><p>Imprima os códigos em etiquetas Code 128 ou QR Code com o conteúdo exato da coluna "Código".</p><table><tr><th>Número</th><th>Código</th><th>Situação</th><th>Cliente</th></tr>
      ${cards.map((c) => `<tr><td>${c.number}</td><td style="font-family:monospace">${esc(c.code)}</td><td>${c.status}</td><td>${esc(c.customer_name || '')}</td></tr>`).join('')}</table>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250); // impressão disparada daqui: a CSP não permite script embutido na janela
  };
  const situation = (c) => (c.status === 'bloqueado' ? <Badge tone="bad" icon={Lock}>Bloqueada{c.block_reason ? ` — ${c.block_reason}` : ''}</Badge>
    : c.session_id ? <Badge tone={c.session_status === 'em_fechamento' ? 'warn' : 'info'}>{c.session_status === 'em_fechamento' ? 'Conta pedida' : 'Em uso'}</Badge> : <Badge tone="ok">Livre</Badge>);
  const actions = (c) => (
    <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1 text-sm">
      {canJoin && c.session_id && <button className="underline" onClick={() => setJoin({ source: c.session_id })}><Merge size={12} className="inline" /> juntar</button>}
      {manage && c.status === 'ativo' && !c.session_id && <button className="underline" onClick={() => block(c)}>bloquear</button>}
      {manage && c.status === 'bloqueado' && <button className="underline" onClick={() => unblock(c)}><Unlock size={12} className="inline" /> desbloquear</button>}
      {manage && c.session_id && <button className="underline" onClick={() => setReplace(c)}>substituir (perdida)</button>}
    </span>
  );
  const FILTERS = [['uso', `Em uso (${cards.filter((c) => c.session_id).length})`], ['livres', `Livres (${cards.filter((c) => c.status === 'ativo' && !c.session_id).length})`],
    ['bloqueadas', `Bloqueadas (${cards.filter((c) => c.status === 'bloqueado').length})`], ['todas', `Todas (${cards.length})`]];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filtrar">
          {FILTERS.map(([k, l]) => <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === k ? 'border-copper bg-copper text-white dark:text-black' : 'border-line bg-surface hover:bg-raised'}`}>{l}</button>)}
        </div>
        <input className="input w-56" placeholder="Número, nome ou código" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar comanda" />
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="radiogroup" aria-label="Exibição">
            {[['cartoes', LayoutGrid, 'Cartões'], ['lista', List, 'Lista']].map(([k, I, l]) => (
              <button key={k} role="radio" aria-checked={view === k} onClick={() => setV(k)} title={l}
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-semibold ${view === k ? 'bg-copper text-white dark:text-black' : 'text-muted hover:text-ink'}`}><I size={15} /> {l}</button>))}
          </div>
          {canJoin && <button className="btn-ghost" onClick={() => setJoin({})}><Merge size={16} /> Juntar comandas e mesas</button>}
          <button className="btn-ghost" onClick={print}><Printer size={16} /> Relação de códigos</button>
          {manage && <button className="btn-primary" onClick={() => setGen(true)}>Gerar em lote</button>}
        </div>
      </div>
      {!cards.length ? <Empty title="Nenhum cartão">Gere cartões numerados para usar comandas físicas.</Empty>
        : !shown.length ? <Empty title="Nada nesta seleção">{filter === 'uso' ? 'Nenhuma comanda em uso agora.' : 'Ajuste o filtro ou a busca.'}</Empty>
        : view === 'cartoes' ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {shown.map((c) => (
              <div key={c.id} className={`card flex min-h-[132px] flex-col p-3 ${c.session_id ? 'stripe' : ''} ${c.status === 'bloqueado' ? 'opacity-60' : ''}`} data-card={c.number}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-display text-4xl leading-none">{c.number}</span>
                  {situation(c)}
                </div>
                <div className="mt-1 min-h-[1.5rem] truncate text-base font-semibold" title={c.customer_name || ''}>{c.customer_name || (c.session_id ? <span className="text-sm font-normal text-muted">sem nome</span> : '')}</div>
                {c.session_id && <AccountChip cents={c.account_cents} />}
                {c.session_id ? (
                  <a href={`/pdv?sessao=${c.session_id}`} className="text-xs text-muted hover:underline">{c.item_count} item(ns){c.items_cents > 0 ? ` · ${money(c.items_cents)}` : ''}{c.table_number ? ` · Mesa ${c.table_number}` : ''}{c.opened_at ? ` · desde ${time(c.opened_at, s.tz)}` : ''}</a>
                ) : <span className="font-mono text-[10px] text-muted">{c.code}</span>}
                <div className="mt-auto pt-2 text-right">{actions(c)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Nº</th><th>Cliente</th><th>Situação</th><th>Consumo</th><th>Código</th><th /></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td className="font-display text-xl">{c.number}</td>
                    <td className="font-semibold">{c.customer_name || (c.session_id ? <span className="font-normal text-muted">sem nome</span> : '—')}{c.session_id && <span className="ml-2"><AccountChip cents={c.account_cents} /></span>}</td>
                    <td>{situation(c)}</td>
                    <td>{c.session_id ? <a className="underline" href={`/pdv?sessao=${c.session_id}`}>{c.item_count} item(ns){c.items_cents > 0 ? ` · ${money(c.items_cents)}` : ''}{c.table_number ? ` · Mesa ${c.table_number}` : ''}</a> : '—'}</td>
                    <td className="font-mono text-xs">{c.code}</td>
                    <td className="text-right">{actions(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <GenCards open={gen} onClose={() => setGen(false)} next={Math.max(0, ...cards.map((c) => c.number)) + 1} onDone={reload} />
      <ReplaceCard card={replace} cards={cards} onClose={() => setReplace(null)} onDone={reload} />
      <JoinModal open={!!join} preset={join} onClose={() => setJoin(null)} onDone={() => { setJoin(null); reload(); }} />
    </>
  );
}

const sessName = (x) => `${x.card_number ? `Comanda ${x.card_number}` : x.table_number ? `Mesa ${x.table_number}` : x.label || (x.kind === 'balcao' ? 'Balcão' : `#${x.id}`)}${x.card_number && x.table_number ? ` · Mesa ${x.table_number}` : ''}`;

/* Juntar comandas e mesas: os itens das origens passam para o destino (com rastreio) e as origens são encerradas como "juntadas". */
export function JoinModal({ open, preset, onClose, onDone }) {
  const s = useSession();
  const toast = useToast();
  const [list, setList] = useState(null);
  const [sources, setSources] = useState([]);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('Clientes juntaram as contas');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!open) return;
    setErr(null); setBusy(false); setReason('Clientes juntaram as contas');
    setSources(preset?.source ? [preset.source] : []); setTarget(preset?.target ? String(preset.target) : '');
    api('/api/pdv/sessions').then(setList).catch(setErr);
  }, [open, preset]);
  if (!open) return null;
  const toggle = (id) => setSources((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const tgt = Number(target);
  const chosen = (list || []).filter((x) => sources.includes(x.id) && x.id !== tgt);
  const paidSrc = chosen.filter((x) => Number(x.paid_cents) > 0);
  const go = async () => {
    setBusy(true); setErr(null);
    let ok = 0;
    try {
      for (const x of chosen) { await api(`/api/pdv/sessions/${x.id}/merge`, { method: 'POST', body: { target_session_id: tgt, reason } }); ok++; }
      toast(`${ok} consumo(s) juntado(s) em ${sessName(list.find((x) => x.id === tgt))}`);
      onDone();
    } catch (e) { setErr(ok ? new Error(`${ok} juntado(s); parou em um erro: ${e.message}`) : e); setBusy(false); if (ok) onDone(); }
  };
  return (
    <Modal open wide onClose={onClose} title="Juntar comandas e mesas"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
        <button className="btn-primary" disabled={busy || !tgt || !chosen.length || paidSrc.length > 0 || reason.trim().length < 3} onClick={go}>
          <Merge size={16} /> {busy ? 'Juntando…' : `Juntar ${chosen.length || ''} em ${tgt && list ? sessName(list.find((x) => x.id === tgt) || {}) : '…'}`}</button></>}>
      {!list ? <Loading /> : list.length < 2 ? <p className="text-sm text-muted">É preciso ter ao menos dois consumos abertos para juntar.</p> : (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="label">1. Marque o que vai ser juntado</div>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {list.filter((x) => x.id !== tgt).map((x) => (
                <li key={x.id}><label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 ${sources.includes(x.id) ? 'border-copper bg-copper/10' : 'border-line'}`}>
                  <input type="checkbox" checked={sources.includes(x.id)} onChange={() => toggle(x.id)} />
                  <span className="flex-1"><b>{sessName(x)}</b>{x.customer_name ? ` — ${x.customer_name}` : ''}<span className="block text-xs text-muted">{x.item_count} item(ns) · {money(x.items_cents)}{Number(x.paid_cents) > 0 ? ` · pago ${money(x.paid_cents)}` : ''}</span></span>
                </label></li>))}
            </ul>
          </div>
          <div>
            <div className="label">2. Escolha o destino (onde a conta continua)</div>
            <select className="input" value={target} onChange={(e) => { setTarget(e.target.value); setSources((xs) => xs.filter((x) => x !== Number(e.target.value))); }} aria-label="Destino">
              <option value="">Escolha…</option>
              {list.map((x) => <option key={x.id} value={x.id}>{sessName(x)}{x.customer_name ? ` — ${x.customer_name}` : ''} ({money(x.items_cents)})</option>)}
            </select>
            <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {chosen.length > 0 && tgt > 0 && (
              <div className="mt-3 rounded-lg bg-raised p-3 text-sm">
                Total após juntar: <b>{money(chosen.reduce((a, x) => a + Number(x.items_cents), 0) + Number(list.find((x) => x.id === tgt)?.items_cents || 0))}</b> (sem taxa de serviço).
                <div className="text-xs text-muted">Os itens mantêm horário, preço e quem lançou; as comandas/mesas de origem ficam livres.</div>
              </div>)}
            {paidSrc.length > 0 && <p className="mt-2 text-sm text-rust">{paidSrc.map(sessName).join(', ')} já tem pagamento: transfira só os itens restantes pelo PDV.</p>}
            {!s.can('pdv.transferir_item') && <p className="mt-2 text-sm text-rust">Seu perfil não pode juntar consumos.</p>}
          </div>
        </div>
      )}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function GenCards({ open, onClose, next, onDone }) {
  const [count, setCount] = useState(50);
  const [err, setErr] = useState(null);
  const go = async () => { try { await api('/api/floor/cards', { method: 'POST', body: { from: next, count: Number(count) } }); onDone(); onClose(); } catch (e) { setErr(e); } };
  return (
    <Modal open={open} onClose={onClose} title="Gerar cartões" footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={go}>Gerar</button></>}>
      <p className="text-sm text-muted">Numeração a partir de {next}. Cada cartão recebe um código próprio (prefixo configurável em Configurações › PDV).</p>
      <Field label="Quantidade" className="mt-3"><input className="input" type="number" min={1} max={1000} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function ReplaceCard({ card, cards, onClose, onDone }) {
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  if (!card) return null;
  const free = cards.filter((c) => c.status === 'ativo' && !c.session_id);
  const go = async () => {
    try { const n = free.find((c) => String(c.number) === String(to)); if (!n) throw new Error('Escolha um cartão livre');
      await api(`/api/floor/cards/${card.id}/replace`, { method: 'POST', body: { new_card_id: n.id, reason } }); onDone(); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Substituir comanda ${card.number}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={reason.trim().length < 3} onClick={go}>Substituir</button></>}>
      <p className="text-sm">O cartão {card.number} será bloqueado e o consumo aberto passa para o novo cartão, mantendo itens, pagamentos e histórico.</p>
      <Field label="Novo cartão (número)" className="mt-3"><input className="input" list="free-c" value={to} onChange={(e) => setTo(e.target.value)} /><datalist id="free-c">{free.map((c) => <option key={c.id} value={c.number} />)}</datalist></Field>
      <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

// Conta do cliente da comanda: fiado em aberto (vermelho) ou crédito (verde)
function AccountChip({ cents }) {
  const v = Number(cents || 0);
  if (!v) return null;
  return <span className={`chip ${v < 0 ? 'border-rust/40 bg-rust/10 text-rust' : 'border-ok/40 bg-ok/10 text-ok'}`} data-card-account title={v < 0 ? 'Cliente com fiado em aberto' : 'Cliente com crédito'}>{v < 0 ? `fiado ${money(-v)}` : `crédito ${money(v)}`}</span>;
}
