import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, tokens } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { ErrorBox, Field, Logo, Modal } from '../components/ui.jsx';

export function AuthShell({ children, title, subtitle }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#121212] p-10 text-[#F3E9D2] lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(135deg,#B8733333 0 14px,transparent 14px 28px)' }} />
        <div className="relative"><Logo size={48} /></div>
        <div className="relative">
          <div className="font-display text-7xl leading-[0.9] tracking-wide">Do balcão<br />à cozinha,<br /><span className="text-[#B87333]">tudo no ponto.</span></div>
          <p className="mt-6 max-w-md text-[#F3E9D2]/80">Comandas, mesas, leitor de códigos e caixa num só lugar — feito para o ritmo de bar e restaurante.</p>
        </div>
        <div className="relative flex gap-6 text-xs uppercase tracking-[0.3em] text-[#F3E9D2]/60"><span>Comanda</span><span>•</span><span>Produto</span><span>•</span><span>Caixa</span></div>
      </div>
      <div className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-6 lg:hidden"><Logo /></div>
          <h1 className="title text-4xl">{title}</h1>
          {subtitle && <p className="mb-6 text-muted">{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  const s = useSession();
  const [f, setF] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api('/api/auth/plans').then(setCfg).catch(() => setCfg(null)); }, []);
  const [demoOpen, setDemoOpen] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      tokens.save(await api('/api/auth/login', { method: 'POST', body: f }));
      await s.reload();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Entrar" subtitle="Acesse o painel do seu estabelecimento.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail"><input className="input" type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Senha"><input className="input" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <div className="-mt-2 text-right"><Link to="/esqueci-senha" className="text-sm font-semibold text-copper underline" data-forgot-link>Esqueci minha senha</Link></div>
        <ErrorBox error={err} />
        <button className="btn-primary btn-xl w-full" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
      {cfg?.demo_enabled && (
        <button type="button" className="btn-ghost btn-xl mt-3 w-full border border-copper/50" onClick={() => setDemoOpen(true)} disabled={busy} data-demo-open>
          <Sparkles size={18} /> Experimentar demonstração
        </button>
      )}
      <DemoSignup open={demoOpen} onClose={() => setDemoOpen(false)} onDone={() => s.reload()} />
      {cfg?.signup_open !== false
        ? <p className="mt-6 text-sm text-muted">Ainda não usa o RUSTEN? <Link className="font-semibold text-copper underline" to="/cadastro">Cadastre seu estabelecimento</Link></p>
        : <p className="mt-6 text-sm text-muted">Novos cadastros estão temporariamente fechados.</p>}
    </AuthShell>
  );
}

/* Demonstração com acesso próprio: nome, e-mail e senha (mesma política do cadastro). A pessoa volta pelo login com o que cadastrou. */
function DemoSignup({ open, onClose, onDone }) {
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', accept_terms: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: k === 'accept_terms' ? e.target.checked : e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (f.name.trim().length < 2) return setErr(new Error('Informe seu nome'));
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr(new Error('Informe um e-mail válido'));
    if (f.password.length < 10 || !/\d/.test(f.password) || !/[a-z]/i.test(f.password)) return setErr(new Error('A senha precisa ter 10+ caracteres, com letras e números'));
    if (f.password !== f.confirm) return setErr(new Error('As senhas não conferem'));
    if (!f.accept_terms) return setErr(new Error('É preciso aceitar os termos de uso e a política de privacidade'));
    setBusy(true);
    try {
      tokens.save(await api('/api/auth/demo', { method: 'POST', body: { name: f.name.trim(), email: f.email.trim(), password: f.password, accept_terms: true } }));
      onClose(); await onDone();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Experimentar demonstração">
      <form onSubmit={submit} className="space-y-3" data-demo-form>
        <p className="text-sm text-muted">Crie seu acesso para testar com um bar de exemplo (mesas, comandas, cozinha e caixa já com movimento). Use o mesmo e-mail e senha para voltar depois.</p>
        <Field label="Seu nome"><input className="input" autoComplete="name" required value={f.name} onChange={set('name')} /></Field>
        <Field label="E-mail"><input className="input" type="email" autoComplete="username" required value={f.email} onChange={set('email')} /></Field>
        <Field label="Senha" hint="Mínimo de 10 caracteres, com letras e números."><input className="input" type="password" autoComplete="new-password" required value={f.password} onChange={set('password')} /></Field>
        <Field label="Confirmar senha"><input className="input" type="password" autoComplete="new-password" required value={f.confirm} onChange={set('confirm')} /></Field>
        <label className="flex min-h-[44px] items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 h-5 w-5" checked={f.accept_terms} onChange={set('accept_terms')} />
          <span>Li e aceito os termos de uso e a política de privacidade.</span>
        </label>
        <p className="text-xs text-muted">A demonstração usa dados de exemplo e é apagada após alguns dias sem ativação. Para continuar usando, toque em "Ativar minha conta" dentro do sistema.</p>
        <ErrorBox error={err} />
        <button className="btn-primary btn-xl w-full" disabled={busy} data-demo-submit>{busy ? 'Preparando…' : 'Criar acesso e entrar'}</button>
      </form>
    </Modal>
  );
}

