import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api, tokens } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { ErrorBox, Field, Toggle } from '../components/ui.jsx';
import { AuthShell } from './Login.jsx';

const SEGMENTS = [['bar', 'Bar'], ['restaurante', 'Restaurante'], ['lanchonete', 'Lanchonete'], ['cafeteria', 'Cafeteria'], ['pub', 'Pub'],
  ['food_truck', 'Food truck'], ['hamburgueria', 'Hamburgueria'], ['pizzaria', 'Pizzaria'], ['padaria', 'Padaria'], ['outro', 'Outro']];
const STEPS = ['Empresa', 'Responsável', 'Plano', 'Configuração'];

export default function Register() {
  const s = useSession();
  const [step, setStep] = useState(0);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState(null);
  const [f, setF] = useState({
    company: { name: '', segment: 'bar', document: '', phone: '', email: '' },
    owner: { name: '', email: '', password: '' },
    plan: { code: '', cycle: 'mensal', trial: true },
    setup: { unit_name: 'Matriz', tables: 10, cards: 50, mode: 'manual', demo: true, day_cutoff: 5 },
    accept_terms: false,
  });
  const set = (grp, k, v) => setF((x) => ({ ...x, [grp]: { ...x[grp], [k]: v } }));
  useEffect(() => { api('/api/auth/plans').then(setPlans).catch(() => setPlans({ hub: false, plans: [] })); }, []);

  const next = (e) => {
    e.preventDefault(); setErr(null);
    if (step === 1 && (f.owner.password.length < 10 || !/\d/.test(f.owner.password) || !/[a-z]/i.test(f.owner.password)))
      return setErr(new Error('A senha precisa ter 10+ caracteres, com letras e números'));
    if (step < 3) return setStep(step + 1);
    submit();
  };
  const submit = async () => {
    if (!f.accept_terms) return setErr(new Error('É preciso aceitar os termos de uso e a política de privacidade'));
    setBusy(true);
    try {
      const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));
      const body = { company: clean(f.company), owner: f.owner, accept_terms: true, setup: f.setup,
        plan: plans?.hub ? { ...clean(f.plan) } : undefined };
      tokens.save(await api('/api/auth/register', { method: 'POST', body }));
      await s.reload();
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };

  return (
    <AuthShell title="Cadastro" subtitle="Leva menos de dois minutos. Tudo pode ser ajustado depois.">
      <ol className="mb-6 flex gap-2" aria-label="Etapas">
        {STEPS.map((st, i) => (
          <li key={st} className={`flex-1 border-t-4 pt-1 text-xs font-semibold uppercase ${i <= step ? 'border-copper text-ink' : 'border-line text-muted'}`}>
            {i < step ? <Check size={12} className="inline" /> : `${i + 1}.`} {st}
          </li>
        ))}
      </ol>
      <form onSubmit={next} className="space-y-4">
        {step === 0 && <>
          <Field label="Tipo de estabelecimento">
            <select className="input" value={f.company.segment} onChange={(e) => set('company', 'segment', e.target.value)}>
              {SEGMENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Nome do estabelecimento"><input className="input" required minLength={2} value={f.company.name} onChange={(e) => set('company', 'name', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CPF/CNPJ (opcional)"><input className="input" inputMode="numeric" value={f.company.document} onChange={(e) => set('company', 'document', e.target.value)} /></Field>
            <Field label="Telefone"><input className="input" inputMode="tel" value={f.company.phone} onChange={(e) => set('company', 'phone', e.target.value)} /></Field>
          </div>
        </>}
        {step === 1 && <>
          <Field label="Seu nome"><input className="input" required value={f.owner.name} onChange={(e) => set('owner', 'name', e.target.value)} /></Field>
          <Field label="E-mail de acesso"><input className="input" type="email" autoComplete="username" required value={f.owner.email} onChange={(e) => set('owner', 'email', e.target.value)} /></Field>
          <Field label="Senha" hint="Mínimo de 10 caracteres, com letras e números."><input className="input" type="password" autoComplete="new-password" required value={f.owner.password} onChange={(e) => set('owner', 'password', e.target.value)} /></Field>
        </>}
        {step === 2 && (plans?.hub && plans.plans?.length ? (
          <div className="space-y-2">
            {plans.plans.map((p) => (
              <label key={p.code} className={`card flex cursor-pointer items-start gap-3 p-3 ${f.plan.code === p.code ? 'border-copper ring-2 ring-copper/30' : ''}`}>
                <input type="radio" name="plan" checked={f.plan.code === p.code} onChange={() => set('plan', 'code', p.code)} className="mt-1" />
                <div className="flex-1"><div className="font-semibold">{p.name}</div><div className="text-sm text-muted">{p.description}</div></div>
                <div className="text-right text-sm">{p.monthly_cents != null && <div>{money(p.monthly_cents)}/mês</div>}{p.yearly_cents != null && <div className="text-muted">{money(p.yearly_cents)}/ano</div>}
                  {p.annual_savings_pct > 0 && <div className="text-xs text-ok">anual: {p.annual_savings_pct}% a menos que 12 mensalidades</div>}</div>
              </label>
            ))}
            <div className="flex gap-3 text-sm">
              <label><input type="radio" checked={f.plan.cycle === 'mensal'} onChange={() => set('plan', 'cycle', 'mensal')} /> Mensal</label>
              <label><input type="radio" checked={f.plan.cycle === 'anual'} onChange={() => set('plan', 'cycle', 'anual')} /> Anual</label>
            </div>
            {plans.trial && <Toggle checked={f.plan.trial} onChange={(v) => set('plan', 'trial', v)} label={`Começar pelo período de teste${plans.trial_days ? ` (${plans.trial_days} dias)` : ''}`} />}
            {plans.trial_label && <p className="text-xs text-muted">{plans.trial_label}. A cobrança só começa quando você contratar em Configurações › Assinatura.</p>}
          </div>
        ) : (
          <div className="card stripe p-4 text-sm">
            <div className="font-semibold">Acesso inicial liberado</div>
            <p className="mt-1 text-muted">O plano e o período de teste são definidos pela administração da plataforma. Você poderá contratar ou alterar o plano em Configurações › Assinatura.</p>
          </div>
        ))}
        {step === 3 && <>
          <Field label="Nome da unidade"><input className="input" value={f.setup.unit_name} onChange={(e) => set('setup', 'unit_name', e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mesas"><input className="input" type="number" min={0} max={300} value={f.setup.tables} onChange={(e) => set('setup', 'tables', Number(e.target.value))} /></Field>
            <Field label="Cartões de comanda"><input className="input" type="number" min={0} max={2000} value={f.setup.cards} onChange={(e) => set('setup', 'cards', Number(e.target.value))} /></Field>
          </div>
          <Field label="Modo do PDV" hint="Pode ser trocado a qualquer momento em Configurações › PDV.">
            <select className="input" value={f.setup.mode} onChange={(e) => set('setup', 'mode', e.target.value)}>
              <option value="manual">Manual — busca e catálogo, leitor opcional</option>
              <option value="continua">Leitura contínua — lê a comanda uma vez e depois os produtos</option>
              <option value="dupla">Dupla leitura — comanda e produto a cada item</option>
            </select>
          </Field>
          <Field label="A jornada vira o dia até" hint="Vendas antes deste horário contam no dia comercial anterior.">
            <select className="input" value={f.setup.day_cutoff} onChange={(e) => set('setup', 'day_cutoff', Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </Field>
          <Toggle checked={f.setup.demo} onChange={(v) => set('setup', 'demo', v)} label="Carregar cardápio de demonstração" hint="Identificado como demonstração; pode ser removido depois sem afetar vendas reais." />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={f.accept_terms} onChange={(e) => setF({ ...f, accept_terms: e.target.checked })} />
            <span>Li e aceito os termos de uso e a política de privacidade.</span>
          </label>
        </>}
        <ErrorBox error={err} />
        <div className="flex gap-2">
          {step > 0 && <button type="button" className="btn-ghost btn-xl" onClick={() => setStep(step - 1)}>Voltar</button>}
          <button className="btn-primary btn-xl flex-1" disabled={busy}>{step < 3 ? 'Continuar' : busy ? 'Criando…' : 'Criar e entrar'}</button>
        </div>
      </form>
      <p className="mt-6 text-sm text-muted">Já tem conta? <Link className="font-semibold text-copper underline" to="/entrar">Entrar</Link></p>
    </AuthShell>
  );
}
