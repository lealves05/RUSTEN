// InfinitePay: cobrança da comanda por link/QR (Pix ou cartão no celular do cliente), acompanhada em tempo real,
// configuração da InfiniteTag e painel de conferência.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2, MessageCircle, QrCode, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, dateTime } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, ErrorBox, Field, Loading, Toggle, useLoad, useToast } from './ui.jsx';

const API_BASE = import.meta.env.VITE_API_URL || location.origin;
export const IP_STATUS = { pendente: ['warn', 'aguardando'], pago: ['ok', 'pago'], cancelado: ['muted', 'cancelado'], divergente: ['bad', 'conferir'], erro: ['bad', 'erro'] };
const CAPTURE = { pix: 'Pix', credit_card: 'Cartão de crédito' };

/** Painel dentro do Receber: gera o link, mostra o QR e acompanha até o pagamento cair na comanda. */
export function InfinitePayCharge({ session, amountC, phone, onPaid }) {
  const toast = useToast();
  const [charge, setCharge] = useState(null);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const done = useRef(false);
  useEffect(() => {
    if (!charge?.link_url) { setQr(null); return; }
    import('qrcode').then((m) => m.default.toDataURL(charge.link_url, { margin: 1, width: 240 })).then(setQr).catch(() => setQr(null));
  }, [charge?.link_url]);
  // acompanhamento: a confirmação chega pelo webhook da InfinitePay; a tela consulta a cada 3 s
  useEffect(() => {
    if (!charge || charge.status !== 'pendente') return undefined;
    const t = setInterval(async () => {
      try {
        const c = await api(`/api/infinitepay/charges/${charge.id}`);
        setCharge(c);
        if (c.status !== 'pendente' && !done.current) { done.current = true; if (c.status === 'pago') { toast(`Pagamento InfinitePay confirmado: ${money(c.amount_cents)}`); onPaid(c); } }
      } catch { /* tenta de novo no próximo ciclo */ }
    }, 3000);
    return () => clearInterval(t);
  }, [charge?.id, charge?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const create = async () => {
    setBusy(true); setErr(null); done.current = false;
    try { setCharge(await api('/api/infinitepay/charges', { method: 'POST', body: { session_id: session.id, amount_cents: amountC, api_base: API_BASE } })); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const cancel = async () => { try { await api(`/api/infinitepay/charges/${charge.id}/cancel`, { method: 'POST' }); setCharge({ ...charge, status: 'cancelado' }); } catch (e) { setErr(e); } };
  const wa = phone ? `https://wa.me/55${String(phone).replace(/\D/g, '').slice(-11)}?text=${encodeURIComponent(`Olá! Segue o link para pagar ${money(charge?.amount_cents)} (Pix ou cartão): ${charge?.link_url}`)}` : null;
  if (!charge || charge.status === 'cancelado' || charge.status === 'erro') {
    return (
      <div className="mt-3 space-y-2" data-ip-panel>
        <p className="text-sm text-muted">Gera um link da InfinitePay com o valor acima. O cliente paga por <b>Pix ou cartão</b> no celular dele (lendo o QR) e o pagamento entra na comanda sozinho.</p>
        {charge?.status === 'erro' && <p className="text-sm text-rust">{charge.note}</p>}
        <ErrorBox error={err} />
        <button className="btn-primary btn-xl w-full" disabled={busy} aria-disabled={(!amountC) || undefined} data-why={'Informe o valor da cobrança'} onClick={create} data-ip-create>{busy ? <Loader2 size={18} className="animate-spin" /> : <QrCode size={18} />} Gerar cobrança de {money(amountC)}</button>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-3 text-center" data-ip-charge={charge.status}>
      {charge.status === 'pendente' ? (
        <>
          {qr ? <img src={qr} alt="QR do pagamento InfinitePay" className="mx-auto rounded bg-white p-2" width={220} height={220} /> : <Loading />}
          <div className="flex items-center justify-center gap-2 text-sm font-semibold text-warn"><Loader2 size={16} className="animate-spin" /> Aguardando o pagamento de {money(charge.amount_cents)}…</div>
          <div className="flex flex-wrap justify-center gap-2">
            <button className="btn-ghost py-1 text-xs" onClick={() => { navigator.clipboard?.writeText(charge.link_url); toast('Link copiado'); }}><Copy size={14} /> Copiar link</button>
            <a className="btn-ghost py-1 text-xs" href={charge.link_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir</a>
            {wa && <a className="btn-ghost py-1 text-xs" href={wa} target="_blank" rel="noreferrer"><MessageCircle size={14} /> WhatsApp</a>}
            <button className="btn-ghost py-1 text-xs text-rust" onClick={cancel}><XCircle size={14} /> Cancelar</button>
          </div>
          <p className="text-xs text-muted">A confirmação vem da InfinitePay e é conferida antes de entrar na comanda.</p>
        </>
      ) : charge.status === 'pago' ? (
        <p className="flex items-center justify-center gap-2 font-semibold text-ok"><CheckCircle2 size={20} /> Pago por {CAPTURE[charge.capture_method] || 'InfinitePay'}{charge.installments > 1 ? ` em ${charge.installments}×` : ''}.</p>
      ) : (
        <p className="text-sm text-rust">Pagamento recebido, mas precisa de conferência: {charge.note}</p>
      )}
    </div>
  );
}

/** Configurações › Integrações */
export function InfinitePaySettings() {
  const toast = useToast();
  const d = useLoad(() => api('/api/infinitepay/settings'), []);
  const [f, setF] = useState(null);
  useEffect(() => { if (d.data) setF({ enabled: !!d.data.enabled, handle: d.data.handle || '' }); }, [d.data]);
  if (!f) return <Loading />;
  const save = async () => {
    try { const r = await api('/api/infinitepay/settings', { method: 'PUT', body: f }); setF({ enabled: r.enabled, handle: r.handle }); toast('InfinitePay salva'); } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <div className="card space-y-4 p-5" data-ip-settings>
      <div>
        <h2 className="font-display text-2xl">InfinitePay</h2>
        <p className="text-sm text-muted">Cobre a comanda por link ou QR: o cliente paga por Pix ou cartão (até 12×) no celular e o pagamento cai sozinho na comanda, conferido na InfinitePay.</p>
      </div>
      <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Usar a InfinitePay no Receber" />
      <Field label="InfiniteTag" hint="Seu nome de usuário na InfinitePay, sem o $ (aparece no app, em Perfil). Não é senha.">
        <input className="input" value={f.handle} maxLength={60} placeholder="ex.: bardoporto" onChange={(e) => setF({ ...f, handle: e.target.value })} />
      </Field>
      <button className="btn-primary" onClick={save}>Salvar</button>
      <div className="rounded-lg bg-raised p-3 text-xs text-muted">
        <p><b>O que a InfinitePay libera para sistemas:</b> criar o link de pagamento, avisar quando é pago e consultar o pagamento. As vendas feitas direto na maquininha ou no Tap não passam pelo RUSTEN: registre-as no Receber como Débito, Crédito ou Pix, ou importe o relatório de vendas em <a className="underline" href="/financeiro/maquininha">Financeiro › Vendas da maquininha</a>.</p>
        <p className="mt-1">Taxas e repasses seguem o seu plano na InfinitePay; o RUSTEN registra o valor da comanda.</p>
      </div>
    </div>
  );
}

/** Financeiro › InfinitePay: conferência das cobranças */
export function InfinitePayPanel() {
  const s = useSession();
  const [status, setStatus] = useState('');
  const d = useLoad(() => api(`/api/infinitepay/charges${status ? `?status=${status}` : ''}`), [status]);
  return (
    <div className="space-y-3" data-ip-panelist>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-2xl">Cobranças InfinitePay</h2>
        <select className="input ml-auto w-auto py-1.5" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="">Todas</option>{Object.entries(IP_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {d.loading && !d.data ? <Loading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : (
        <>
          <div className="grid gap-2 sm:grid-cols-4">
            {[['Recebido', d.data.totals.pago, 'text-ok'], ['Pix', d.data.totals.pix, ''], ['Cartão', d.data.totals.cartao, ''], ['Para conferir', d.data.totals.divergente, 'text-rust']].map(([l, v, c]) => (
              <div key={l} className="card p-3"><div className="text-xs uppercase text-muted">{l}</div><div className={`font-display text-2xl ${c}`}>{money(v)}</div></div>))}
          </div>
          {!d.data.items.length ? <p className="text-sm text-muted">Nenhuma cobrança ainda.</p> : (
            <div className="card overflow-x-auto"><table className="table-clean">
              <thead><tr><th>Data</th><th>Cobrança</th><th className="text-right">Valor</th><th>Forma</th><th>Situação</th><th>Conferido por</th><th /></tr></thead>
              <tbody>{d.data.items.map((x) => (
                <tr key={x.id}>
                  <td className="whitespace-nowrap">{dateTime(x.created_at, s.tz)}</td>
                  <td>{x.description}<div className="text-xs text-muted">{x.order_nsu}{x.user_name ? ` · ${x.user_name}` : ''}</div>{x.note && <div className="text-xs text-rust">{x.note}</div>}</td>
                  <td className="text-right">{money(x.amount_cents)}{x.paid_amount_cents && x.paid_amount_cents !== x.amount_cents ? <div className="text-xs text-muted">cliente pagou {money(x.paid_amount_cents)}</div> : null}</td>
                  <td>{CAPTURE[x.capture_method] || '—'}{x.installments > 1 ? ` ${x.installments}×` : ''}</td>
                  <td><Badge tone={IP_STATUS[x.status][0]}>{IP_STATUS[x.status][1]}</Badge></td>
                  <td className="text-xs">{x.confirmed_by || '—'}</td>
                  <td>{x.receipt_url && <a className="text-xs underline" href={x.receipt_url} target="_blank" rel="noreferrer">comprovante</a>}</td>
                </tr>))}</tbody></table></div>
          )}
        </>
      )}
    </div>
  );
}
