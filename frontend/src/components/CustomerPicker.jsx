// Identificação do cliente pelo CPF: ao completar 11 dígitos busca o cadastro e preenche o nome;
// se não existir, permite o cadastro rápido ali mesmo.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, UserPlus, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { Field } from './ui.jsx';

export const cpfDigits = (v) => String(v || '').replace(/\D/g, '').slice(0, 11);
export const cpfMask = (v) => {
  const d = cpfDigits(v);
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
};
export function cpfValid(v) {
  const c = cpfDigits(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/* value: { customer: {id,name,points} | null }  · onChange(customer|null) · onName(nome) */
export default function CustomerPicker({ onChange, onName, autoFocus }) {
  const s = useSession();
  const [cpf, setCpf] = useState('');
  const [state, setState] = useState('idle'); // idle | busy | found | notfound | invalid | error
  const [customer, setCustomer] = useState(null);
  const [openSessions, setOpenSessions] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', consent_whatsapp: false });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const seq = useRef(0);
  const canCreate = s.can('clientes.gerenciar');
  const enabled = s.hasModule('clientes') && s.can('clientes.visualizar');

  useEffect(() => {
    const d = cpfDigits(cpf);
    setErr(null);
    if (d.length < 11) { setState('idle'); if (customer) { setCustomer(null); onChange?.(null); } return; }
    if (!cpfValid(d)) { setState('invalid'); return; }
    const n = ++seq.current;
    setState('busy');
    api(`/api/customers/lookup?cpf=${d}`).then((r) => {
      if (n !== seq.current) return;
      if (r.found) { setCustomer(r.customer); setOpenSessions(r.open_sessions || []); setState('found'); onChange?.(r.customer); onName?.(r.customer.name); }
      else { setState('notfound'); setCustomer(null); onChange?.(null); }
    }).catch((e) => { if (n === seq.current) { setState('error'); setErr(e); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf]);

  const create = async () => {
    setSaving(true); setErr(null);
    try {
      const c = await api('/api/customers', { method: 'POST', body: { name: form.name, cpf: cpfDigits(cpf), phone: form.phone || null, consent_whatsapp: form.consent_whatsapp } });
      setCustomer(c); setState('found'); onChange?.(c); onName?.(c.name);
    } catch (e) { setErr(e); } finally { setSaving(false); }
  };
  const clear = () => { setCpf(''); setCustomer(null); setState('idle'); onChange?.(null); };

  if (!enabled) return null;
  return (
    <div className="rounded-lg border border-line p-3">
      <Field label="CPF do cliente (opcional)" hint="Ao completar o CPF, o nome é preenchido automaticamente.">
        <div className="relative">
          <input className="input pr-9 text-lg tracking-wider" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" autoFocus={autoFocus}
            value={cpfMask(cpf)} onChange={(e) => setCpf(cpfDigits(e.target.value))} aria-invalid={state === 'invalid'} data-cpf />
          <span className="absolute right-2 top-1/2 -translate-y-1/2">
            {state === 'busy' && <Loader2 size={18} className="animate-spin text-muted" />}
            {state === 'found' && <CheckCircle2 size={18} className="text-ok" />}
            {cpf && state !== 'busy' && state !== 'found' && <button type="button" onClick={clear} aria-label="Limpar CPF"><X size={16} className="text-muted" /></button>}
          </span>
        </div>
      </Field>
      {state === 'invalid' && <p className="mt-1 text-sm text-rust">CPF inválido — confira os números.</p>}
      {state === 'error' && <p className="mt-1 text-sm text-rust">{err?.message}</p>}
      {state === 'found' && customer && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-ok/10 px-3 py-2 text-sm">
          <div><b>{customer.name}</b>{customer.points ? <span className="text-muted"> · {customer.points} pontos</span> : null}
            {customer.preferences && <div className="text-xs text-muted">Preferências: {customer.preferences}</div>}
            {!!openSessions.length && <div className="text-xs text-warn">Já tem consumo aberto: {openSessions.map((o) => o.card_number ? `comanda ${o.card_number}` : o.table_number ? `mesa ${o.table_number}` : `#${o.id}`).join(', ')}</div>}
          </div>
          <button type="button" className="text-xs underline" onClick={clear}>trocar</button>
        </div>
      )}
      {state === 'notfound' && (
        canCreate ? (
          <div className="mt-2 space-y-2 rounded-lg bg-raised p-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={16} /> CPF sem cadastro — cadastrar agora</div>
            <input className="input" placeholder="Nome completo" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); onName?.(e.target.value); }} data-new-name />
            <input className="input" placeholder="Celular com DDD (opcional)" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.consent_whatsapp} onChange={(e) => setForm({ ...form, consent_whatsapp: e.target.checked })} />
              Cliente aceita receber novidades por WhatsApp</label>
            <button type="button" className="btn-primary w-full" disabled={saving} aria-disabled={(form.name.trim().length < 2) || undefined} data-why={'Informe o nome do cliente'} onClick={create}>{saving ? 'Salvando…' : 'Cadastrar cliente'}</button>
            {err && <p className="text-sm text-rust">{err.message}</p>}
          </div>
        ) : <p className="mt-1 text-sm text-muted">CPF sem cadastro. Informe o nome abaixo.</p>
      )}
    </div>
  );
}
