// Demonstração: faixa no topo e conversão em conta real (empresa, responsável, e-mail e senha).
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, tokens } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { ErrorBox, Field, Modal, Toggle } from './ui.jsx';

export function DemoBar() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  if (!s.me?.company?.is_demo) return null;
  return (
    <>
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-copper/40 bg-copper/10 px-4 py-2 text-sm">
        <Sparkles size={16} className="text-copper" aria-hidden />
        <span className="flex-1 min-w-[12rem]"><b>Demonstração</b> — dados de exemplo, apagados automaticamente em alguns dias. Explore à vontade.</span>
        <button className="btn-primary" onClick={() => setOpen(true)}>Ativar minha conta</button>
      </div>
      <ActivateModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ActivateModal({ open, onClose }) {
  const s = useSession();
  const [f, setF] = useState({ company_name: '', name: '', email: '', password: '', phone: '', keep_data: false, accept_terms: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF({ ...f, [k]: v });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      tokens.save(await api('/api/auth/activate', { method: 'POST', body: { ...f, phone: f.phone || undefined } }));
      onClose();
      await s.reload();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Ativar minha conta">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-muted">A demonstração vira a sua empresa. O plano e o período de teste seguem a regra da plataforma e aparecem em Configurações › Assinatura.</p>
        <Field label="Nome do estabelecimento"><input className="input" required minLength={2} value={f.company_name} onChange={(e) => set('company_name', e.target.value)} /></Field>
        <Field label="Seu nome"><input className="input" required minLength={2} value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="E-mail de acesso"><input className="input" type="email" autoComplete="username" required value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Telefone (opcional)"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        </div>
        <Field label="Senha" hint="Mínimo de 10 caracteres, com letras e números."><input className="input" type="password" autoComplete="new-password" required value={f.password} onChange={(e) => set('password', e.target.value)} /></Field>
        <Toggle checked={f.keep_data} onChange={(v) => set('keep_data', v)} label="Manter os dados de exemplo"
          hint="Desligado: apaga o cardápio e o movimento de exemplo e mantém mesas, cartões e configurações." />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={f.accept_terms} onChange={(e) => set('accept_terms', e.target.checked)} required />
          <span>Li e aceito os termos de uso e a política de privacidade.</span>
        </label>
        <ErrorBox error={err} />
        <button className="btn-primary btn-xl w-full" disabled={busy}>{busy ? 'Ativando…' : 'Ativar e continuar'}</button>
      </form>
    </Modal>
  );
}
