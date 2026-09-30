// Tela de acesso bloqueado: motivo, situação e caminhos de regularização (sem dados internos).
import { useState } from 'react';
import { Lock, LifeBuoy, LogOut, RefreshCw, CreditCard } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { ErrorBox, Logo } from '../components/ui.jsx';

const STATES = { bloqueio_administrativo: 'Bloqueado pela administração', vencida: 'Assinatura vencida', access_blocked: 'Acesso bloqueado' };

export default function Blocked() {
  const s = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const b = s.blocked || {};
  const support = s.me?.access?.support;
  const canBill = s.can('assinatura.gerenciar');

  const verify = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api('/api/access/verify', { method: 'POST' });
      const me = await s.reload();
      setMsg(me?.access?.allowed ? null : 'Ainda não identificamos a regularização. Se acabou de pagar, aguarde alguns minutos e verifique de novo.');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const pay = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/access/billing/checkout', { method: 'POST', body: {} });
      if (r?.url && /^https:\/\//.test(r.url)) window.location.assign(r.url);
      else setMsg('A página de pagamento não está disponível agora. Fale com o suporte.');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="card w-full max-w-lg p-6">
        <Logo />
        <div className="mt-6 flex items-center gap-3">
          <Lock className="text-rust" size={28} />
          <h1 className="title">Acesso suspenso</h1>
        </div>
        <p className="mt-2">{b.reason || 'O acesso às operações está suspenso.'}</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Situação</dt><dd className="font-semibold">{STATES[b.state] || b.state || '—'}</dd>
          {s.me?.company?.name && <><dt className="text-muted">Empresa</dt><dd>{s.me.company.name}</dd></>}
        </dl>
        <p className="mt-3 text-xs text-muted">Seus dados estão preservados. Comandas abertas e pagamentos já confirmados não foram alterados.</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {canBill && <button className="btn-primary" onClick={pay} disabled={busy}><CreditCard size={16} /> Regularizar pagamento</button>}
          {canBill && <button className="btn-ghost" onClick={verify} disabled={busy}><RefreshCw size={16} /> Já paguei, verificar</button>}
          <a className="btn-ghost" href={support?.whatsapp ? `https://wa.me/${String(support.whatsapp).replace(/\D/g, '')}` : support?.email ? `mailto:${support.email}` : '#'}
            onClick={(e) => { if (!support) { e.preventDefault(); setMsg('Contato do suporte ainda não configurado pela administração.'); } }}>
            <LifeBuoy size={16} /> Falar com suporte
          </a>
          <button className="btn-ghost" onClick={() => s.logout()}><LogOut size={16} /> Sair</button>
        </div>
        {!canBill && <p className="mt-3 text-sm text-muted">Peça ao proprietário da empresa para regularizar a assinatura.</p>}
        {msg && <p className="mt-3 text-sm">{msg}</p>}
        <div className="mt-3"><ErrorBox error={err} /></div>
      </div>
    </div>
  );
}
