// Janelas do PDV: opções/peso, exceção autorizada, pagamento, cancelamento, transferência e pré-conta.
import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, NotebookPen, PiggyBank, QrCode, Receipt, Ticket, Zap } from 'lucide-react';
import { api, newKey } from '../lib/api.js';
import { money, parseCents, centsToInput, qtyFmt, bp } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, ErrorBox, Field, Modal, useAsk } from '../components/ui.jsx';
import { AccountBanner, AccountMoneyModal } from '../components/Account.jsx';
import { InfinitePayCharge } from '../components/InfinitePay.jsx';

// Autorização individual do gerente (e-mail + senha no terminal), uso único e validade curta
export function ManagerAuth({ action, reason, onToken }) {
  const [f, setF] = useState({ email: '', password: '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/admin/authorizations', { method: 'POST', body: { ...f, action, reason: reason || 'Autorização no PDV' } });
      onToken(r.authorization); setDone(true); setF({ email: '', password: '' });
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (done) return <Badge tone="ok">Autorizado — válido para esta operação</Badge>;
  return (
    <div className="rounded-lg border border-line bg-raised/50 p-3">
      <div className="mb-2 text-sm font-semibold">Autorização do gerente</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder="E-mail do gerente" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="input" type="password" placeholder="Senha" autoComplete="off" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
      </div>
      <button type="button" className="btn-ghost mt-2 w-full" onClick={go} disabled={busy} aria-disabled={(!f.email || !f.password) || undefined} data-why={'Informe e-mail e senha do gerente'}>{busy ? 'Conferindo…' : 'Autorizar'}</button>
      <div className="mt-2"><ErrorBox error={err} /></div>
    </div>
  );
}

/* Opções obrigatórias, peso e observação. O destino fica fixo enquanto a janela está aberta. */
export function OptionsModal({ open, product, destination, onCancel, onConfirm, askQty, initialQty = 1 }) {
  const [sel, setSel] = useState({});
  const [qty, setQty] = useState(String(initialQty));
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setSel({}); setQty(product?.kind === 'weight' ? '' : String(initialQty)); setNotes(''); setErr(null); } }, [open, product, initialQty]);
  if (!product) return null;
  const weight = product.kind === 'weight';
  const groups = product.groups || [];
  const toggle = (g, o) => setSel((s) => {
    const cur = s[g.id] || [];
    if (cur.includes(o.id)) return { ...s, [g.id]: cur.filter((x) => x !== o.id) };
    if (g.max === 1) return { ...s, [g.id]: [o.id] };
    if (cur.length >= g.max) return s;
    return { ...s, [g.id]: [...cur, o.id] };
  });
  const extra = groups.flatMap((g) => g.options.filter((o) => (sel[g.id] || []).includes(o.id))).reduce((a, o) => a + o.price_cents, 0);
  const confirm = () => {
    for (const g of groups) if ((sel[g.id] || []).length < g.min) return setErr(new Error(`Escolha ${g.min === 1 ? 'uma opção' : `${g.min} opções`} em "${g.name}"`));
    const q = Number(String(qty).replace(',', '.'));
    if (!(q > 0)) return setErr(new Error(weight ? 'Informe o peso' : 'Quantidade inválida'));
    if (!weight && !Number.isInteger(q)) return setErr(new Error('Quantidade deve ser inteira'));
    onConfirm({ option_ids: Object.values(sel).flat(), qty: q, notes: notes.trim() || undefined });
  };
  return (
    <Modal open={open} onClose={onCancel} title={product.name} guard={false}
      footer={<><button className="btn-ghost" onClick={onCancel}>Cancelar (Esc)</button><button className="btn-primary btn-xl" onClick={confirm}>Lançar {money(product.price_cents + extra)}{weight ? `/${product.unit}` : ''}</button></>}>
      <div className="mb-3 rounded-lg bg-raised p-2 text-sm">Destino fixo: <b>{destination}</b></div>
      {groups.map((g) => (
        <fieldset key={g.id} className="mb-4">
          <legend className="mb-2 font-semibold">{g.name} <span className="text-xs text-muted">{g.min > 0 ? `obrigatório · ` : 'opcional · '}{g.max === 1 ? 'escolha 1' : `até ${g.max}`}</span></legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {g.options.map((o) => {
              const on = (sel[g.id] || []).includes(o.id);
              return (
                <button key={o.id} type="button" aria-pressed={on} onClick={() => toggle(g, o)}
                  className={`min-h-[52px] rounded-lg border px-2 py-2 text-left text-sm font-medium ${on ? 'border-copper bg-copper/15 ring-2 ring-copper/40' : 'border-line hover:bg-raised'}`}>
                  {on ? '✓ ' : ''}{o.name}{o.price_cents > 0 && <span className="block text-xs text-muted">+ {money(o.price_cents)}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
      {(weight || askQty) && (
        <Field label={weight ? `Peso (${product.unit})` : 'Quantidade'}>
          <input className="input text-2xl" inputMode="decimal" autoFocus={weight} value={qty} onChange={(e) => setQty(e.target.value)} placeholder={weight ? 'ex.: 0,350' : '1'} />
        </Field>
      )}
      <Field label="Observação (vai para o preparo)" className="mt-3"><input className="input" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

export function ExceptionModal({ open, product, destination, requiresManager, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [token, setToken] = useState(null);
  useEffect(() => { if (open) { setReason(''); setToken(null); } }, [open]);
  const ok = reason.trim().length >= 3 && (!requiresManager || token);
  return (
    <Modal open={open} onClose={onCancel} title="Exceção manual"
      footer={<><button className="btn-ghost" onClick={onCancel}>Cancelar</button><button className="btn-primary" aria-disabled={(!ok) || undefined} data-why={reason.trim().length < 3 ? 'Escreva o motivo da exceção' : 'Falta a autorização do gerente'} onClick={() => onConfirm({ reason: reason.trim(), authorization: token })}>Lançar esta exceção</button></>}>
      <p className="text-sm">A dupla leitura é obrigatória. Esta exceção autoriza <b>somente este lançamento</b> de <b>{product?.name}</b> em <b>{destination}</b>; depois o PDV volta a exigir comanda e produto.</p>
      <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex.: etiqueta ilegível" /></Field>
      {requiresManager && <div className="mt-3"><ManagerAuth action="excecao_dupla_leitura" reason={reason} onToken={setToken} /></div>}
    </Modal>
  );
}

const METHODS = [
  ['dinheiro', 'Dinheiro', Banknote], ['pix', 'Pix', QrCode], ['debito', 'Débito', CreditCard],
  ['credito', 'Crédito', CreditCard], ['vale', 'Vale', Ticket], ['fiado', 'Fiado', NotebookPen],
];
// rótulos de pagamentos já registrados (inclui formas que não aparecem nos botões)
const METHOD_LABEL = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', vale: 'Vale', fiado: 'Fiado', saldo_cliente: 'Crédito do cliente', outro: 'Outro' };

export function PaymentModal({ open, session, onClose, onChanged }) {
  const s = useSession();
  const ask = useAsk();
  const [splitMode, setSplitMode] = useState(null); // null | 'iguais' | 'itens'
  const [picked, setPicked] = useState([]);
  const [method, setMethod] = useState('dinheiro');
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [parts, setParts] = useState(2);
  const [split, setSplit] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // operação com resposta incerta
  const [settle, setSettle] = useState(false);
  const [ip, setIp] = useState(null);
  useEffect(() => { if (open && s.can('pdv.receber')) api('/api/infinitepay/settings').then(setIp).catch(() => setIp(null)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = session?.totals;
  const acc = session?.account;
  useEffect(() => { if (open && t) { setAmount(centsToInput(Math.max(t.balance, 0))); setTendered(''); setErr(null); setSplit(null); setPicked([]); } }, [open, t?.balance]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setSplitMode(null); setMethod('dinheiro'); } }, [open]);
  if (!session) return null;
  const amountC = parseCents(amount);
  const tenderedC = parseCents(tendered);
  const change = method === 'dinheiro' && tenderedC && amountC ? tenderedC - amountC : 0;
  const methods = [...METHODS, ...(acc?.credit_cents > 0 ? [['saldo_cliente', 'Crédito do cliente', PiggyBank]] : []), ...(ip?.enabled ? [['infinitepay', 'InfinitePay (link/QR)', Zap]] : [])];
  const noCustomer = !session.customer_id;
  const fiadoAfter = acc ? acc.balance_cents - (amountC || 0) : null;
  const fiadoOver = method === 'fiado' && acc && -fiadoAfter > acc.fiado_limit_cents;
  const applyCredit = () => { setMethod('saldo_cliente'); setAmount(centsToInput(Math.min(acc.credit_cents, Math.max(t.balance, 0)))); };

  // Quando o pagamento quita o saldo, a conta já é encerrada no mesmo toque ("Registrar e encerrar")
  const pay = async (body = null) => {
    setBusy(true); setErr(null);
    const req = body || { method, amount_cents: amountC, tendered_cents: method === 'dinheiro' && tenderedC ? tenderedC : undefined, idempotency_key: newKey() };
    const settles = t.items > 0 && req.amount_cents >= t.balance;
    try {
      if (!req.amount_cents) throw new Error('Informe o valor a pagar');
      await api(`/api/pdv/sessions/${session.id}/payments`, { method: 'POST', body: req });
      setPending(null); setTendered(''); setSplit(null); setPicked([]);
      if (settles) {
        const full = await api(`/api/pdv/sessions/${session.id}`);
        if (full.totals.balance <= 0) {
          try { await api(`/api/pdv/sessions/${session.id}/close`, { method: 'POST', body: { version: full.version } }); await onChanged(true); onClose(); return; }
          catch (e2) { setErr(new Error(`Pagamento registrado, mas a conta não foi encerrada: ${e2.message}`)); }
        }
      }
      await onChanged();
    } catch (e) {
      if (e.uncertain) setPending(req); // repetir com a MESMA chave não duplica
      setErr(e);
    } finally { setBusy(false); }
  };
  const close = async () => {
    setBusy(true); setErr(null);
    try { await api(`/api/pdv/sessions/${session.id}/close`, { method: 'POST', body: { version: session.version } }); await onChanged(true); onClose(); }
    catch (e) { setErr(e); if (e.code === 'version_conflict') await onChanged(); } finally { setBusy(false); }
  };
  const refund = async (p) => {
    const reason = await ask.reason({ title: `Estornar ${money(p.amount_cents)}`, danger: true, confirmLabel: 'Estornar pagamento', reasons: ['Forma de pagamento errada', 'Valor errado', 'Lançado em duplicidade', 'Cliente desistiu'] });
    if (!reason) return;
    try { await api(`/api/pdv/payments/${p.id}/refund`, { method: 'POST', body: { reason } }); await onChanged(); } catch (e) { setErr(e); }
  };
  const doSplit = async (n = parts) => { try { setSplit(await api(`/api/pdv/sessions/${session.id}/split?parts=${n}`)); } catch (e) { setErr(e); } };
  // Dividir por itens: soma os itens marcados + a parte proporcional da taxa de serviço
  const activeItems = session.items.filter((i) => i.status === 'ativo');
  const pickedCents = activeItems.filter((i) => picked.includes(i.id)).reduce((a, i) => a + Number(i.total_cents), 0);
  const pickedWithFee = Math.round(pickedCents * (1 + (t.serviceFeeBp || 0) / 10000));
  const togglePick = (id) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    const c = activeItems.filter((i) => next.includes(i.id)).reduce((a, i) => a + Number(i.total_cents), 0);
    setAmount(centsToInput(Math.min(Math.round(c * (1 + (t.serviceFeeBp || 0) / 10000)), Math.max(t.balance, 0)) || Math.max(t.balance, 0)));
  };
  const quick = method === 'dinheiro' && amountC > 0 ? [...new Set([amountC, ...[1000, 2000, 5000, 10000, 20000].map((n) => Math.ceil(amountC / n) * n)])].filter((v) => v >= amountC).slice(0, 4) : [];
  const settlesNow = t.items > 0 && amountC >= t.balance;

  return (
    <Modal open={open} onClose={onClose} title={`Receber — ${sessionLabel(session)}`} wide guard={false}>
      <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
        <div className="order-2 md:order-1">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt>Consumo</dt><dd>{money(t.items)}</dd></div>
            <div className="flex justify-between"><dt>Taxa de serviço ({bp(t.serviceFeeBp)})</dt><dd>{money(t.serviceFee)}</dd></div>
            <div className="flex justify-between border-t border-line pt-1 text-base font-bold"><dt>Total</dt><dd>{money(t.total)}</dd></div>
            <div className="flex justify-between"><dt>Pago</dt><dd>{money(t.paid)}</dd></div>
            <div className={`flex justify-between font-display text-3xl ${t.balance > 0 ? 'text-rust' : 'text-ok'}`}><dt>Saldo</dt><dd>{money(t.balance)}</dd></div>
          </dl>
          <div className="mt-3">
            <div className="mb-1 text-sm font-semibold">Pagamentos</div>
            {!session.payments.length && <p className="text-sm text-muted">Nenhum pagamento ainda.</p>}
            <ul className="space-y-1 text-sm">
              {session.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>{METHOD_LABEL[p.method] || p.method}{p.source === 'integracao' ? ' · InfinitePay' : ''} {p.change_cents > 0 && <span className="text-xs text-muted">(troco {money(p.change_cents)})</span>}</span>
                  <span className="flex items-center gap-2">
                    {p.status === 'estornado' ? <Badge tone="bad">Estornado</Badge> : <Badge tone="ok">{money(p.amount_cents)}</Badge>}
                    {p.status === 'confirmado' && s.can('financeiro.estornar') && <button className="min-h-[36px] text-xs underline" onClick={() => refund(p)}>estornar</button>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {t.balance > 0 && (
            <div className="mt-4 rounded-lg border border-line p-3" data-no-dirty>
              <div className="text-sm font-semibold">Dividir a conta</div>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Como dividir">
                <button className={`btn ${splitMode === 'iguais' ? 'bg-copper text-white dark:text-black' : 'btn-ghost'}`} aria-pressed={splitMode === 'iguais'} onClick={() => { setSplitMode('iguais'); doSplit(); }}>Partes iguais</button>
                <button className={`btn ${splitMode === 'itens' ? 'bg-copper text-white dark:text-black' : 'btn-ghost'}`} aria-pressed={splitMode === 'itens'} onClick={() => setSplitMode('itens')} data-split-items>Por itens</button>
              </div>
              {splitMode === 'iguais' && (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Pessoas:</span>
                    <button className="tap rounded-lg border border-line" onClick={() => { const n = Math.max(2, parts - 1); setParts(n); doSplit(n); }} aria-label="Menos pessoas">−</button>
                    <span className="w-8 text-center font-display text-2xl">{parts}</span>
                    <button className="tap rounded-lg border border-line" onClick={() => { const n = Math.min(50, parts + 1); setParts(n); doSplit(n); }} aria-label="Mais pessoas">+</button>
                  </div>
                  {split && <div className="mt-2 flex flex-wrap gap-1">{split.parts.map((v, i) => <button key={i} className="chip min-h-[40px] border-line px-3" onClick={() => setAmount(centsToInput(v))}>Pessoa {i + 1}: {money(v)}</button>)}</div>}
                  <p className="mt-1 text-xs text-muted">Toque numa parte para usar o valor; registre um pagamento por pessoa.</p>
                </div>
              )}
              {splitMode === 'itens' && (
                <div className="mt-2">
                  <p className="text-xs text-muted">Marque o que esta pessoa vai pagar (a taxa de serviço entra proporcional).</p>
                  <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                    {activeItems.map((i) => (
                      <li key={i.id}><label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-2 hover:bg-raised">
                        <input type="checkbox" className="h-5 w-5" checked={picked.includes(i.id)} onChange={() => togglePick(i.id)} />
                        <span className="flex-1 text-sm">{qtyFmt(i.qty, i.unit)} × {i.description}</span><span className="text-sm">{money(i.total_cents)}</span>
                      </label></li>
                    ))}
                  </ul>
                  {picked.length > 0 && <p className="mt-1 text-sm font-semibold">Selecionado: {money(pickedWithFee)} <span className="font-normal text-muted">({money(pickedCents)} + taxa)</span></p>}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="order-1 md:order-2">
          <div className={`mb-3 flex items-baseline justify-between font-display text-3xl md:hidden ${t.balance > 0 ? 'text-rust' : 'text-ok'}`} data-balance-top>
            <span>Saldo</span><span>{money(t.balance)}</span>
          </div>
          {acc && <div className="mb-3"><AccountBanner account={acc} name={session.customer_name} onSettle={s.can('pdv.receber') ? () => setSettle(true) : null} onApplyCredit={t.balance > 0 ? applyCredit : null} /></div>}
          {t.balance > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                {methods.map(([k, label, Icon]) => (
                  <button key={k} aria-pressed={method === k} data-method={k} onClick={() => { setMethod(k); if (k === 'saldo_cliente') applyCredit(); }}
                    className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-lg border text-sm font-semibold ${method === k ? 'border-copper bg-copper/15 ring-2 ring-copper/40' : 'border-line hover:bg-raised'}`}>
                    <Icon size={20} />{label}
                  </button>
                ))}
              </div>
              <Field label="Valor a pagar" className="mt-3"><input className="input text-2xl" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-amount /></Field>
              {method === 'infinitepay' && <InfinitePayCharge key={`${session.id}-${amountC}`} session={session} amountC={amountC} phone={session.customer_phone} onPaid={() => onChanged()} />}
              {method === 'dinheiro' && (<>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Valor entregue pelo cliente">
                  {quick.map((v) => (
                    <button key={v} type="button" className={`chip min-h-[44px] px-3 text-sm ${tenderedC === v ? 'border-copper bg-copper/15' : 'border-line'}`} onClick={() => setTendered(centsToInput(v))} data-quick-cash={v}>
                      {v === amountC ? 'Valor exato' : money(v)}
                    </button>
                  ))}
                </div>
                <Field label="Valor entregue (para calcular o troco)" className="mt-2"><input className="input text-2xl" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="opcional" /></Field>
              </>)}
              {change > 0 && <div className="mt-2 font-display text-3xl text-ok">Troco {money(change)}</div>}
              {change < 0 && <div className="mt-2 text-sm text-rust">Valor entregue menor que o valor a pagar.</div>}
              {method === 'fiado' ? (
                noCustomer || !acc?.has_cpf ? <p className="mt-2 rounded-lg bg-warn/10 p-2 text-sm text-warn">Fiado é a conta para pagar depois. Para lançar, identifique o cliente pelo CPF (botão "identificar cliente" na conta).</p> : (
                  <div className={`mt-2 rounded-lg p-2 text-sm ${fiadoOver ? 'bg-rust/10 text-rust' : 'bg-raised'}`} data-fiado-info>
                    Vai para a conta de <b>{session.customer_name}</b>. Fiado depois deste: <b>{money(Math.max(0, -fiadoAfter))}</b> · limite {money(acc.fiado_limit_cents)}.
                    {fiadoOver && <div className="font-semibold">{s.can('pdv.autorizar') ? 'Acima do limite: será registrado como liberado por você (gerente).' : 'Acima do limite: peça a um gerente ou receba de outra forma.'}</div>}
                  </div>
                )
              ) : method === 'saldo_cliente' ? <p className="mt-2 text-xs text-muted">Usa o crédito antecipado do cliente (disponível {money(acc?.credit_cents)}). Não entra dinheiro no caixa agora.</p>
                : method !== 'dinheiro' && method !== 'infinitepay' && <p className="mt-2 text-xs text-muted">Registro informado pelo operador (passe na maquininha à parte). Cartão e Pix não geram troco.</p>}
              {method === 'infinitepay' ? null : pending ? (
                <button className="btn-primary btn-xl mt-3 w-full" disabled={busy} onClick={() => pay(pending)}>Resposta incerta — conferir e repetir sem duplicar</button>
              ) : (
                <button className="btn-primary btn-xl mt-3 w-full" disabled={busy} data-autofocus data-pay
                  onClick={() => {
                    if (!amountC) return setErr(new Error('Informe o valor a pagar'));
                    if (change < 0) return setErr(new Error('O valor entregue é menor que o valor a pagar'));
                    if (method === 'fiado' && (noCustomer || !acc?.has_cpf)) return setErr(new Error('Para fiado, identifique o cliente pelo CPF primeiro'));
                    return pay();
                  }}>
                  {busy ? 'Registrando…' : method === 'fiado' ? `Lançar ${amountC ? money(amountC) : ''} no fiado${settlesNow ? ' e encerrar' : ''}` : `Registrar ${amountC ? money(amountC) : ''}${settlesNow ? ' e encerrar' : ''}`}</button>
              )}
              {settlesNow && <p className="mt-1 text-center text-xs text-muted">Quita o saldo: a conta é encerrada e a mesa/comanda fica livre.</p>}
            </>
          ) : (
            <div className="card stripe p-4 text-center">
              <Receipt className="mx-auto text-ok" />
              <div className="font-display text-2xl">Saldo quitado</div>
              <button className="btn-primary btn-xl mt-3 w-full" disabled={busy} aria-disabled={(t.items === 0) || undefined} data-why={'Sem itens: use Cancelar consumo em Mais ações'} onClick={close} data-autofocus>Encerrar consumo</button>
              {t.items === 0 && <p className="mt-1 text-xs text-muted">Sem itens: use "Cancelar consumo" em Mais ações.</p>}
            </div>
          )}
          <div className="mt-3"><ErrorBox error={err} /></div>
        </div>
      </div>
      {acc && <AccountMoneyModal open={settle} mode="settle" customerId={session.customer_id} customerName={session.customer_name} debt={acc.debt_cents}
        onClose={() => setSettle(false)} onDone={async () => { setSettle(false); await onChanged(); }} />}
    </Modal>
  );
}

export function CancelItemModal({ open, item, onClose, onDone }) {
  const s = useSession();
  const [reason, setReason] = useState('');
  const [token, setToken] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setReason(''); setToken(null); setErr(null); } }, [open]);
  const needs = !s.can('pdv.cancelar_item');
  const go = async () => {
    try { const r = await api(`/api/pdv/items/${item.id}/cancel`, { method: 'POST', body: { reason, authorization: token || undefined } }); onDone(r); onClose(); }
    catch (e) { setErr(e); }
  };
  if (!item) return null;
  const prepared = ['preparando', 'pronto', 'entregue'].includes(item.kitchen_status);
  return (
    <Modal open={open} onClose={onClose} title="Cancelar item"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-danger" aria-disabled={(reason.trim().length < 3 || (needs && !token)) || undefined} data-why={reason.trim().length < 3 ? 'Escreva o motivo do cancelamento' : 'Falta a autorização do gerente'} onClick={go}>Cancelar item</button></>}>
      <p><b>{qtyFmt(item.qty, item.unit)} × {item.description}</b> — {money(item.total_cents)}</p>
      {prepared && <p className="mt-2 text-sm"><Badge tone="warn">Já preparado</Badge> O valor sai da conta; o destino físico (perda ou retorno ao estoque) será registrado no módulo de estoque.</p>}
      <div className="mt-3 flex flex-wrap gap-2">{['Lançado errado', 'Cliente desistiu', 'Demorou demais', 'Item em falta'].map((r) => (
        <button key={r} type="button" className={`min-h-[44px] rounded-full border px-3 text-sm font-semibold ${reason === r ? 'border-copper bg-copper/15' : 'border-line'}`} onClick={() => setReason(r)}>{r}</button>))}</div>
      <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="toque numa opção ou escreva" /></Field>
      {needs && <div className="mt-3"><ManagerAuth action="cancelar_item" reason={reason} onToken={setToken} /></div>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

export function TransferModal({ open, session, sessions, onClose, onDone }) {
  const [items, setItems] = useState([]);
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setItems([]); setTarget(''); setReason(''); setErr(null); } }, [open]);
  const active = useMemo(() => session?.items.filter((i) => i.status === 'ativo') || [], [session]);
  if (!session) return null;
  const go = async () => {
    try { await api('/api/pdv/items/transfer', { method: 'POST', body: { item_ids: items, target_session_id: Number(target), reason } }); onDone(); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Transferir itens"
      footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" aria-disabled={(!items.length || !target || reason.trim().length < 3) || undefined} data-why={!items.length ? 'Marque os itens a transferir' : !target ? 'Escolha para onde transferir' : 'Escreva o motivo'} onClick={go}>Transferir {items.length} item(ns)</button></>}>
      <div className="mb-2 flex gap-2 text-sm"><button className="underline" onClick={() => setItems(active.map((i) => i.id))}>Selecionar todos</button><button className="underline" onClick={() => setItems([])}>Limpar</button></div>
      <ul className="max-h-60 space-y-1 overflow-auto">
        {active.map((i) => (
          <li key={i.id}><label className="flex items-center gap-2 rounded p-1 hover:bg-raised">
            <input type="checkbox" checked={items.includes(i.id)} onChange={(e) => setItems((xs) => (e.target.checked ? [...xs, i.id] : xs.filter((x) => x !== i.id)))} />
            <span className="flex-1">{qtyFmt(i.qty, i.unit)} × {i.description}</span><span>{money(i.total_cents)}</span>
          </label></li>
        ))}
      </ul>
      <Field label="Para o consumo" className="mt-3">
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Selecione…</option>
          {sessions.filter((x) => x.id !== session.id && x.status === 'aberta').map((x) => <option key={x.id} value={x.id}>{sessionLabel(x)}</option>)}
        </select>
      </Field>
      <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

export const sessionLabel = (x) => (x.card_number ? `Comanda ${x.card_number}` : x.table_number ? `Mesa ${x.table_number}` : x.kind === 'balcao' ? `Balcão #${x.id}` : x.label || `Consumo #${x.id}`)
  + (x.customer_name ? ` · ${x.customer_name}` : '') + (x.table_number && x.card_number ? ` · Mesa ${x.table_number}` : '');

// Pré-conta impressa: identificada como NÃO FISCAL
export function printPrecheck(session, companyName, tz) {
  const w = window.open('', '_blank', 'width=380,height=640');
  if (!w) return false;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = session.items.filter((i) => i.status === 'ativo').map((i) =>
    `<tr><td>${esc(qtyFmt(i.qty, i.unit))} × ${esc(i.description)}${i.modifiers?.length ? `<br><small>${esc(i.modifiers.map((m) => m.name).join(', '))}</small>` : ''}</td><td style="text-align:right">${esc(money(i.total_cents))}</td></tr>`).join('');
  const t = session.totals;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pré-conta</title>
    <style>body{font-family:monospace;font-size:12px;margin:12px}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}h1{font-size:14px;margin:0}.b{border-top:1px dashed #000;margin:6px 0}</style></head><body>
    <h1>${esc(companyName)}</h1><div><b>PRÉ-CONTA — NÃO É DOCUMENTO FISCAL</b></div><div>${esc(sessionLabel(session))}</div>
    <div>${new Date().toLocaleString('pt-BR', { timeZone: tz })}</div><div class="b"></div><table>${rows}</table><div class="b"></div>
    <table><tr><td>Consumo</td><td style="text-align:right">${esc(money(t.items))}</td></tr>
    <tr><td>Taxa de serviço (${esc(bp(t.serviceFeeBp))}) — opcional</td><td style="text-align:right">${esc(money(t.serviceFee))}</td></tr>
    <tr><td><b>Total</b></td><td style="text-align:right"><b>${esc(money(t.total))}</b></td></tr>
    <tr><td>Pago</td><td style="text-align:right">${esc(money(t.paid))}</td></tr>
    <tr><td><b>A pagar</b></td><td style="text-align:right"><b>${esc(money(t.balance))}</b></td></tr></table>
    <div class="b"></div><div>Documento sem valor fiscal.</div></body></html>`);
  w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250); // impressão disparada daqui: a CSP não permite script embutido na janela
  return true;
}