// "Esqueci minha senha": o link chega pelo e-mail de suporte da plataforma e vale por 60 minutos
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState(null);
  const [available, setAvailable] = useState(true);
  useEffect(() => { api('/api/auth/reset-options').then((r) => setAvailable(r.available !== false)).catch(() => {}); }, []);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api('/api/auth/forgot', { method: 'POST', body: { email } }); setDone(r.message); }
    catch (e2) { if (e2.code === 'reset_unavailable') setAvailable(false); else setErr(e2); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Esqueci minha senha" subtitle={available ? 'Informe o e-mail de acesso. Enviaremos um link para você criar uma nova senha.' : null}>
      {!available ? (
        <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm" data-reset-unavailable>
          <p className="font-semibold">A recuperação por e-mail ainda não está ativa.</p>
          <p><b>Funcionário:</b> peça ao proprietário ou administrador para definir uma nova senha em Configurações › Usuários.</p>
          <p><b>Proprietário:</b> fale com o suporte do RUSTEN.</p>
        </div>
      ) : done ? (
        <div className="rounded-lg border border-ok/40 bg-ok/10 p-4 text-sm" data-forgot-done>{done} Confira também a caixa de spam. O e-mail vem de <b>Suporte RUSTEN</b>.</div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-mail"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <ErrorBox error={err} />
          <button className="btn-primary btn-xl w-full" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
        </form>
      )}
      <p className="mt-6 text-center text-sm"><Link to="/entrar" className="font-semibold text-copper underline">Voltar para o login</Link></p>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [f, setF] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (f.password !== f.confirm) { setErr(new Error('As senhas não conferem.')); return; }
    setBusy(true);
    try { await api('/api/auth/reset', { method: 'POST', body: { token, new_password: f.password } }); setDone(true); }
    catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Criar nova senha" subtitle={done ? null : 'Use ao menos 10 caracteres, com letras e números.'}>
      {!token ? <p className="text-sm">Link inválido. Peça um novo em <Link to="/esqueci-senha" className="font-semibold text-copper underline">Esqueci minha senha</Link>.</p>
        : done ? (
          <div className="space-y-4"><div className="rounded-lg border border-ok/40 bg-ok/10 p-4 text-sm">Senha alterada. As sessões abertas foram encerradas por segurança.</div>
            <Link to="/entrar" className="btn-primary btn-xl w-full">Entrar com a nova senha</Link></div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Nova senha"><input className="input" type="password" autoComplete="new-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
            <Field label="Repita a nova senha"><input className="input" type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
            <ErrorBox error={err} />
            <button className="btn-primary btn-xl w-full" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
          </form>
        )}
    </AuthShell>
  );
}
