// Caixa do terminal: abertura, sangria/suprimento/despesa, fechamento cego com contador de cédulas e histórico.
import { useState } from 'react';
import { Banknote } from 'lucide-react';
import { api } from '../lib/api.js';
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
  const [opening, setOpening] = useState('0,00');
  const [mov, setMov] = useState(null);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  if (cur.loading) return <Loading />;
  if (cur.error) return <ErrorBox error={cur.error} onRetry={cur.reload} />;
  const c = cur.data;
  const open = async () => {
    setErr(null);
    try { const v = parseCents(opening); if (v == null) throw new Error('Valor inválido'); await api('/api/cash/open', { method: 'POST', body: { opening_cents: v } }); toast('Caixa aberto'); cur.reload(); hist.reload(); }
    catch (e) { setErr(e); }
  };
  return (
    <div>
      <PageHeader title="Caixa" subtitle="Caixa deste terminal. Consumo lançado não é recebimento: só pagamentos confirmados entram no caixa." />
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
            <Field label="Troco inicial (R$)" className="mt-3"><input className="input text-2xl" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
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
              {s.can('caixa.sangria') && <button className="btn-ghost" onClick={() => setMov('sangria')}>Sangria</button>}
              {s.can('caixa.suprimento') && <button className="btn-ghost" onClick={() => setMov('suprimento')}>Suprimento</button>}
              {s.can('caixa.sangria') && <button className="btn-ghost" onClick={() => setMov('despesa')}>Despesa</button>}
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
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={reason.trim().length < 3} onClick={go}>Registrar</button></>}>
      <Field label="Valor (R$)"><input className="input text-2xl" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function CloseModal({ open, cashId, onClose, onDone }) {
  const [notes, setNotes] = useState({});
  const [counted, setCounted] = useState({ pix: '', debito: '', credito: '', vale: '' });
  const [just, setJust] = useState('');
  const [err, setErr] = useState(null);
  const cashTotal = DENOMS.reduce((sum, d) => sum + d * (Number(notes[d]) || 0), 0);
  const go = async () => {
    setErr(null);
    try {
      const body = { counted: { dinheiro: cashTotal }, notes: Object.fromEntries(Object.entries(notes).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])), justification: just || undefined };
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
          <div className="mt-2 grid grid-cols-2 gap-2">
            {DENOMS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm"><span className="w-20 text-right">{money(d)}</span>
                <input className="input py-1" type="number" min={0} value={notes[d] || ''} onChange={(e) => setNotes({ ...notes, [d]: e.target.value })} aria-label={`Quantidade de ${money(d)}`} /></label>
            ))}
          </div>
          <div className="mt-2 font-display text-2xl">Contado: {money(cashTotal)}</div>
        </div>
        <div>
          <h3 className="font-semibold">Demais formas (comprovantes)</h3>
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
