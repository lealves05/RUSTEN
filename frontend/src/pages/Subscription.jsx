// Assinatura e plano (mesmo portal do TORVEN): situação, contratação, troca, renovação, cancelamento e histórico.
// Cobrança e prazos são da central da plataforma (MASTER do ORBI); o cartão nunca passa pelo RUSTEN nem pela central.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpDown, CreditCard, ExternalLink, FileText, Receipt, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Logo, Modal, useLoad, useToast } from '../components/ui.jsx';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = (v) => (v == null ? '—' : brl.format(Number(v)));
const day = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
export const STATUS_LABEL = {
  ACTIVE: 'Ativa', TRIAL: 'Em teste', PAYMENT_PENDING: 'Aguardando pagamento', PAST_DUE: 'Pagamento pendente',
  SUSPENDED: 'Suspensa', CANCELED: 'Cancelada', EXPIRED: 'Expirada', DEMO: 'Demonstração', sem_central: 'Acesso liberado',
};
const STATUS_TONE = { ACTIVE: 'ok', TRIAL: 'info', PAST_DUE: 'warn', PAYMENT_PENDING: 'warn', DEMO: 'info', sem_central: 'muted' };
const PAY_LABEL = { PENDING: 'Pendente', CONFIRMED: 'Pago', OVERDUE: 'Vencido', FAILED: 'Recusado', REFUNDED: 'Estornado', CHARGEBACK: 'Contestado', CANCELED: 'Cancelado' };
const CYCLE = { MONTHLY: 'Mensal', ANNUAL: 'Anual' };
const TRIAL = { '15_DAYS': '15 dias', '30_DAYS': '30 dias', UNLIMITED: 'Sem prazo', CUSTOM: 'Personalizado' };
const REASON = { ADMINISTRATIVO: 'Bloqueio administrativo', FINANCEIRO: 'Pendência financeira', TRIAL_EXPIRADO: 'Período de teste encerrado', CANCELAMENTO: 'Assinatura cancelada' };
const priceFor = (p, cycle) => Number(cycle === 'ANNUAL' ? p?.annual_price : p?.monthly_price) || 0;
const openCheckout = (url) => { if (url && /^https:\/\//.test(url)) window.location.assign(url); };

export function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || 'bad';
  return <Badge tone={tone}>{STATUS_LABEL[status] || status || '—'}</Badge>;
}

function PlanPicker({ plans, value, cycle, onChange, onCycle }) {
  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg border border-line bg-raised p-1" role="radiogroup" aria-label="Ciclo de cobrança">
        {['MONTHLY', 'ANNUAL'].map((c) => (
          <button key={c} type="button" role="radio" aria-checked={cycle === c} onClick={() => onCycle(c)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${cycle === c ? 'bg-surface shadow' : 'text-muted'}`}>
            {c === 'MONTHLY' ? 'Mensal (recorrente)' : 'Anual (pagamento único)'}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((p) => {
          const price = priceFor(p, cycle);
          return (
            <button key={p.id} type="button" disabled={!price} onClick={() => onChange(p.id)} aria-pressed={value === p.id}
              className={`card p-4 text-left transition disabled:opacity-50 ${value === p.id ? 'border-copper ring-2 ring-copper/30' : 'hover:border-copper/60'}`}>
              <div className="font-semibold">{p.name}</div>
              {p.description && <p className="mt-1 text-xs text-muted">{p.description}</p>}
              <div className="mt-3 text-lg font-semibold tabular-nums">{price ? reais(price) : 'Indisponível'}
                {!!price && <span className="text-xs font-normal text-muted">{cycle === 'ANNUAL' ? ' /ano' : ' /mês'}</span>}</div>
              {p.max_users && <p className="mt-1 text-xs text-muted">Até {p.max_users} usuários</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Subscription({ standalone = false }) {
  const s = useSession();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'resumo';
  const { data, loading, error, reload } = useLoad(() => api('/api/access/billing'), []);
  const [pick, setPick] = useState(null); // { mode: 'checkout'|'change', plan, cycle }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // voltando da página de pagamento: confere a situação na central
  useEffect(() => { api('/api/access/verify', { method: 'POST' }).then(() => s.reload()).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const after = async () => { await reload(); await s.reload(); };
  const run = async (fn, ok) => {
    setBusy(true); setErr(null);
    try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { setErr(e); return null; } finally { setBusy(false); }
  };

  const wrap = (children) => (standalone ? (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between"><Logo /><Link className="btn-ghost" to="/"><ArrowLeft size={16} /> Voltar</Link></div>
        {children}
      </div>
    </div>
  ) : children);

  if (loading && !data) return wrap(<Loading />);
  if (error) return wrap(<ErrorBox error={error} onRetry={reload} />);
  const a = data.access || s.me?.access || {};
  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="font-display text-3xl">Assinatura e plano</h2><p className="text-sm text-muted">Contratação, cobranças e recibos da sua empresa no RUSTEN.</p></div>
      <button className="btn-ghost" onClick={after}><RefreshCw size={16} /> Atualizar</button>
    </div>
  );

  if (data.demo || a.state === 'DEMO') {
    return wrap(<div>{header}<div className="card stripe p-5">Esta é uma <b>demonstração</b>: não há assinatura nem cobrança. Use “Ativar minha conta” no topo da tela para começar a usar de verdade.</div></div>);
  }
  if (!data.hub) {
    return wrap(<div>{header}<div className="card p-5 text-sm">Acesso liberado. A cobrança pela central da plataforma ainda não foi ligada nesta instalação.</div></div>);
  }
  const acc = data.access || {};
  if (data.restricted) {
    return wrap(<div>{header}<div className="card p-5 text-sm">Situação: <StatusBadge status={acc.status || a.state} /> — somente o proprietário ou um administrador gerencia a assinatura.</div></div>);
  }

  const sub = data.subscription;
  const activeSub = sub && ['ACTIVE', 'PAST_DUE'].includes(sub.status) ? sub : null;
  const pending = data.pending_payment;
  const gw = data.gateway_configured;
  const plans = data.plans || [];

  const checkout = async () => {
    const r = await run(() => api('/api/access/billing/checkout', { method: 'POST', body: { plan_id: pick.plan, cycle: pick.cycle } }));
    if (!r) return;
    setPick(null);
    if (r.checkout_url) openCheckout(r.checkout_url); else after();
  };
  const changePlan = async () => {
    const r = await run(() => api('/api/access/billing/change-plan', { method: 'POST', body: { plan_id: pick.plan } }), 'Plano alterado. O novo valor vale a partir da próxima cobrança.');
    if (r) { setPick(null); after(); }
  };
  const renew = async () => {
    const r = await run(() => api('/api/access/billing/renew', { method: 'POST', body: {} }));
    if (r) { if (r.checkout_url) openCheckout(r.checkout_url); else after(); }
  };
  const cancel = async () => {
    const r = await run(() => api('/api/access/billing/cancel', { method: 'POST', body: { confirm: true } }), 'Assinatura cancelada ao fim do período.');
    setConfirmCancel(false);
    if (r) after();
  };

  const info = [
    ['Situação', <StatusBadge key="s" status={acc.status} />],
    ['Plano', acc.plan?.name || sub?.plan_name || '—'],
    ['Ciclo', CYCLE[acc.cycle] || '—'],
    ['Valor', sub ? reais(sub.value) : '—'],
    ['Próxima cobrança', activeSub?.next_charge_at && !activeSub.cancel_at_period_end ? day(activeSub.next_charge_at) : '—'],
    ['Válido até', acc.valid_until ? day(acc.valid_until) : '—'],
    ['Forma de pagamento', sub?.card_last4 ? `${sub.card_brand || 'Cartão'} •••• ${sub.card_last4}` : '—'],
  ];
  if (acc.trial) info.push(['Período de teste', `${TRIAL[acc.trial.type] || acc.trial.type}${acc.trial.days_left != null ? ` · ${Math.max(0, acc.trial.days_left)} dia(s) restantes` : ''}`]);
  if (acc.reason) info.push(['Motivo', REASON[acc.reason] || acc.reason]);

  return wrap(
    <div>
      {header}
      {!gw && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm">
          A cobrança on-line ainda não está disponível. Fale com o suporte{data.support ? ` (${data.support})` : ''} para contratar.
        </div>
      )}
      {(acc.notices || []).map((n) => <div key={n.text} className={`mb-3 rounded-lg border px-4 py-2.5 text-sm ${n.level === 'danger' ? 'border-rust/40 bg-rust/10' : 'border-warn/40 bg-warn/10'}`}>{n.text}</div>)}
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {[['resumo', 'Resumo'], ['pagamento', 'Pagamento'], ['historico', 'Histórico']].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setParams(v === 'resumo' ? {} : { tab: v })}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === v ? 'border-copper text-copper' : 'border-transparent text-muted'}`}>{l}</button>
        ))}
      </div>
      <ErrorBox error={err} />

      {tab === 'resumo' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card p-5 lg:col-span-2">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {info.map(([k, v]) => (<div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="mt-0.5 text-sm font-semibold">{v}</dd></div>))}
            </dl>
            {activeSub?.cancel_at_period_end && <p className="mt-4 text-sm text-muted">Cancelamento agendado: o acesso termina em {day(acc.valid_until)}.</p>}
          </div>
          <div className="card flex flex-col gap-2 p-5">
            <h3 className="mb-1 text-sm font-semibold">Ações</h3>
            {pending && <a className="btn-primary" href={pending.invoice_url} target="_blank" rel="noreferrer noopener"><CreditCard size={16} /> Pagar cobrança pendente ({reais(pending.amount)})</a>}
            {!activeSub && gw && plans.length > 0 && (
              <button className="btn-primary" disabled={busy} onClick={() => setPick({ mode: 'checkout', plan: acc.plan?.id || plans[0].id, cycle: acc.cycle || 'MONTHLY' })}>
                <ShieldCheck size={16} /> Contratar plano
              </button>
            )}
            {activeSub?.cycle === 'ANNUAL' && gw && <button className="btn-ghost" disabled={busy} onClick={renew}><RefreshCw size={16} /> Renovar plano anual</button>}
            {activeSub?.cycle === 'MONTHLY' && !activeSub.cancel_at_period_end && gw && (
              <button className="btn-ghost" disabled={busy} onClick={() => setPick({ mode: 'change', plan: activeSub.plan_id, cycle: 'MONTHLY' })}><ArrowUpDown size={16} /> Alterar plano</button>
            )}
            {activeSub && !activeSub.cancel_at_period_end && s.me?.user?.role === 'owner' && (
              <button className="btn-ghost text-rust" disabled={busy} onClick={() => setConfirmCancel(true)}><XCircle size={16} /> Cancelar assinatura</button>
            )}
            {!pending && !activeSub && !gw && <p className="text-sm text-muted">Nenhuma ação disponível no momento.</p>}
          </div>
        </div>
      )}

      {tab === 'pagamento' && (
        <div className="card max-w-2xl p-5 text-sm">
          <h3 className="font-semibold">Forma de pagamento</h3>
          <p className="mt-1 text-muted">
            {sub?.card_last4 ? `Cartão cadastrado: ${sub.card_brand || 'Cartão'} •••• ${sub.card_last4}.` : 'Nenhum cartão salvo.'}{' '}
            Os dados de cartão são informados apenas na página segura do gateway de pagamento — a plataforma guarda somente a bandeira e os 4 últimos dígitos.
          </p>
          <p className="mt-3 text-muted">Para trocar a forma de pagamento, abra a cobrança pendente e escolha a nova forma (cartão, Pix ou boleto). Nas próximas cobranças mensais, a forma usada no último pagamento é mantida.</p>
          <div className="mt-4">
            {pending
              ? <a className="btn-primary" href={pending.invoice_url} target="_blank" rel="noreferrer noopener"><ExternalLink size={16} /> Abrir cobrança pendente</a>
              : <span className="text-muted">Não há cobrança pendente agora.</span>}
          </div>
        </div>
      )}

      {tab === 'historico' && (
        <div className="card overflow-x-auto">
          {!data.payments?.length ? <Empty icon={Receipt} title="Nenhuma cobrança ainda" /> : (
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase text-muted"><th className="p-3">Vencimento</th><th className="p-3">Valor</th><th className="p-3">Situação</th><th className="p-3">Período</th><th className="p-3">Pago em</th><th /></tr></thead>
              <tbody>
                {data.payments.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="p-3">{day(p.due_date)}</td>
                    <td className="p-3 tabular-nums">{reais(p.amount)}</td>
                    <td className="p-3">{PAY_LABEL[p.status] || p.status}</td>
                    <td className="p-3 text-xs text-muted">{p.period_start ? `${day(p.period_start)} – ${day(p.period_end)}` : '—'}</td>
                    <td className="p-3">{p.paid_at ? day(p.paid_at) : '—'}</td>
                    <td className="p-3 text-right">
                      {p.receipt_url && <a className="btn-ghost" href={p.receipt_url} target="_blank" rel="noreferrer noopener"><FileText size={16} /> Recibo</a>}
                      {!p.receipt_url && p.invoice_url && ['PENDING', 'OVERDUE'].includes(p.status) && <a className="btn-ghost" href={p.invoice_url} target="_blank" rel="noreferrer noopener">Pagar</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal open={!!pick} onClose={() => setPick(null)} wide title={pick?.mode === 'change' ? 'Alterar plano' : 'Contratar plano'}
        footer={<>
          <button className="btn-ghost" onClick={() => setPick(null)}>Voltar</button>
          <button className="btn-primary" disabled={busy || !pick?.plan || !priceFor(plans.find((p) => p.id === pick?.plan), pick?.cycle)}
            onClick={pick?.mode === 'change' ? changePlan : checkout}>{pick?.mode === 'change' ? 'Confirmar alteração' : 'Ir para o pagamento'}</button>
        </>}>
        <p className="mb-3 text-sm text-muted">{pick?.mode === 'change' ? 'O novo valor é aplicado a partir da próxima cobrança mensal.' : 'Você será levado à página segura de pagamento.'}</p>
        {pick && (pick.mode === 'change'
          ? <Field label="Novo plano"><select className="input" value={pick.plan} onChange={(e) => setPick({ ...pick, plan: e.target.value })}>
              {plans.filter((p) => priceFor(p, 'MONTHLY')).map((p) => <option key={p.id} value={p.id}>{p.name} — {reais(p.monthly_price)}/mês</option>)}
            </select></Field>
          : <PlanPicker plans={plans} value={pick.plan} cycle={pick.cycle} onChange={(plan) => setPick({ ...pick, plan })} onCycle={(cycle) => setPick({ ...pick, cycle })} />)}
      </Modal>
      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancelar assinatura?"
        footer={<><button className="btn-ghost" onClick={() => setConfirmCancel(false)}>Voltar</button><button className="btn-danger" disabled={busy} onClick={cancel}>Cancelar assinatura</button></>}>
        <p className="text-sm">Você continua usando o sistema até o fim do período já pago. Depois disso o acesso é suspenso, mas nenhum dado é apagado.</p>
      </Modal>
    </div>,
  );
}
