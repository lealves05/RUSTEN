// Caixa do terminal: abertura, sangria/suprimento/despesa, fechamento cego com contador de cédulas e histórico.
import { useState } from 'react';
import { Banknote } from 'lucide-react';
import { api, terminal } from '../lib/api.js';
import { prefs } from '../lib/prefs.js';
import { money, parseCents, centsToInput, dateTime, dateBR } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useLoad, useToast } from '../components/ui.jsx';

const DENOMS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5];
const ALL_METHODS = [['dinheiro', 'Dinheiro'], ['pix', 'Pix'], ['debito', 'Débito'], ['credito', 'Crédito'], ['vale', 'Vale'], ['outro', 'Outro']];
// "Outro" foi substituído por "Fiado": só aparece se ainda houver valor antigo nesta forma
const shownMethods = (exp) => ALL_METHODS.filter(([k]) => k !== 'outro' || Number(exp?.[k] || 0) !== 0);
const METHODS = ALL_METHODS.filter(([k]) => k !== 'outro');

export default function Cash() {
  const s = useSession();
  const toast = useToast();
  const cur = useLoad(() => api('/api/cash/current'));
  const hist = useLoad(() => (s.can('financeiro.visualizar') ? api('/api/cash') : Promise.resolve(null)));
  const lastKey = `rusten.cash.opening.${terminal.id || 'x'}`;
  const [opening, setOpening] = useState(() => prefs.get(lastKey, '0,00')); // sugere o troco usado na última abertura deste terminal
  const [mov, setMov] = useState(null);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  if (cur.loading) return <Loading />;
  if (cur.error) return <ErrorBox error={cur.error} onRetry={cur.reload} />;
  const c = cur.data;
  const open = async () => {
    setErr(null);
    try { const v = parseCents(opening); if (v == null) throw new Error('Valor inválido'); await api('/api/cash/open', { method: 'POST', body: { opening_cents: v } }); prefs.set(lastKey, centsToInput(v)); toast('Caixa aberto'); cur.reload(); hist.reload(); }
    catch (e) { setErr(e); }
  };
  return (
    <div>
      <PageHeader title="Caixa" subtitle="Caixa deste terminal. Consumo lançado não é recebimento: só pagamentos confirmados entram no caixa."
        actions={s.can('financeiro.visualizar') && s.hasModule('infinitepay') && <><a className="btn-ghost" href="/financeiro/maquininha" data-pos-link>Vendas da maquininha</a><a className="btn-ghost" href="/financeiro/infinitepay" data-ip-link>Cobranças InfinitePay</a></>} />
      {result && (
        <div className="card mb-4 p-4">
          <h2 className="font-display text-2xl">Caixa fechado</h2>
          <table className="table-clean mt-2"><thead><tr><th>Forma</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr></thead>
            <tbody>{shownMethods(result.expected).map(([k, l]) => <tr key={k}><td>{l}</td><td className="text-right">{money(result.expected[k])}</td><td className="text-right">{money(result.counted[k] || 0)}</td>
              <td className={`text-right ${result.by_method[k] ? 'font-bold text-rust' : ''}`}>{money(result.by_method[k])}</td></tr>)}</tbody></table>
          <p className="mt-2 font-semibold">Diferença total: {money(result.difference_cents)}</p>
        </div>
      )}
      {!c.open ? (
        s.can('caixa.abrir') ? (
          <div className="card max-w-md p-5">
            <div className="flex items-center gap-2"><Banknote className="text-copper" /><h2 className="font-display text-2xl">Abrir caixa</h2></div>
            <Field label="Troco inicial (R$)" hint="Dinheiro que já está na gaveta para dar troco. Sugerimos o valor da última abertura deste terminal." className="mt-3"><input className="input text-2xl" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} data-autofocus /></Field>
            <div className="mt-2 flex flex-wrap gap-2">{[0, 5000, 10000, 20000].map((v) => <button key={v} type="button" className="chip min-h-[40px] border-line px-3" onClick={() => setOpening(centsToInput(v))}>{money(v)}</button>)}</div>
            <button className="btn-primary btn-xl mt-3 w-full" onClick={open}>Abrir caixa</button>
            <div className="mt-3"><ErrorBox error={err} /></div>
          </div>
        ) : <Empty title="Caixa fechado">Peça a um operador de caixa para abrir.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5">
            <div className="flex items-center justify-between"><h2 className="font-display text-2xl">Caixa aberto</h2><Badge tone="ok">Aberto</Badge></div>
            <p className="text-sm text-muted">Por {c.cash.user_name} em {dateTime(c.cash.opened_at, s.tz)} · dia comercial {dateBR(c.cash.business_date)} · troco inicial {money(c.cash.opening_cents)}</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {s.can('caixa.sangria') && <button className="btn-ghost flex-col gap-0 py-2" onClick={() => setMov('sangria')}>Sangria<span className="text-[11px] font-normal text-muted">tirar dinheiro</span></button>}
              {s.can('caixa.suprimento') && <button className="btn-ghost flex-col gap-0 py-2" onClick={() => setMov('suprimento')}>Suprimento<span className="text-[11px] font-normal text-muted">pôr troco</span></button>}
              {s.can('caixa.sangria') && <button className="btn-ghost flex-col gap-0 py-2" onClick={() => setMov('despesa')}>Despesa<span className="text-[11px] font-normal text-muted">pagar algo</span></button>}
            </div>
            {s.can('caixa.fechar') && <button className="btn-danger btn-xl mt-4 w-full" onClick={() => setClosing(true)}>Fechar caixa</button>}
          </div>
          {c.expected ? (
            <div className="card p-5">
              <h2 className="font-display text-2xl">Esperado agora</h2>
              <table className="table-clean mt-2"><tbody>{shownMethods(c.expected.byMethod).map(([k, l]) => <tr key={k}><td>{l}</td><td className="text-right">{money(c.expected.byMethod[k])}</td></tr>)}
                <tr data-cash-fiado><td>Fiado <span className="text-xs text-muted">(a receber, não entra na contagem)</span></td><td className="text-right text-warn">{money(c.expected.info?.fiado || 0)}</td></tr>
                {!!c.expected.info?.saldo_cliente && <tr><td>Crédito de cliente usado <span className="text-xs text-muted">(já recebido antes)</span></td><td className="text-right text-muted">{money(c.expected.info.saldo_cliente)}</td></tr>}
              </tbody></table>
              <p className="mt-2 text-xs text-muted">Dinheiro = troco inicial + recebimentos em dinheiro + suprimentos − sangrias − despesas. Crédito lançado e fiado recebido entram na forma usada{Object.values(c.expected.account_in || {}).some(Boolean) ? ` (${money(Object.values(c.expected.account_in).reduce((a, b) => a + b, 0))} hoje)` : ''}.</p>
            </div>
          ) : <div className="card stripe p-5 text-sm"><b>Fechamento cego.</b> O valor esperado só aparece após a contagem.</div>}
        </div>
      )}
      {hist.data && (
        <section className="mt-6">
          <h2 className="font-display text-2xl">Histórico</h2>
          <div className="card mt-2 overflow-x-auto"><table className="table-clean">
            <thead><tr><th>Dia</th><th>Terminal</th><th>Operador</th><th>Situação</th><th className="text-right">Diferença</th><th>Justificativa</th></tr></thead>
            <tbody>{hist.data.map((h) => (
              <tr key={h.id}><td>{dateBR(h.business_date)}</td><td>{h.terminal_name || '—'}</td><td>{h.user_name}</td>
                <td>{h.status === 'aberto' ? <Badge tone="ok">Aberto</Badge> : <Badge tone="muted">Fechado</Badge>}</td>
                <td className={`text-right ${h.difference_cents ? 'text-rust font-semibold' : ''}`}>{h.difference_cents == null ? '—' : money(h.difference_cents)}</td><td>{h.justification || ''}</td></tr>
            ))}</tbody></table></div>
        </section>
      )}
      <MovementModal kind={mov} cashId={c.cash?.id} onClose={() => setMov(null)} onDone={() => { toast('Movimento registrado'); cur.reload(); }} />
      <CloseModal open={closing} cashId={c.cash?.id} onClose={() => setClosing(false)} onDone={(r) => { setResult(r); setClosing(false); cur.reload(); hist.reload(); }} />
    </div>
  );
}

