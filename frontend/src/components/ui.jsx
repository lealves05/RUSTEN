// Componentes de interface compartilhados.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

export function Logo({ size = 36, withText = true }) {
  return (
    <div className="flex items-center gap-2 select-none">
      <img src="/rusten.svg" width={size} height={size} alt="" />
      {withText && (
        <div className="leading-none">
          <div className="font-display text-2xl tracking-[0.18em]">RUSTEN</div>
          <div className="text-[10px] uppercase tracking-widest text-muted">bares & restaurantes</div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="title">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export const Loading = ({ label = 'Carregando…' }) => (
  <div className="flex items-center gap-2 p-6 text-muted" role="status"><Loader2 className="animate-spin" size={18} /> {label}</div>
);

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-rust/40 bg-rust/10 p-3 text-sm">
      <XCircle size={18} className="mt-0.5 shrink-0 text-rust" />
      <div className="flex-1">{error.message || String(error)}</div>
      {onRetry && <button className="btn-ghost py-1 text-xs" onClick={onRetry}>Tentar de novo</button>}
    </div>
  );
}

export function Empty({ icon: Icon = Info, title, children }) {
  return (
    <div className="card stripe flex flex-col items-center gap-2 p-8 text-center">
      <Icon size={28} className="text-copper" />
      <div className="font-display text-xl tracking-wide">{title}</div>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

// Situação com ícone + texto (nunca só cor)
const TONES = {
  ok: ['text-ok border-ok/40 bg-ok/10', CheckCircle2],
  warn: ['text-warn border-warn/40 bg-warn/10', AlertTriangle],
  bad: ['text-rust border-rust/40 bg-rust/10', XCircle],
  info: ['text-copper border-copper/40 bg-copper/10', Info],
  muted: ['text-muted border-line bg-raised', Info],
};
export function Badge({ tone = 'info', children, icon }) {
  const [cls, Icon] = TONES[tone] || TONES.info;
  const I = icon || Icon;
  return <span className={`chip ${cls}`}><I size={12} aria-hidden />{children}</span>;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* Janela padrão: role="dialog", aria-modal, título ligado por aria-labelledby, foco preso dentro dela e devolvido ao fechar.
   Formulário alterado (o usuário digitou algo) pede confirmação antes de fechar por Esc, X ou clique fora — "guard={false}" desliga.
   Foco inicial: elemento com data-autofocus; senão o primeiro campo/botão. */
export function Modal({ open, onClose, title, children, wide, footer, guard = true }) {
  const ref = useRef(null);
  const titleId = useId();
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const state = useRef({});
  state.current = { dirty, guard, asking };
  const tryClose = useCallback(() => {
    if (state.current.guard && state.current.dirty && !state.current.asking) { setAsking(true); return; }
    closeRef.current?.();
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    setDirty(false); setAsking(false);
    const prev = document.activeElement;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector('[data-autofocus]') || ref.current?.querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea,button:not([data-close])');
      el?.focus();
    }, 30);
    const onKey = (e) => {
      if (!ref.current) return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return; // só a janela de cima reage
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (state.current.asking) setAsking(false); else tryClose(); return; }
      if (e.key === 'Tab') {
        const els = [...ref.current.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!els.length) return;
        const first = els[0]; const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!ref.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, tryClose]);
  if (!open) return null;
  const markDirty = (e) => { if (e.target.matches?.('input,textarea,select') && !e.target.closest('[data-no-dirty]')) setDirty(true); };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && tryClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onInput={markDirty} onChange={markDirty}
        className={`card max-h-[92vh] w-full overflow-auto rounded-b-none shadow-2xl sm:rounded-xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-3">
          <h2 id={titleId} className="font-display text-2xl tracking-wide">{title}</h2>
          <button data-close className="flex h-11 w-11 items-center justify-center rounded hover:bg-raised" onClick={tryClose} aria-label="Fechar"><X size={20} /></button>
        </div>
        {asking && (
          <div className="sticky top-[57px] z-10 flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn/10 px-5 py-3 text-sm" role="alertdialog" aria-label="Descartar alterações?">
            <AlertTriangle size={16} className="text-warn" aria-hidden />
            <span className="flex-1 font-semibold">Descartar o que foi preenchido?</span>
            <button className="btn-ghost" onClick={() => setAsking(false)} data-keep-editing>Continuar editando</button>
            <button className="btn-danger" onClick={() => { setAsking(false); closeRef.current?.(); }} data-discard>Descartar</button>
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-line bg-surface px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* Confirmações e motivos padronizados (substituem window.prompt/confirm).
   const ask = useAsk();
   await ask.confirm({ title, message, confirmLabel, danger }) → true/false
   await ask.reason({ title, message, label, reasons: ['…'], min: 3, confirmLabel, danger, optional }) → texto ou null
   await ask.value({ title, message, label, inputMode, placeholder, initial, validate }) → texto ou null */
const AskCtx = createContext(null);
export function AskProvider({ children }) {
  const [req, setReq] = useState(null);
  const open = useCallback((kind, opts) => new Promise((resolve) => setReq({ kind, ...opts, resolve })), []);
  const [api] = useState(() => ({}));
  api.confirm = (o) => open('confirm', o);
  api.reason = (o) => open('reason', o);
  api.value = (o) => open('value', o);
  const done = (v) => { req?.resolve(v); setReq(null); };
  return (
    <AskCtx.Provider value={api}>
      {children}
      {req && <AskModal key={Math.random()} req={req} onDone={done} />}
    </AskCtx.Provider>
  );
}
export const useAsk = () => useContext(AskCtx);

function AskModal({ req, onDone }) {
  const [text, setText] = useState(req.initial ?? '');
  const [err, setErr] = useState(null);
  const min = req.kind === 'reason' ? (req.optional ? 0 : req.min ?? 3) : 0;
  const cancel = () => onDone(req.kind === 'confirm' ? false : null);
  const ok = (v = text) => {
    if (req.kind === 'confirm') return onDone(true);
    const t = String(v).trim();
    if (t.length < min) return setErr(new Error(min > 1 ? `Escreva o motivo (mínimo de ${min} caracteres) ou toque numa opção` : 'Preencha o campo'));
    const bad = req.validate?.(t);
    if (bad) return setErr(new Error(bad));
    return onDone(t);
  };
  const disabled = req.kind !== 'confirm' && String(text).trim().length < Math.max(min, req.kind === 'value' ? 1 : 0);
  return (
    <Modal open onClose={cancel} title={req.title || 'Confirmar'} guard={false}
      footer={<><button className="btn-ghost" onClick={cancel}>{req.cancelLabel || 'Voltar'}</button>
        <button className={req.danger ? 'btn-danger' : 'btn-primary'} onClick={() => ok()} data-ask-ok data-autofocus={req.kind === 'confirm' && !req.danger ? '' : undefined}
          aria-disabled={disabled || undefined} data-why={req.kind === 'reason' ? 'Toque num motivo ou escreva um' : 'Preencha o campo'}>{req.confirmLabel || 'Confirmar'}</button></>}>
      {req.message && <div className="text-sm">{req.message}</div>}
      {req.kind === 'reason' && !!req.reasons?.length && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Motivos frequentes">
          {req.reasons.map((r) => (
            <button key={r} type="button" onClick={() => setText(r)} aria-pressed={text === r} data-ask-reason={r}
              className={`min-h-[44px] rounded-full border px-3 text-sm font-semibold ${text === r ? 'border-copper bg-copper/15 ring-2 ring-copper/40' : 'border-line hover:bg-raised'}`}>{r}</button>
          ))}
        </div>
      )}
      {req.kind !== 'confirm' && (
        <Field label={req.label || (req.kind === 'reason' ? (req.reasons?.length ? 'Ou escreva o motivo' : 'Motivo') : 'Valor')} className="mt-3">
          <input className="input" value={text} inputMode={req.inputMode} placeholder={req.placeholder} maxLength={req.maxLength || 200}
            onChange={(e) => { setText(e.target.value); setErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} data-ask-input
            {...(req.reasons?.length ? {} : { 'data-autofocus': '' })} />
        </Field>
      )}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

/* Botão que nunca fica "apagado sem explicação": quando falta algo, o toque mostra o que falta. */
export function GuardedButton({ missing, className = 'btn-primary', children, ...rest }) {
  return <button {...rest} className={className} aria-disabled={missing ? 'true' : undefined} data-why={missing || undefined}>{children}</button>;
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={`flex items-start gap-3 rounded-lg p-2 ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-raised'}`}>
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full border border-line transition ${checked ? 'bg-copper' : 'bg-raised'}`}>
        <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
}

// Avisos rápidos. push(texto, tom, { action: { label, run }, ms })
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const drop = useCallback((id) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback((msg, tone = 'ok', opts = {}) => {
    const id = Math.random();
    setItems((xs) => [...xs.slice(-3), { id, msg, tone, action: opts.action }]);
    setTimeout(() => drop(id), opts.ms || (opts.action ? 9000 : tone === 'bad' ? 6000 : 3500));
  }, [drop]);
  // Botão "indisponível" (aria-disabled) nunca fica mudo: o toque explica o que falta (data-why) em vez de não fazer nada
  useEffect(() => {
    const onClick = (e) => {
      const el = e.target.closest?.('[aria-disabled="true"]');
      if (!el || el.getAttribute('role') === 'switch') return;
      e.preventDefault(); e.stopPropagation();
      push(el.getAttribute('data-why') || 'Preencha o que falta para continuar.', 'warn');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [push]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-20 right-3 z-[60] flex max-w-sm flex-col gap-2 md:bottom-4 md:right-4" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="pointer-events-auto card p-3 shadow-lg" data-toast={t.tone}>
            <div className="flex items-start gap-2">
              <div className="flex-1"><Badge tone={t.tone}>{t.tone === 'bad' ? 'Erro' : t.tone === 'warn' ? 'Atenção' : t.tone === 'info' ? 'Aviso' : 'Pronto'}</Badge><div className="mt-1 text-sm">{t.msg}</div></div>
              <button className="-m-1 flex h-9 w-9 items-center justify-center rounded text-muted hover:bg-raised" onClick={() => drop(t.id)} aria-label="Fechar aviso"><X size={16} /></button>
            </div>
            {t.action && <button className="btn-primary mt-2 w-full" onClick={() => { drop(t.id); t.action.run(); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// Carregamento de dados com estados de carregando/erro/recarregar
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try { setState({ data: await fn(), loading: false, error: null }); }
    catch (e) { setState({ data: null, loading: false, error: e }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}
