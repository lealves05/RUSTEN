// Delivery e retirada: quadro de pedidos por situação, pedido por telefone, entregador, recebimento e cardápio digital.
import { useEffect, useMemo, useState } from 'react';
import { Bike, Copy, ExternalLink, Phone, Plus, Settings2, Store, Trash2 } from 'lucide-react';
import { api, newKey } from '../lib/api.js';
import { money, time, parseCents, centsToInput } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Toggle, useLoad, useToast } from '../components/ui.jsx';

export const DSTATUS = { recebido: 'Recebido', confirmado: 'Confirmado', em_preparo: 'Em preparo', pronto: 'Pronto', saiu: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
const COLS = [['recebido', 'Novos'], ['confirmado', 'Em produção'], ['pronto', 'Prontos'], ['saiu', 'Em rota']];
const NEXT = { recebido: ['confirmado', 'Confirmar'], confirmado: ['pronto', 'Marcar pronto'], em_preparo: ['pronto', 'Marcar pronto'], saiu: ['entregue', 'Entregue'] };
const PAY = { dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão' };
const KSTAT = { novo: 'na fila', aceito: 'aceito', preparando: 'preparando', pronto: 'pronto', entregue: 'entregue', cancelado: 'cancelado', nao_produz: '' };

export default function Delivery() {
  const s = useSession();
  const toast = useToast();
  const [filter, setFilter] = useState('abertos');
  const orders = useLoad(() => api(`/api/delivery/orders?status=${filter}`), [filter]);
  const cfg = useLoad(() => api('/api/delivery/settings'), []);
  const couriers = useLoad(() => api('/api/delivery/couriers'), []);
  const [modal, setModal] = useState(null);
  const [pay, setPay] = useState(null);
  useEffect(() => { const t = setInterval(() => orders.reload(), 10000); return () => clearInterval(t); }, [orders.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = async (o, to, extra = {}) => {
    try { await api(`/api/delivery/orders/${o.id}/status`, { method: 'POST', body: { to, ...extra } }); orders.reload(); }
    catch (e) { if (e.code === 'balance_pending') setPay(o); else toast(e.message, 'bad'); }
  };
  const cancel = async (o) => { const reason = prompt(`Motivo do cancelamento do pedido #${o.number}:`); if (reason) move(o, 'cancelado', { reason }); };
  const setCourier = async (o, id) => { try { await api(`/api/delivery/orders/${o.id}/courier`, { method: 'POST', body: { courier_id: id ? Number(id) : null } }); orders.reload(); } catch (e) { toast(e.message, 'bad'); } };
  const menuUrl = cfg.data?.slug ? `${location.origin}/c/${cfg.data.slug}` : null;
  const grouped = useMemo(() => {
    const g = Object.fromEntries(COLS.map(([k]) => [k, []]));
    for (const o of orders.data || []) { const k = o.status === 'em_preparo' ? 'confirmado' : o.status; if (g[k]) g[k].push(o); }
    return g;
  }, [orders.data]);

  return (
    <div>
      <PageHeader title="Delivery" subtitle="Pedidos do cardápio digital, WhatsApp e telefone. Preço e disponibilidade são sempre conferidos no servidor."
        actions={<>
          <button className="btn-primary" onClick={() => setModal('new')}><Phone size={16} /> Pedido por telefone</button>
          {s.can('configuracoes.gerenciar') && <button className="btn-ghost" onClick={() => setModal('cfg')}><Settings2 size={16} /> Cardápio digital</button>}
        </>} />
      {cfg.data && (
        <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${cfg.data.enabled ? 'border-ok/40 bg-ok/10' : 'border-line bg-raised'}`}>
          {cfg.data.enabled ? <>
            <Badge tone={cfg.data.accepting ? 'ok' : 'warn'}>{cfg.data.accepting ? 'Recebendo pedidos' : 'Pausado'}</Badge>
            <span className="font-mono text-xs">{menuUrl}</span>
            <button className="text-xs underline" onClick={() => { navigator.clipboard?.writeText(menuUrl); toast('Link copiado'); }}><Copy size={12} className="inline" /> copiar</button>
            <a className="text-xs underline" href={menuUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} className="inline" /> abrir</a>
            {s.can('configuracoes.gerenciar') && <button className="btn-ghost ml-auto py-1" onClick={async () => { await api('/api/delivery/settings', { method: 'PUT', body: { ...strip(cfg.data), accepting: !cfg.data.accepting } }).catch((e) => toast(e.message, 'bad')); cfg.reload(); }}>
              {cfg.data.accepting ? 'Pausar pedidos' : 'Voltar a receber'}</button>}
          </> : <span>Cardápio digital desligado. Configure em <b>Cardápio digital</b> para receber pedidos online.</span>}
        </div>
      )}
      <div className="mb-3 flex gap-1">{[['abertos', 'Em andamento'], ['hoje', 'Últimas 24h']].map(([k, l]) => (
        <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === k ? 'border-copper bg-copper text-white dark:text-black' : 'border-line bg-surface'}`}>{l}</button>))}</div>
      {orders.loading && !orders.data ? <Loading /> : orders.error ? <ErrorBox error={orders.error} onRetry={orders.reload} /> : !orders.data.length ? (
        <Empty icon={Bike} title="Nenhum pedido">Os pedidos do cardápio digital chegam aqui e tocam na cozinha assim que você confirmar.</Empty>
      ) : filter === 'hoje' ? (
        <div className="card overflow-x-auto"><table className="table-clean"><thead><tr><th>#</th><th>Hora</th><th>Cliente</th><th>Modo</th><th>Canal</th><th>Situação</th><th className="text-right">Total</th></tr></thead>
          <tbody>{orders.data.map((o) => <tr key={o.id}><td>{o.number}</td><td>{time(o.created_at, s.tz)}</td><td>{o.customer_name}</td><td>{o.mode}</td><td>{o.channel}</td><td>{DSTATUS[o.status]}</td>
            <td className="text-right">{money(Number(o.items_cents) + Number(o.delivery_fee_cents))}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLS.map(([k, label]) => (
            <section key={k}>
              <h2 className="mb-2 flex items-center gap-2 font-display text-2xl">{label} <Badge tone={k === 'recebido' ? 'warn' : 'info'}>{grouped[k].length}</Badge></h2>
              <div className="space-y-3">
                {grouped[k].map((o) => {
                  const total = Number(o.items_cents) + Number(o.delivery_fee_cents);
                  const due = total - Number(o.paid_cents);
                  return (
                    <article key={o.id} className="card p-3" data-delivery={o.number}>
                      <div className="flex items-start justify-between gap-2">
                        <div><div className="font-display text-2xl leading-none">#{o.number}</div><div className="text-xs text-muted">{time(o.created_at, s.tz)} · {o.channel}</div></div>
                        <Badge tone={o.mode === 'entrega' ? 'info' : 'muted'} icon={o.mode === 'entrega' ? Bike : Store}>{o.mode}</Badge>
                      </div>
                      <div className="mt-2 text-sm font-semibold">{o.customer_name} · <span className="font-normal">{o.phone}</span></div>
                      {o.mode === 'entrega' && <div className="text-xs text-muted">{o.address.street}, {o.address.number}{o.address.district ? ` — ${o.address.district}` : ''}{o.address.complement ? ` (${o.address.complement})` : ''}</div>}
                      <ul className="mt-2 text-sm">{(o.items || []).filter((i) => i.status === 'ativo').map((i, n) => (
                        <li key={n}>{Number(i.qty)}× {i.description}{i.modifiers?.length ? <span className="text-xs text-muted"> ({i.modifiers.map((x) => x.name).join(', ')})</span> : null}
                          {KSTAT[i.kitchen_status] && o.status !== 'recebido' && <span className="text-[10px] uppercase text-muted"> · {KSTAT[i.kitchen_status]}</span>}</li>))}</ul>
                      {o.notes && <div className="mt-1 text-xs text-warn">Obs.: {o.notes}</div>}
                      <div className="mt-2 flex items-center justify-between text-sm"><span>{PAY[o.payment_hint] || 'pagamento a combinar'}{o.change_for_cents ? ` · troco p/ ${money(o.change_for_cents)}` : ''}</span><b>{money(total)}</b></div>
                      {due > 0 ? <div className="text-xs text-warn">A receber: {money(due)}</div> : <div className="text-xs text-ok">Pago</div>}
                      {o.mode === 'entrega' && ['confirmado', 'em_preparo', 'pronto'].includes(o.status) && (
                        <select className="input mt-2 py-1 text-sm" value={o.courier_id || ''} onChange={(e) => setCourier(o, e.target.value)} aria-label="Entregador">
                          <option value="">Entregador…</option>{(couriers.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>)}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {NEXT[o.status] && <button className="btn-primary flex-1 py-1.5" onClick={() => move(o, NEXT[o.status][0])}>{NEXT[o.status][1]}</button>}
                        {o.status === 'pronto' && (o.mode === 'entrega'
                          ? <button className="btn-primary flex-1 py-1.5" onClick={() => move(o, 'saiu')}>Saiu para entrega</button>
                          : <button className="btn-primary flex-1 py-1.5" onClick={() => (due > 0 ? setPay(o) : move(o, 'entregue'))}>Retirado</button>)}
                        {due > 0 && s.can('pdv.receber') && <button className="btn-ghost py-1.5" onClick={() => setPay(o)}>Receber</button>}
                        <button className="btn-ghost py-1.5 text-rust" onClick={() => cancel(o)} aria-label="Cancelar pedido"><Trash2 size={14} /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <NewOrderModal open={modal === 'new'} onClose={() => setModal(null)} onSaved={(o) => { setModal(null); orders.reload(); toast(`Pedido #${o.number} registrado e enviado à cozinha`); }} />
      <SettingsModal open={modal === 'cfg'} data={cfg.data} onClose={() => setModal(null)} onSaved={() => { setModal(null); cfg.reload(); toast('Cardápio digital salvo'); }} />
      <PayModal order={pay} onClose={() => setPay(null)} onDone={async (finish) => { const o = pay; setPay(null); if (finish) await move(o, 'entregue'); orders.reload(); }} />
    </div>
  );
}

const strip = (c) => { const { suggested_slug, ...rest } = c; return { ...rest, slug: c.slug || suggested_slug }; }; // eslint-disable-line no-unused-vars

function PayModal({ order, onClose, onDone }) {
  const s = useSession();
  const [method, setMethod] = useState('pix');
  const [err, setErr] = useState(null);
  useEffect(() => { if (order) { setErr(null); setMethod(order.payment_hint === 'cartao' ? 'credito' : order.payment_hint || 'pix'); } }, [order]);
  if (!order) return null;
  const due = Number(order.items_cents) + Number(order.delivery_fee_cents) - Number(order.paid_cents);
  const go = async () => {
    try {
      await api(`/api/pdv/sessions/${order.session_id}/payments`, { method: 'POST', body: { method, amount_cents: due, idempotency_key: newKey() } });
      const finish = ['saiu', 'pronto'].includes(order.status);
      if (finish) {
        const full = await api(`/api/pdv/sessions/${order.session_id}`);
        await api(`/api/pdv/sessions/${order.session_id}/close`, { method: 'POST', body: { version: full.version } }).catch(() => {});
      }
      onDone(finish);
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Receber pedido #${order.number}`} footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={!s.can('pdv.receber')} onClick={go}>Receber {money(due)}</button></>}>
      <div className="grid grid-cols-2 gap-2">{[['pix', 'Pix'], ['dinheiro', 'Dinheiro'], ['debito', 'Débito'], ['credito', 'Crédito']].map(([k, l]) => (
        <button key={k} aria-pressed={method === k} onClick={() => setMethod(k)} className={`rounded-lg border p-3 font-semibold ${method === k ? 'border-copper bg-copper/15' : 'border-line'}`}>{l}</button>))}</div>
      <p className="mt-2 text-xs text-muted">Pagamento na entrega/retirada, informado pelo operador. O caixa do terminal precisa estar aberto.</p>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function NewOrderModal({ open, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [f, setF] = useState({});
  const [cart, setCart] = useState([]);
  const [pick, setPick] = useState('');
  const [err, setErr] = useState(null);
  const [key, setKey] = useState(newKey());
  useEffect(() => {
    if (!open) return;
    setF({ mode: 'entrega', customer_name: '', phone: '', street: '', number: '', district: '', payment_hint: 'pix', notes: '' }); setCart([]); setErr(null); setKey(newKey());
    api('/api/menu/products').then((p) => setProducts(p.filter((x) => x.active && x.kind !== 'weight'))).catch(setErr);
  }, [open]);
  if (!open) return null;
  const add = () => {
    const p = products.find((x) => String(x.id) === pick); if (!p) return;
    const opts = p.groups.filter((g) => g.min > 0).map((g) => g.options[0]?.id).filter(Boolean);
    setCart([...cart, { product: p, qty: 1, option_ids: opts }]); setPick('');
  };
  const total = cart.reduce((s, c) => s + (c.product.price_cents + c.product.groups.flatMap((g) => g.options).filter((o) => c.option_ids.includes(o.id)).reduce((a, o) => a + o.price_cents, 0)) * c.qty, 0);
  const save = async () => {
    try {
      const body = { mode: f.mode, channel: 'telefone', customer_name: f.customer_name, phone: f.phone, payment_hint: f.payment_hint, notes: f.notes || undefined, client_key: key,
        address: f.mode === 'entrega' ? { street: f.street, number: f.number, district: f.district } : undefined,
        cart: cart.map((c) => ({ product_id: c.product.id, qty: c.qty, option_ids: c.option_ids })) };
      onSaved(await api('/api/delivery/orders', { method: 'POST', body }));
    } catch (e) { setErr(e); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open wide onClose={onClose} title="Pedido por telefone" footer={<><span className="mr-auto font-display text-xl">{money(total)} + entrega</span><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={!cart.length} onClick={save}>Registrar pedido</button></>}>
      <div className="grid grid-cols-2 gap-2">{[['entrega', 'Entrega'], ['retirada', 'Retirada']].map(([k, l]) => (
        <button key={k} aria-pressed={f.mode === k} onClick={() => setF({ ...f, mode: k })} className={`rounded-lg border p-3 font-semibold ${f.mode === k ? 'border-copper bg-copper/15' : 'border-line'}`}>{l}</button>))}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><input className="input" value={f.customer_name} onChange={set('customer_name')} /></Field>
        <Field label="Telefone com DDD"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        {f.mode === 'entrega' && <>
          <Field label="Rua"><input className="input" value={f.street} onChange={set('street')} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Número"><input className="input" value={f.number} onChange={set('number')} /></Field><Field label="Bairro"><input className="input" value={f.district} onChange={set('district')} /></Field></div>
        </>}
        <Field label="Pagamento"><select className="input" value={f.payment_hint} onChange={set('payment_hint')}>{Object.entries(PAY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Observações"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="mt-3 flex gap-2">
        <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Produto"><option value="">Adicionar produto…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price_cents)}</option>)}</select>
        <button className="btn-ghost" onClick={add} disabled={!pick}><Plus size={16} /></button>
      </div>
      <ul className="mt-2 divide-y divide-line">{cart.map((c, i) => (
        <li key={i} className="flex items-center gap-2 py-2 text-sm">
          <input className="input w-16 py-1" inputMode="numeric" value={c.qty} onChange={(e) => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) } : x)))} aria-label="Quantidade" />
          <span className="flex-1">{c.product.name}</span>
          {c.product.groups.map((g) => (
            <select key={g.id} className="input w-auto py-1" value={c.option_ids.find((id) => g.options.some((o) => o.id === id)) || ''} aria-label={g.name}
              onChange={(e) => setCart(cart.map((x, j) => (j === i ? { ...x, option_ids: [...x.option_ids.filter((id) => !g.options.some((o) => o.id === id)), ...(e.target.value ? [Number(e.target.value)] : [])] } : x)))}>
              {g.min === 0 && <option value="">{g.name}…</option>}{g.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>))}
          <button onClick={() => setCart(cart.filter((_, j) => j !== i))} aria-label="Remover"><Trash2 size={14} /></button>
        </li>))}</ul>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function SettingsModal({ open, data, onClose, onSaved }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open && data) { setErr(null); setF({ ...strip(data), fee: centsToInput(data.fee_cents), min: centsToInput(data.min_order_cents) }); } }, [open, data]);
  if (!open || !f) return null;
  const save = async () => {
    try {
      const { fee, min, ...rest } = f;
      await api('/api/delivery/settings', { method: 'PUT', body: { ...rest, fee_cents: parseCents(fee) ?? 0, min_order_cents: parseCents(min) ?? 0, eta_minutes: Number(f.eta_minutes) } });
      onSaved();
    } catch (e) { setErr(e); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open wide onClose={onClose} title="Cardápio digital e delivery" footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Cardápio digital ligado" hint="Página pública com o cardápio e pedidos online." />
        <Toggle checked={f.accepting} onChange={(v) => setF({ ...f, accepting: v })} label="Recebendo pedidos agora" />
        <Toggle checked={f.delivery} onChange={(v) => setF({ ...f, delivery: v })} label="Entrega" />
        <Toggle checked={f.pickup} onChange={(v) => setF({ ...f, pickup: v })} label="Retirada no balcão" />
        <Field label="Endereço da página" hint={`${location.origin}/c/${f.slug || '…'}`}><input className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></Field>
        <Field label="Previsão (minutos)"><input className="input" inputMode="numeric" value={f.eta_minutes} onChange={set('eta_minutes')} /></Field>
        <Field label="Taxa de entrega (R$)"><input className="input" inputMode="decimal" value={f.fee} onChange={set('fee')} /></Field>
        <Field label="Pedido mínimo (R$)"><input className="input" inputMode="decimal" value={f.min} onChange={set('min')} /></Field>
        <Field label="Horários" className="sm:col-span-2"><input className="input" value={f.hours} onChange={set('hours')} placeholder="Ex.: Ter a dom, 18h às 0h" /></Field>
        <Field label="Área de entrega" className="sm:col-span-2"><input className="input" value={f.areas} onChange={set('areas')} placeholder="Bairros atendidos" /></Field>
        <Field label="Recado no topo do cardápio" className="sm:col-span-2"><input className="input" value={f.message} onChange={set('message')} /></Field>
        <div className="sm:col-span-2"><span className="label">Formas de pagamento na entrega</span>
          <div className="flex gap-3">{Object.entries(PAY).map(([k, l]) => <label key={k} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.payment_methods.includes(k)}
            onChange={(e) => setF({ ...f, payment_methods: e.target.checked ? [...f.payment_methods, k] : f.payment_methods.filter((x) => x !== k) })} /> {l}</label>)}</div></div>
      </div>
      <p className="mt-3 text-xs text-muted">Pagamento online só será oferecido quando houver integração de pagamento operacional. Produtos aparecem no cardápio digital quando o canal "delivery" ou "cardápio digital" está marcado no cadastro.</p>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
