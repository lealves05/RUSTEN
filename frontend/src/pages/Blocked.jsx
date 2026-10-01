// Tela de acesso bloqueado: motivo, situação e caminhos de regularização (sem dados internos).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock, LifeBuoy, LogOut, RefreshCw, CreditCard } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { ErrorBox, Logo } from '../components/ui.jsx';

const STATES = { SUSPENDED: 'Suspensa', CANCELED: 'Cancelada', EXPIRED: 'Expirada', PAYMENT_PENDING: 'Aguardando pagamento', access_blocked: 'Acesso bloqueado' };

export default function Blocked() {
  const s = useSession();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const b = s.blocked || {};
  const acc = s.me?.access || {};
  const ch = acc.supportChannel || {};
  const byAdmin = !!acc.adminBlocked;
  const canBill = s.can('assinatura.gerenciar');

  const verify = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api('/api/access/verify', { method: 'POST' });
      const me = await s.reload();
      setMsg(me?.access?.allowed ? null : 'Ainda não identificamos a regularização. Se acabou de pagar, aguarde alguns minutos e verifique de novo.');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="card w-full max-w-lg p-6">
        <Logo />
        <div className="mt-6 flex items-center gap-3">
          <Lock className="text-rust" size={28} />
          <h1 className="title">{byAdmin ? 'Acesso bloqueado' : acc.reasonCode === 'TRIAL_EXPIRADO' ? 'Seu teste terminou' : acc.reasonCode === 'CANCELAMENTO' ? 'Assinatura encerrada' : 'Acesso suspenso'}</h1>
        </div>
        <p className="mt-2">{acc.reason || b.reason || 'O acesso às operações está suspenso.'}</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Situação</dt><dd className="font-semibold">{STATES[acc.state || b.state] || acc.label || b.state || '—'}</dd>
          {s.me?.company?.name && <><dt className="text-muted">Empresa</dt><dd>{s.me.company.name}</dd></>}
        </dl>
        <p className="mt-3 text-xs text-muted">Seus dados estão preservados. Comandas abertas e pagamentos já confirmados não foram alterados.</p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {canBill && !byAdmin && <Link className="btn-primary" to="/assinatura"><CreditCard size={16} /> Regularizar pagamento</Link>}
          <button className="btn-ghost" onClick={verify} disabled={busy}><RefreshCw size={16} /> {byAdmin ? 'Verificar novamente' : 'Já paguei, verificar'}</button>
          {ch.whatsapp && <a className="btn-ghost" target="_blank" rel="noreferrer noopener" href={`https://wa.me/${ch.whatsapp.length >= 12 ? ch.whatsapp : `55${ch.whatsapp}`}`}><LifeBuoy size={16} /> WhatsApp do suporte</a>}
          {ch.email && <a className="btn-ghost" href={`mailto:${ch.email}`}><LifeBuoy size={16} /> {ch.email}</a>}
          {!ch.whatsapp && !ch.email && acc.support && <span className="btn-ghost pointer-events-none"><LifeBuoy size={16} /> Suporte: {acc.support}</span>}
          <button className="btn-ghost" onClick={() => s.logout()}><LogOut size={16} /> Sair</button>
        </div>
        {!canBill && !byAdmin && <p className="mt-3 text-sm text-muted">Peça ao proprietário da empresa para regularizar a assinatura.</p>}
        {msg && <p className="mt-3 text-sm">{msg}</p>}
        <div className="mt-3"><ErrorBox error={err} /></div>
      </div>
    </div>
  );
}
