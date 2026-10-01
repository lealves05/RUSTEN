// Conta do cliente (crédito e fiado): resumo, receber fiado / lançar crédito, ajuste, limite e extrato.
import { useEffect, useState } from 'react';
import { HandCoins, NotebookPen, PiggyBank } from 'lucide-react';
import { api, newKey } from '../lib/api.js';
import { money, parseCents, centsToInput, dateTime } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, ErrorBox, Field, Loading, Modal, useLoad, useToast } from './ui.jsx';

const MONEY_METHODS = [['dinheiro', 'Dinheiro'], ['pix', 'Pix'], ['debito', 'Débito'], ['credito', 'Crédito']];
const daysSince = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : 0);

/** Faixa para o recebimento/salão: fiado em aberto (vermelho) ou crédito disponível (verde). */
export function AccountBanner({ account, name, onSettle, onApplyCredit, compact }) {
  if (!account || !account.balance_cents) return null;
  const debt = account.balance_cents < 0;
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm ${debt ? 'border-rust/50 bg-rust/10' : 'border-ok/50 bg-ok/10'}`} data-account-banner={debt ? 'debito' : 'credito'}>
      {debt ? <NotebookPen size={18} className="text-rust" /> : <PiggyBank size={18} className="text-ok" />}
      <div className="flex-1">
        <b className={debt ? 'text-rust' : 'text-ok'}>{debt ? `Fiado em aberto: ${money(account.debt_cents)}` : `Crédito disponível: ${money(account.credit_cents)}`}</b>
        {!compact && <div className="text-xs text-muted">{name}{debt && account.open_since ? ` · em aberto há ${daysSince(account.open_since)} dia(s)` : ''}</div>}
      </div>
      {debt && onSettle && <button className="btn-ghost py-1 text-xs" onClick={onSettle}>Receber o fiado</button>}
      {!debt && onApplyCredit && <button className="btn-ghost py-1 text-xs" onClick={onApplyCredit}>Usar crédito</button>}
    </div>
  );
}

/** Receber fiado ou lançar crédito: dinheiro entra no caixa aberto pela forma escolhida. */
export function AccountMoneyModal({ open, mode, customerId, customerName, debt = 0, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('dinheiro');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey());
  useEffect(() => { if (open) { setAmount(mode === 'settle' && debt ? centsToInput(debt) : ''); setMethod('dinheiro'); setReason(''); setErr(null); setKey(newKey()); } }, [open, mode, debt]);
  if (!open) return null;
  const cents = parseCents(amount);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api(`/api/accounts/customers/${customerId}/${mode === 'settle' ? 'settle' : 'credit'}`, { method: 'POST', body: { amount_cents: cents, method, reason: reason.trim() || undefined, idempotency_key: key } });
      toast(mode === 'settle' ? `Fiado recebido: ${money(cents)}` : `Crédito lançado: ${money(cents)}`);
      onDone(r);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={mode === 'settle' ? `Receber fiado — ${customerName}` : `Lançar crédito — ${customerName}`}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={!cents || busy} onClick={go} data-account-confirm>{busy ? 'Registrando…' : `Registrar ${cents ? money(cents) : ''}`}</button></>}>
      {mode === 'settle' ? <p className="mb-3 text-sm">Fiado em aberto: <b className="text-rust">{money(debt)}</b>. Pode receber parte ou tudo.</p>
        : <p className="mb-3 text-sm text-muted">O cliente deixa um valor antecipado; ele é usado depois como forma de pagamento ("Crédito do cliente") em qualquer comanda dele.</p>}
      <div className="grid grid-cols-4 gap-2">
        {MONEY_METHODS.map(([k, l]) => <button key={k} aria-pressed={method === k} onClick={() => setMethod(k)} className={`rounded-lg border py-2 text-sm font-semibold ${method === k ? 'border-copper bg-copper/15' : 'border-line hover:bg-raised'}`}>{l}</button>)}
      </div>
      <Field label="Valor" className="mt-3"><input className="input text-2xl" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-account-amount /></Field>
      <Field label="Observação (opcional)" className="mt-2"><input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="mt-2 text-xs text-muted">Entra no caixa aberto deste terminal, na forma escolhida, e aparece no fechamento.</p>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

/** Seção completa da conta na ficha do cliente. */
export function AccountPanel({ customerId, customerName, onChanged }) {
  const s = useSession();
  const toast = useToast();
  const a = useLoad(() => api(`/api/accounts/customers/${customerId}`), [customerId]);
  const [modal, setModal] = useState(null);
  const [limit, setLimit] = useState(null);
  if (a.loading && !a.data) return <Loading />;
  if (!a.data) return <ErrorBox error={a.error} onRetry={a.reload} />;
  const d = a.data;
  const reload = () => { a.reload(); onChanged?.(); };
  const adjust = async () => {
    const v = prompt('Ajuste em R$ (use sinal: 50 aumenta o crédito, -50 aumenta o fiado):'); if (!v) return;
    const cents = parseCents(v.replace('-', '')); if (!cents) return;
    const reason = prompt('Motivo do ajuste (mín. 10 caracteres):'); if (!reason) return;
    try { await api(`/api/accounts/customers/${customerId}/adjust`, { method: 'POST', body: { amount_cents: v.trim().startsWith('-') ? -cents : cents, reason } }); toast('Ajuste registrado'); reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  const reverse = async (e) => {
    const reason = prompt('Motivo do estorno:'); if (!reason) return;
    try { await api(`/api/accounts/entries/${e.id}/reverse`, { method: 'POST', body: { reason } }); toast('Lançamento estornado'); reload(); } catch (x) { toast(x.message, 'bad'); }
  };
  const saveLimit = async () => {
    try { await api(`/api/accounts/customers/${customerId}/limit`, { method: 'PUT', body: { fiado_limit_cents: parseCents(limit) ?? 0 } }); setLimit(null); toast('Limite de fiado salvo'); reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <div className="space-y-3" data-account-panel>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className={`rounded-lg p-3 ${d.balance_cents < 0 ? 'bg-rust/10' : d.balance_cents > 0 ? 'bg-ok/10' : 'bg-raised'}`}>
          <div className="text-xs uppercase text-muted">{d.balance_cents < 0 ? 'Fiado em aberto' : d.balance_cents > 0 ? 'Crédito disponível' : 'Saldo da conta'}</div>
          <div className={`font-display text-3xl ${d.balance_cents < 0 ? 'text-rust' : d.balance_cents > 0 ? 'text-ok' : ''}`}>{money(Math.abs(d.balance_cents))}</div>
          {d.open_since && <div className="text-xs text-muted">em aberto há {daysSince(d.open_since)} dia(s)</div>}
        </div>
        <div className="rounded-lg bg-raised p-3">
          <div className="text-xs uppercase text-muted">Limite de fiado</div>
          {limit == null ? <div className="flex items-center gap-2"><span className="font-display text-3xl">{money(d.fiado_limit_cents)}</span>
            {s.can('pdv.autorizar') && s.can('clientes.gerenciar') && <button className="text-xs underline" onClick={() => setLimit(centsToInput(d.fiado_limit_cents))}>alterar</button>}</div>
            : <div className="mt-1 flex gap-1"><input className="input py-1" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /><button className="btn-primary py-1 text-xs" onClick={saveLimit}>Salvar</button></div>}
          <div className="text-xs text-muted">{d.fiado_limit_cents ? 'Acima disso, só com gerente' : 'Sem limite: fiado só com gerente'}</div>
        </div>
        <div className="flex flex-col gap-2">
          {!d.has_cpf && <Badge tone="warn">Cadastre o CPF para usar a conta</Badge>}
          {s.can('pdv.receber') && d.debt_cents > 0 && <button className="btn-primary" disabled={!d.has_cpf} onClick={() => setModal('settle')}><HandCoins size={16} /> Receber fiado</button>}
          {s.can('pdv.receber') && <button className="btn-ghost" disabled={!d.has_cpf} onClick={() => setModal('credit')} data-account-credit><PiggyBank size={16} /> Lançar crédito</button>}
          {s.can('pdv.autorizar') && s.can('clientes.gerenciar') && <button className="text-xs underline" onClick={adjust}>ajuste gerencial</button>}
        </div>
      </div>
      {!d.entries.length ? <p className="text-sm text-muted">Nenhum lançamento na conta.</p> : (
        <table className="table-clean"><thead><tr><th>Data</th><th>Lançamento</th><th className="text-right">Valor</th><th /></tr></thead>
          <tbody>{d.entries.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap">{dateTime(e.created_at, s.tz)}</td>
              <td>{e.label}{e.method ? ` · ${MONEY_METHODS.find((m) => m[0] === e.method)?.[1]}` : ''}{e.session_id ? ` · consumo #${e.session_id}` : ''}
                {e.over_limit && <span className="ml-1"><Badge tone="warn">acima do limite</Badge></span>}
                <div className="text-xs text-muted">{e.reason}{e.user_name ? ` · ${e.user_name}` : ''}{e.reversed ? ' · estornado' : ''}</div></td>
              <td className={`text-right font-mono ${e.amount_cents < 0 ? 'text-rust' : 'text-ok'}`}>{e.amount_cents > 0 ? '+' : '−'}{money(Math.abs(e.amount_cents))}</td>
              <td>{['credito', 'pagamento_fiado', 'ajuste'].includes(e.kind) && !e.reversed && s.can('financeiro.estornar') && <button className="text-xs underline" onClick={() => reverse(e)}>estornar</button>}</td>
            </tr>
          ))}</tbody></table>
      )}
      <p className="text-xs text-muted">Valores positivos aumentam o crédito do cliente; negativos são fiado. Lançamentos não são editados nem apagados: correções são feitas por estorno ou ajuste, com motivo e registro na auditoria.</p>
      <AccountMoneyModal open={!!modal} mode={modal} customerId={customerId} customerName={customerName} debt={d.debt_cents} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />
    </div>
  );
}

