// Salão: mapa de mesas e cartões de comanda (gerar em lote, imprimir relação, bloquear, substituir).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Armchair, ChefHat, CircleDot, Lock, Printer, Unlock } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useLoad, useToast } from '../components/ui.jsx';

const STATUS = {
  livre: ['ok', 'Livre'], ocupada: ['info', 'Ocupada'], reservada: ['warn', 'Reservada'], conta: ['warn', 'Conta pedida'], limpeza: ['muted', 'Limpeza'],
};

export default function Floor() {
  const s = useSession();
  const [tab, setTab] = useState('mesas');
  return (
    <div>
      <PageHeader title="Salão" subtitle="Mesas, ocupação e cartões de comanda" />
      <div className="mb-4 flex gap-1 border-b border-line">
        {[['mesas', 'Mesas'], ['comandas', 'Cartões de comanda']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 font-semibold ${tab === k ? 'border-copper text-ink' : 'border-transparent text-muted'}`}>{l}</button>
        ))}
      </div>
      {tab === 'mesas' ? <Tables s={s} /> : <Cards s={s} />}
    </div>
  );
}

function Tables({ s }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => api('/api/floor/tables'));
  const [add, setAdd] = useState(false);
  const [sel, setSel] = useState(null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const tables = data.tables;
  const areas = [...new Set(tables.map((t) => t.area))];
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
          {s.can('pdv.lancar') && <button className="btn-primary btn-xl mt-3 w-full" onClick={() => openTable(sel)}>{sel.open_sessions ? 'Ir para o consumo' : 'Abrir mesa no PDV'}</button>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {['livre', 'reservada', 'limpeza'].map((k) => <button key={k} className="btn-ghost" disabled={sel.status === k || (k === 'livre' && sel.open_sessions > 0)} onClick={() => setStatus(sel, k)}>Marcar {STATUS[k][1].toLowerCase()}</button>)}
          </div>
          {sel.open_sessions > 0 && <p className="mt-2 text-xs text-muted">Mesa com consumo aberto não pode ser marcada como livre.</p>}
          {sel.code && <p className="mt-3 text-xs text-muted">Código da mesa: <span className="font-mono">{sel.code}</span></p>}
        </>}
      </Modal>
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
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const cards = data.cards;
  const manage = s.can('comandas.gerenciar');
  const block = async (c) => { const reason = prompt(`Motivo do bloqueio da comanda ${c.number}:`); if (!reason) return; try { await api(`/api/floor/cards/${c.id}/block`, { method: 'POST', body: { reason } }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const unblock = async (c) => { try { await api(`/api/floor/cards/${c.id}/unblock`, { method: 'POST' }); reload(); } catch (e) { toast(e.message, 'bad'); } };
  const print = () => {
    const w = window.open('', '_blank'); if (!w) return toast('Permita pop-ups para imprimir', 'warn');
    const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Comandas</title><style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 8px;text-align:left}</style>
      <h2>Relação de cartões de comanda</h2><p>Imprima os códigos em etiquetas Code 128 ou QR Code com o conteúdo exato da coluna "Código".</p><table><tr><th>Número</th><th>Código</th><th>Situação</th></tr>
      ${cards.map((c) => `<tr><td>${c.number}</td><td style="font-family:monospace">${esc(c.code)}</td><td>${c.status}</td></tr>`).join('')}</table><script>print()</script>`);
    w.document.close();
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        <Badge tone="ok">Livres: {cards.filter((c) => c.status === 'ativo' && !c.session_id).length}</Badge>
        <Badge tone="info">Em uso: {cards.filter((c) => c.session_id).length}</Badge>
        <Badge tone="bad">Bloqueadas: {cards.filter((c) => c.status === 'bloqueado').length}</Badge>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={print}><Printer size={16} /> Relação de códigos</button>
          {manage && <button className="btn-primary" onClick={() => setGen(true)}>Gerar em lote</button>}
        </div>
      </div>
      {!cards.length ? <Empty title="Nenhum cartão">Gere cartões numerados para usar comandas físicas.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Nº</th><th>Código</th><th>Situação</th><th>Consumo</th><th /></tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td className="font-display text-xl">{c.number}</td>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td>{c.status === 'bloqueado' ? <Badge tone="bad" icon={Lock}>Bloqueada{c.block_reason ? ` — ${c.block_reason}` : ''}</Badge> : c.session_id ? <Badge tone="info">Em uso</Badge> : <Badge tone="ok">Livre</Badge>}</td>
                  <td>{c.session_id ? <a className="underline" href={`/pdv?sessao=${c.session_id}`}>#{c.session_id}</a> : '—'}</td>
                  <td className="text-right">
                    {manage && c.status === 'ativo' && <button className="text-sm underline" onClick={() => block(c)}>bloquear</button>}
                    {manage && c.status === 'bloqueado' && <button className="text-sm underline" onClick={() => unblock(c)}><Unlock size={12} className="inline" /> desbloquear</button>}
                    {manage && c.session_id && <button className="ml-3 text-sm underline" onClick={() => setReplace(c)}>substituir (perdida)</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <GenCards open={gen} onClose={() => setGen(false)} next={Math.max(0, ...cards.map((c) => c.number)) + 1} onDone={reload} />
      <ReplaceCard card={replace} cards={cards} onClose={() => setReplace(null)} onDone={reload} />
    </>
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
