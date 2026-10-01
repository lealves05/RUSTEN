// Páginas públicas (sem login): cardápio digital com carrinho, acompanhamento do pedido, avaliação e descadastro.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bike, CheckCircle2, Clock, Minus, Plus, ShoppingBag, Star, Store, X } from 'lucide-react';
import { publicApi, newKey } from '../lib/api.js';
import { money } from '../lib/format.js';
import { ErrorBox, Field, Loading, Logo, Modal } from '../components/ui.jsx';

function Shell({ children, title }) {
  useEffect(() => { if (title) document.title = title; }, [title]);
  return <div className="min-h-screen bg-bg text-ink"><div className="mx-auto max-w-3xl px-4 pb-28 pt-4">{children}</div>
    <footer className="py-6 text-center text-xs text-muted">Pedidos com tecnologia <b>RUSTEN</b></footer></div>;
}

const lineCents = (l) => (l.product.price_cents + l.options.reduce((s, o) => s + o.price_cents, 0)) * l.qty;

export function PublicMenu() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [cart, setCart] = useState(() => { try { return JSON.parse(sessionStorage.getItem(`rusten.cart.${slug}`)) || []; } catch { return []; } });
  const [adding, setAdding] = useState(null);
  const [checkout, setCheckout] = useState(false);
  const [cat, setCat] = useState('');
  useEffect(() => { publicApi(`/api/public/${slug}/menu`).then(setData).catch(setErr); }, [slug]);
  useEffect(() => { try { sessionStorage.setItem(`rusten.cart.${slug}`, JSON.stringify(cart)); } catch { /* sem armazenamento */ } }, [cart, slug]);
  const cats = useMemo(() => [...new Set((data?.products || []).map((p) => p.category || 'Outros'))], [data]);
  if (err) return <Shell><div className="mt-10"><ErrorBox error={err} /></div></Shell>;
  if (!data) return <Shell><Loading /></Shell>;
  const st = data.settings;
  const total = cart.reduce((s, l) => s + lineCents(l), 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);
  const shown = data.products.filter((p) => !cat || (p.category || 'Outros') === cat);
  return (
    <Shell title={`${data.company.name} — cardápio`}>
      <header className="rounded-2xl bg-copper p-5 text-white dark:text-black">
        <h1 className="font-display text-4xl leading-none tracking-wide">{data.company.name}</h1>
        <div className="mt-2 flex flex-wrap gap-3 text-sm opacity-90">
          {st.hours && <span><Clock size={14} className="inline" /> {st.hours}</span>}
          {st.delivery && <span><Bike size={14} className="inline" /> Entrega {st.fee_cents ? money(st.fee_cents) : 'grátis'} · ~{st.eta_minutes} min</span>}
          {st.pickup && <span><Store size={14} className="inline" /> Retirada</span>}
        </div>
        {st.message && <p className="mt-2 text-sm font-semibold">{st.message}</p>}
      </header>
      {!st.accepting && <div className="mt-3 rounded-xl border border-warn/50 bg-warn/10 p-3 text-sm font-semibold">No momento não estamos recebendo pedidos. Você pode ver o cardápio.</div>}
      {st.min_order_cents > 0 && <p className="mt-2 text-xs text-muted">Pedido mínimo {money(st.min_order_cents)}{st.areas ? ` · Entregamos em: ${st.areas}` : ''}</p>}
      <nav className="sticky top-0 z-10 -mx-4 mt-3 flex gap-1 overflow-x-auto bg-bg/95 px-4 py-2 backdrop-blur">
        {['', ...cats].map((c) => <button key={c || 'all'} onClick={() => setCat(c)} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${cat === c ? 'border-copper bg-copper text-white dark:text-black' : 'border-line bg-surface'}`}>{c || 'Tudo'}</button>)}
      </nav>
      <div className="mt-2 space-y-2">
        {shown.map((p) => (
          <button key={p.id} className="card flex w-full items-start justify-between gap-3 p-3 text-left hover:border-copper" onClick={() => setAdding(p)} disabled={!st.accepting} data-product={p.name}>
            <div><div className="font-semibold">{p.name}</div>{p.description && <div className="text-sm text-muted">{p.description}</div>}
              {p.allergens && <div className="text-xs text-muted">Contém: {p.allergens}</div>}</div>
            <div className="whitespace-nowrap font-display text-xl text-copper">{money(p.price_cents)}</div>
          </button>
        ))}
      </div>
      {count > 0 && st.accepting && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-3 shadow-2xl">
          <button className="btn-primary btn-xl mx-auto flex w-full max-w-3xl justify-between" onClick={() => setCheckout(true)} data-checkout>
            <span><ShoppingBag size={18} className="inline" /> {count} item(ns)</span><span>Ver pedido · {money(total)}</span></button>
        </div>
      )}
      <AddModal product={adding} onClose={() => setAdding(null)} onAdd={(l) => { setCart([...cart, l]); setAdding(null); }} />
      <Checkout open={checkout} slug={slug} data={data} cart={cart} setCart={setCart} onClose={() => setCheckout(false)} />
    </Shell>
  );
}

function AddModal({ product, onClose, onAdd }) {
  const [qty, setQty] = useState(1);
  const [sel, setSel] = useState({});
  const [notes, setNotes] = useState('');
  useEffect(() => { setQty(1); setSel({}); setNotes(''); }, [product]);
  if (!product) return null;
  const options = product.groups.flatMap((g) => (sel[g.id] || []).map((id) => g.options.find((o) => o.id === id))).filter(Boolean);
  const missing = product.groups.find((g) => (sel[g.id] || []).length < g.min);
  const toggle = (g, o) => {
    const cur = sel[g.id] || [];
    const next = cur.includes(o.id) ? cur.filter((x) => x !== o.id) : g.max === 1 ? [o.id] : cur.length < g.max ? [...cur, o.id] : cur;
    setSel({ ...sel, [g.id]: next });
  };
  return (
    <Modal open onClose={onClose} title={product.name} footer={<button className="btn-primary w-full" disabled={!!missing} onClick={() => onAdd({ product, qty, options, notes })} data-add>
      {missing ? `Escolha ${missing.name.toLowerCase()}` : `Adicionar · ${money((product.price_cents + options.reduce((s, o) => s + o.price_cents, 0)) * qty)}`}</button>}>
      {product.description && <p className="text-sm text-muted">{product.description}</p>}
      {product.groups.map((g) => (
        <fieldset key={g.id} className="mt-3"><legend className="label">{g.name} {g.min > 0 ? '(obrigatório)' : '(opcional)'}{g.max > 1 ? ` · até ${g.max}` : ''}</legend>
          <div className="space-y-1">{g.options.map((o) => (
            <label key={o.id} className="flex items-center justify-between rounded-lg border border-line p-2"><span className="flex items-center gap-2">
              <input type={g.max === 1 ? 'radio' : 'checkbox'} name={`g${g.id}`} checked={(sel[g.id] || []).includes(o.id)} onChange={() => toggle(g, o)} /> {o.name}</span>
              {o.price_cents > 0 && <span className="text-sm">+ {money(o.price_cents)}</span>}</label>))}</div>
        </fieldset>
      ))}
      <Field label="Observação" className="mt-3"><input className="input" maxLength={140} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: sem cebola" /></Field>
      <div className="mt-3 flex items-center justify-center gap-4">
        <button className="btn-ghost" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Menos"><Minus size={16} /></button>
        <span className="font-display text-3xl">{qty}</span>
        <button className="btn-ghost" onClick={() => setQty(Math.min(50, qty + 1))} aria-label="Mais"><Plus size={16} /></button>
      </div>
    </Modal>
  );
}

function Checkout({ open, slug, data, cart, setCart, onClose }) {
  const st = data.settings;
  const [f, setF] = useState({ mode: st.delivery ? 'entrega' : 'retirada', customer_name: '', phone: '', street: '', number: '', district: '', complement: '', reference: '', payment_hint: st.payment_methods[0], change: '', notes: '', website: '' });
  const [key] = useState(() => newKey() + newKey().slice(0, 8));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const sub = cart.reduce((s, l) => s + lineCents(l), 0);
  const fee = f.mode === 'entrega' ? st.fee_cents : 0;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const change = f.payment_hint === 'dinheiro' && f.change ? Math.round(Number(f.change.replace(',', '.')) * 100) : undefined;
      const r = await publicApi(`/api/public/${slug}/orders`, { method: 'POST', body: {
        mode: f.mode, customer_name: f.customer_name, phone: f.phone, payment_hint: f.payment_hint, change_for_cents: change, notes: f.notes || undefined, website: f.website || undefined,
        address: f.mode === 'entrega' ? { street: f.street, number: f.number, district: f.district, complement: f.complement, reference: f.reference } : undefined,
        cart: cart.map((l) => ({ product_id: l.product.id, qty: l.qty, option_ids: l.options.map((o) => o.id), notes: l.notes || undefined })), client_key: key } });
      setCart([]);
      try { sessionStorage.removeItem(`rusten.cart.${slug}`); } catch { /* ok */ }
      window.location.assign(`/pedido/${r.token}`);
    } catch (e) { setErr(e); setBusy(false); }
  };
  return (
    <Modal open wide onClose={onClose} title="Seu pedido" footer={<button className="btn-primary btn-xl w-full" disabled={busy || !cart.length} onClick={send} data-send>{busy ? 'Enviando…' : `Enviar pedido · ${money(sub + fee)}`}</button>}>
      <ul className="divide-y divide-line">{cart.map((l, i) => (
        <li key={i} className="flex items-start gap-2 py-2 text-sm"><div className="flex-1"><b>{l.qty}× {l.product.name}</b>{!!l.options.length && <div className="text-xs text-muted">{l.options.map((o) => o.name).join(', ')}</div>}{l.notes && <div className="text-xs italic text-muted">{l.notes}</div>}</div>
          <span>{money(lineCents(l))}</span><button onClick={() => setCart(cart.filter((_, j) => j !== i))} aria-label="Remover"><X size={14} /></button></li>))}</ul>
      <div className="mt-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(sub)}</span></div>{fee > 0 && <div className="flex justify-between"><span>Entrega</span><span>{money(fee)}</span></div>}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">{[['entrega', 'Entrega', st.delivery], ['retirada', 'Retirar no local', st.pickup]].filter((x) => x[2]).map(([k, l]) => (
        <button key={k} aria-pressed={f.mode === k} onClick={() => setF({ ...f, mode: k })} className={`rounded-lg border p-3 font-semibold ${f.mode === k ? 'border-copper bg-copper/15' : 'border-line'}`}>{l}</button>))}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Seu nome"><input className="input" autoComplete="name" value={f.customer_name} onChange={set('customer_name')} /></Field>
        <Field label="Celular com DDD"><input className="input" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /></Field>
        {f.mode === 'entrega' && <>
          <Field label="Rua"><input className="input" autoComplete="address-line1" value={f.street} onChange={set('street')} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Número"><input className="input" value={f.number} onChange={set('number')} /></Field><Field label="Bairro"><input className="input" value={f.district} onChange={set('district')} /></Field></div>
          <Field label="Complemento"><input className="input" value={f.complement} onChange={set('complement')} /></Field>
          <Field label="Referência"><input className="input" value={f.reference} onChange={set('reference')} /></Field>
        </>}
        <Field label={`Pagamento na ${f.mode === 'entrega' ? 'entrega' : 'retirada'}`}><select className="input" value={f.payment_hint} onChange={set('payment_hint')}>{st.payment_methods.map((m) => <option key={m} value={m}>{({ dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão' })[m]}</option>)}</select></Field>
        {f.payment_hint === 'dinheiro' && <Field label="Troco para (R$)"><input className="input" inputMode="decimal" value={f.change} onChange={set('change')} /></Field>}
        <Field label="Observações do pedido" className="sm:col-span-2"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
        <input type="text" tabIndex={-1} autoComplete="off" className="hidden" value={f.website} onChange={set('website')} aria-hidden />
      </div>
      <p className="mt-2 text-xs text-muted">O pagamento é feito na {f.mode === 'entrega' ? 'entrega' : 'retirada'}. Seus dados são usados só para este pedido.</p>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

const STEPS = ['recebido', 'confirmado', 'em_preparo', 'pronto', 'saiu', 'entregue'];
export function PublicOrder() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    const load = () => publicApi(`/api/public/orders/${token}`).then((x) => { setD(x); setErr(null); }).catch(setErr);
    load(); const t = setInterval(load, 15000); return () => clearInterval(t);
  }, [token]);
  if (err && !d) return <Shell><div className="mt-10"><ErrorBox error={err} /></div></Shell>;
  if (!d) return <Shell><Loading /></Shell>;
  const steps = STEPS.filter((x) => (d.mode === 'entrega' ? true : x !== 'saiu'));
  const at = steps.indexOf(d.status === 'em_preparo' ? 'em_preparo' : d.status);
  return (
    <Shell title={`Pedido #${d.number} — ${d.company}`}>
      <div className="card p-5 text-center">
        <div className="text-sm text-muted">{d.company}</div>
        <h1 className="font-display text-5xl">Pedido #{d.number}</h1>
        <p className="mt-1">Obrigado, {d.first_name}!</p>
        <div className={`mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 font-semibold ${d.status === 'cancelado' ? 'bg-rust/15 text-rust' : 'bg-copper/15 text-copper'}`} data-status={d.status}>{d.label}</div>
        {['recebido', 'confirmado', 'em_preparo'].includes(d.status) && d.eta_minutes && <p className="mt-2 text-sm text-muted">Previsão: cerca de {d.eta_minutes} min</p>}
      </div>
      {d.status !== 'cancelado' && <ol className="mt-4 space-y-2">{steps.map((x, i) => (
        <li key={x} className={`flex items-center gap-2 ${i <= at ? 'font-semibold' : 'text-muted'}`}>{i <= at ? <CheckCircle2 size={18} className="text-ok" /> : <span className="inline-block h-[18px] w-[18px] rounded-full border border-line" />}
          {({ recebido: 'Recebido', confirmado: 'Confirmado pelo estabelecimento', em_preparo: 'Em preparo', pronto: d.mode === 'entrega' ? 'Pronto' : 'Pronto para retirar', saiu: 'Saiu para entrega', entregue: d.mode === 'entrega' ? 'Entregue' : 'Retirado' })[x]}</li>))}</ol>}
      <div className="card mt-4 p-4 text-sm">
        {d.items.map((i, n) => <div key={n} className="flex justify-between"><span>{Number(i.qty)}× {i.description}</span><span>{money(i.total_cents)}</span></div>)}
        {d.totals.delivery_fee > 0 && <div className="flex justify-between text-muted"><span>Entrega</span><span>{money(d.totals.delivery_fee)}</span></div>}
        <div className="mt-1 flex justify-between font-display text-2xl"><span>Total</span><span>{money(d.totals.total)}</span></div>
      </div>
      <p className="mt-4 text-center text-sm"><Link className="underline" to={`/c/${d.slug}`}>Voltar ao cardápio</Link></p>
    </Shell>
  );
}

export function PublicReview() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => { publicApi(`/api/public/review/${token}`).then(setD).catch(setErr); }, [token]);
  const send = async () => { try { await publicApi(`/api/public/review/${token}`, { method: 'POST', body: { score, comment: comment || undefined } }); setDone(true); } catch (e) { setErr(e); } };
  return (
    <Shell title="Avaliação">
      <div className="mx-auto mt-8 max-w-md card p-6 text-center">
        {!d && !err && <Loading />}
        {err && <ErrorBox error={err} />}
        {d && (done || d.already ? <><CheckCircle2 size={40} className="mx-auto text-ok" /><h1 className="mt-2 font-display text-3xl">Obrigado!</h1><p className="text-sm text-muted">Sua opinião ajuda o {d.company} a melhorar.</p></> : <>
          <h1 className="font-display text-3xl">Como foi no {d.company}?</h1>
          <div className="mt-4 flex justify-center gap-2" role="radiogroup" aria-label="Nota">{[1, 2, 3, 4, 5].map((n) => (
            <button key={n} role="radio" aria-checked={score === n} onClick={() => setScore(n)} aria-label={`${n} estrela(s)`}><Star size={40} className={n <= score ? 'fill-copper text-copper' : 'text-line'} /></button>))}</div>
          <textarea className="input mt-4" rows={3} maxLength={600} placeholder="Quer contar mais? (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <button className="btn-primary mt-3 w-full" disabled={!score} onClick={send}>Enviar avaliação</button></>)}
      </div>
    </Shell>
  );
}

export function Unsubscribe() {
  const { token } = useParams();
  const [state, setState] = useState('ask');
  const [err, setErr] = useState(null);
  const go = async () => { try { await publicApi(`/api/public/unsubscribe/${token}`, { method: 'POST' }); setState('done'); } catch (e) { setErr(e); } };
  return (
    <Shell title="Descadastro">
      <div className="mx-auto mt-8 max-w-md card p-6 text-center">
        <div className="flex justify-center"><Logo size={32} /></div>
        {state === 'done' ? <p className="mt-4">Pronto. Você não receberá mais nossas mensagens promocionais.</p> : <>
          <p className="mt-4">Não quer mais receber mensagens promocionais deste estabelecimento?</p>
          <button className="btn-primary mt-3" onClick={go}>Sim, descadastrar</button></>}
        <div className="mt-3"><ErrorBox error={err} /></div>
      </div>
    </Shell>
  );
}