/** Lista das contas em aberto (fiado a receber e créditos). */
export function OpenAccountsModal({ open, onClose, onPick }) {
  const r = useLoad(() => (open ? api('/api/accounts/open') : Promise.resolve(null)), [open]);
  if (!open) return null;
  return (
    <Modal open wide onClose={onClose} title="Fiado e créditos em aberto">
      {r.loading ? <Loading /> : r.data && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-rust/10 p-3"><div className="text-xs uppercase text-muted">Fiado a receber</div><div className="font-display text-3xl text-rust">{money(r.data.debt_cents)}</div></div>
            <div className="rounded-lg bg-ok/10 p-3"><div className="text-xs uppercase text-muted">Créditos de clientes</div><div className="font-display text-3xl text-ok">{money(r.data.credit_cents)}</div></div>
          </div>
          {!r.data.items.length ? <p className="text-sm text-muted">Nenhuma conta em aberto.</p> : (
            <table className="table-clean"><thead><tr><th>Cliente</th><th>CPF</th><th className="text-right">Saldo</th><th>Fiado desde</th></tr></thead>
              <tbody>{r.data.items.map((c) => (
                <tr key={c.id} className="cursor-pointer hover:bg-raised" onClick={() => onPick?.(c.id)}>
                  <td className="font-semibold">{c.name}</td><td className="text-muted">{c.cpf || '—'}</td>
                  <td className={`text-right font-mono ${c.balance_cents < 0 ? 'text-rust' : 'text-ok'}`}>{c.balance_cents < 0 ? `deve ${money(-c.balance_cents)}` : `crédito ${money(c.balance_cents)}`}</td>
                  <td className="text-xs text-muted">{c.balance_cents < 0 && c.first_fiado ? `${daysSince(c.first_fiado)} dia(s)` : ''}</td>
                </tr>
              ))}</tbody></table>
          )}
        </>
      )}
    </Modal>
  );
}