function MovementModal({ kind, cashId, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  if (!kind) return null;
  const go = async () => {
    try { const v = parseCents(amount); if (!v) throw new Error('Informe o valor');
      await api(`/api/cash/${cashId}/movements`, { method: 'POST', body: { kind, amount_cents: v, reason } }); setAmount(''); setReason(''); onDone(); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={{ sangria: 'Sangria', suprimento: 'Suprimento', despesa: 'Despesa de caixa' }[kind]}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={() => (reason.trim().length < 3 ? setErr(new Error('Escreva o motivo (mínimo de 3 letras)')) : go())}>Registrar</button></>}>
      <p className="mb-3 text-sm text-muted">{{ sangria: 'Retirada de dinheiro da gaveta (ex.: levar ao cofre ou ao banco).', suprimento: 'Entrada de dinheiro na gaveta para ter troco.', despesa: 'Pagamento feito com o dinheiro do caixa (ex.: gelo, entregador).' }[kind]}</p>
      <Field label="Valor (R$)"><input className="input text-2xl" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function CloseModal({ open, cashId, onClose, onDone }) {
  const [byNote, setByNote] = useState(() => prefs.get('rusten.cash.count', 'cedulas') === 'cedulas');
  const [cashTyped, setCashTyped] = useState('');
  const [notes, setNotes] = useState({});
  const [counted, setCounted] = useState({ pix: '', debito: '', credito: '', vale: '' });
  const [just, setJust] = useState('');
  const [err, setErr] = useState(null);
  const cashTotal = byNote ? DENOMS.reduce((sum, d) => sum + d * (Number(notes[d]) || 0), 0) : (parseCents(cashTyped || '0') ?? 0);
  const go = async () => {
    setErr(null);
    try {
      const body = { counted: { dinheiro: cashTotal }, notes: !byNote ? {} : Object.fromEntries(Object.entries(notes).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])), justification: just || undefined };
      for (const [k, v] of Object.entries(counted)) { const c = parseCents(v || '0'); if (c == null) throw new Error(`Valor inválido em ${k}`); body.counted[k] = c; }
      onDone(await api(`/api/cash/${cashId}/close`, { method: 'POST', body }));
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Fechar caixa (conferência cega)" wide
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-danger" onClick={go}>Conferir e fechar</button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">Dinheiro na gaveta</h3>
          <div className="mt-2 flex rounded-lg border border-line bg-surface p-0.5" role="radiogroup" aria-label="Como contar o dinheiro" data-no-dirty>
            {[[true, 'Contar por cédula'], [false, 'Informar o total']].map(([v, l]) => (
              <button key={l} type="button" role="radio" aria-checked={byNote === v} onClick={() => { setByNote(v); prefs.set('rusten.cash.count', v ? 'cedulas' : 'total'); }}
                className={`min-h-[40px] flex-1 rounded-md px-2 text-sm font-semibold ${byNote === v ? 'bg-copper text-white dark:text-black' : 'text-muted'}`}>{l}</button>
            ))}
          </div>
          {byNote ? (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DENOMS.map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm"><span className="w-16 shrink-0 text-right">{money(d)}</span>
                  <input className="input min-w-0 py-1" type="number" inputMode="numeric" min={0} placeholder="0" value={notes[d] || ''} onChange={(e) => setNotes({ ...notes, [d]: e.target.value })} aria-label={`Quantidade de ${money(d)}`} /></label>
              ))}
            </div>
          ) : (
            <Field label="Total em dinheiro contado (R$)" className="mt-2"><input className="input text-2xl" inputMode="decimal" value={cashTyped} onChange={(e) => setCashTyped(e.target.value)} placeholder="0,00" data-cash-total /></Field>
          )}
          <div className="mt-2 font-display text-2xl">Contado: {money(cashTotal)}</div>
        </div>
        <div>
          <h3 className="font-semibold">Demais formas (comprovantes)</h3>
          <p className="text-xs text-muted">Some os comprovantes da maquininha e do Pix de cada forma.</p>
          {METHODS.filter(([k]) => k !== 'dinheiro').map(([k, l]) => (
            <Field key={k} label={l} className="mt-2"><input className="input" inputMode="decimal" placeholder={centsToInput(0)} value={counted[k]} onChange={(e) => setCounted({ ...counted, [k]: e.target.value })} /></Field>
          ))}
          <Field label="Justificativa (obrigatória se houver diferença)" className="mt-3"><textarea className="input" rows={2} value={just} onChange={(e) => setJust(e.target.value)} /></Field>
        </div>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
