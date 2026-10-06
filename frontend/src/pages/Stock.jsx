// Estoque: insumos e saldos, fichas técnicas versionadas, compras com recebimento parcial, inventário e produção.
import { useEffect, useRef, useState } from 'react';
import { Barcode, Camera, CheckCircle2, ClipboardCheck, Download, FileCode2, Keyboard, Loader2, Package, Plus, Printer, ScanLine, ShieldCheck, ShoppingCart, Trash2, Wrench, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { code128Svg, startScanner } from '../lib/barcode.js';
import { api, download } from '../lib/api.js';
import { money, dateTime, parseCents, centsToInput } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Toggle, useLoad, useToast, useAsk, GuardedButton } from '../components/ui.jsx';

const UNITS = ['un', 'kg', 'g', 'L', 'ml'];
const num = (v) => Number(String(v).replace(',', '.'));
const qfmt = (n, u) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${u}`;
const MOV = { entrada: 'Entrada', venda: 'Venda', estorno_venda: 'Estorno de venda', perda: 'Perda', ajuste: 'Ajuste', inventario: 'Inventário', producao_consumo: 'Produção (consumo)', producao_entrada: 'Produção (entrada)', reversao: 'Reversão', correcao: 'Correção' };
const TABS = [['nota', 'Lançar nota'], ['insumos', 'Insumos'], ['fichas', 'Fichas técnicas'], ['compras', 'Compras'], ['inventario', 'Inventário'], ['correcoes', 'Correções']];

export default function Stock() {
  const [tab, setTab] = useState('insumos');
  const items = useLoad(() => api('/api/stock/items'), []);
  return (
    <div>
      <PageHeader title="Estoque" subtitle="Vendas baixam os insumos da ficha técnica no lançamento; cancelamento antes do preparo devolve. Movimentos nunca são editados." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold uppercase tracking-wide ${tab === k ? 'border-copper text-copper' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>)}
      </div>
      {items.error && <ErrorBox error={items.error} onRetry={items.reload} />}
      {tab === 'nota' && <NoteImport stock={items.data || []} onDone={() => { items.reload(); setTab('insumos'); }} />}
      {tab === 'insumos' && <Items items={items} />}
      {tab === 'correcoes' && <Corrections stock={items.data || []} onChanged={items.reload} goItems={() => setTab('insumos')} />}
      {tab === 'fichas' && <Recipes stock={items.data || []} />}
      {tab === 'compras' && <Purchases stock={items.data || []} onChanged={items.reload} />}
      {tab === 'inventario' && <Inventory stock={items.data || []} onChanged={items.reload} goItems={() => setTab('insumos')} />}
    </div>
  );
}

function Items({ items }) {
  const s = useSession();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [mov, setMov] = useState(null);
  const [hist, setHist] = useState(null);
  const [fix, setFix] = useState(null);
  const [fromMenu, setFromMenu] = useState(false);
  const pol = useLoad(() => api('/api/stock/settings'), []);
  if (items.loading && !items.data) return <Loading />;
  const list = items.data || [];
  const low = list.filter((i) => i.status !== 'ok');
  const savePolicy = async (patch) => {
    try { await api('/api/stock/settings', { method: 'PUT', body: { ...pol.data, ...patch } }); pol.reload(); toast('Política de estoque salva'); } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {s.can('estoque.ajustar') && <button className="btn-primary" onClick={() => setEdit({})}><Plus size={16} /> Novo insumo</button>}
        {s.can('estoque.ajustar') && <button className="btn-ghost" onClick={() => setFromMenu(true)} data-from-menu><Package size={16} /> Controlar produtos do cardápio</button>}
        {!!low.length && <Badge tone="warn">{low.length} abaixo do mínimo</Badge>}
        {pol.data && s.can('configuracoes.gerenciar') && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Toggle checked={pol.data.enabled} onChange={(v) => savePolicy({ enabled: v })} label="Baixa automática nas vendas" />
            <Toggle checked={!pol.data.allow_negative} onChange={(v) => savePolicy({ allow_negative: !v })} label="Bloquear venda sem saldo" />
          </div>
        )}
      </div>
      {!list.length ? <Empty icon={Package} title="Nenhum insumo">Cadastre os insumos (carne, pão, garrafas…) e depois monte as fichas técnicas dos produtos. Para bebidas e itens vendidos prontos, use <b>Controlar produtos do cardápio</b>.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Insumo</th><th className="text-right">Saldo</th><th className="text-right">Mínimo</th><th>Situação</th>{list[0].avg_cost_cents != null && <th className="text-right">Custo médio</th>}<th className="text-right">Sugestão de compra</th><th /></tr></thead>
            <tbody>{list.map((i) => (
              <tr key={i.id}>
                <td className="font-semibold"><button className="underline-offset-2 hover:underline" onClick={() => setHist(i)}>{i.name}</button></td>
                <td className="text-right font-mono">{qfmt(i.balance, i.unit)}</td><td className="text-right text-muted">{qfmt(i.min_qty, i.unit)}</td>
                <td>{i.status === 'ok' ? <Badge tone="ok">ok</Badge> : i.status === 'baixo' ? <Badge tone="warn">baixo</Badge> : <Badge tone="bad">zerado</Badge>}</td>
                {i.avg_cost_cents != null && <td className="text-right">{money(Math.round(i.avg_cost_cents))}/{i.unit}</td>}
                <td className="text-right">{i.suggest ? qfmt(i.suggest, i.unit) : '—'}</td>
                <td className="whitespace-nowrap text-right">{s.can('estoque.ajustar') && <>
                  <button className="text-xs underline" onClick={() => setMov({ item: i, kind: 'entrada' })}>entrada</button>{' · '}
                  <button className="text-xs underline" onClick={() => setMov({ item: i, kind: 'perda' })}>perda</button>{' · '}
                  <button className="text-xs underline" onClick={() => setFix(i)} data-fix={i.id}>corrigir</button>{' · '}
                  <button className="text-xs underline" onClick={() => setEdit(i)}>editar</button></>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Sugestão de compra = ponto de reposição (ou 2× o mínimo) + consumo médio de 7 dias − saldo atual.</p>
      <ItemModal data={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); items.reload(); }} />
      <MovementModal data={mov} onClose={() => setMov(null)} onSaved={() => { setMov(null); items.reload(); toast('Movimento registrado'); }} />
      <HistoryModal item={hist} onClose={() => setHist(null)} />
      <CorrectionModal open={!!fix} item={fix} stock={list} onClose={() => setFix(null)} onDone={() => { setFix(null); items.reload(); }} />
      <FromMenuModal open={fromMenu} onClose={() => setFromMenu(false)} onDone={() => { setFromMenu(false); items.reload(); }} />
    </div>
  );
}

function ItemModal({ data, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [err, setErr] = useState(null);
  useEffect(() => { if (data) { setErr(null); setF({ name: data.name || '', unit: data.unit || 'un', min_qty: data.min_qty ?? '', reorder_qty: data.reorder_qty ?? '', initial_qty: '', cost: '' }); } }, [data]);
  if (!data) return null;
  const save = async () => {
    try {
      const body = { name: f.name, unit: f.unit, min_qty: num(f.min_qty || 0), reorder_qty: num(f.reorder_qty || 0) };
      if (!data.id && f.initial_qty) { body.initial_qty = num(f.initial_qty); body.unit_cost_cents = parseCents(f.cost || '0') ?? 0; }
      await api(data.id ? `/api/stock/items/${data.id}` : '/api/stock/items', { method: data.id ? 'PUT' : 'POST', body });
      onSaved();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={data.id ? 'Editar insumo' : 'Novo insumo'} footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome" className="col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Unidade"><select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label="Estoque mínimo"><input className="input" inputMode="decimal" value={f.min_qty} onChange={(e) => setF({ ...f, min_qty: e.target.value })} /></Field>
        <Field label="Ponto de reposição"><input className="input" inputMode="decimal" value={f.reorder_qty} onChange={(e) => setF({ ...f, reorder_qty: e.target.value })} /></Field>
        {!data.id && <>
          <Field label="Saldo inicial"><input className="input" inputMode="decimal" value={f.initial_qty} onChange={(e) => setF({ ...f, initial_qty: e.target.value })} /></Field>
          <Field label={`Custo por ${f.unit} (R$)`}><input className="input" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        </>}
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function MovementModal({ data, onClose, onSaved }) {
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => { if (data) { setQty(''); setCost(data.item.avg_cost_cents != null ? centsToInput(Math.round(data.item.avg_cost_cents)) : ''); setReason(''); setErr(null); } }, [data]);
  if (!data) return null;
  const save = async () => {
    try {
      const body = { stock_item_id: data.item.id, kind: data.kind, qty: num(qty), reason };
      if (data.kind === 'entrada' && cost) body.unit_cost_cents = parseCents(cost);
      await api('/api/stock/movements', { method: 'POST', body }); onSaved();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={`${data.kind === 'entrada' ? 'Entrada' : 'Perda'} — ${data.item.name}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" aria-disabled={(!num(qty) || reason.trim().length < 3) || undefined} data-why={!num(qty) ? 'Informe a quantidade' : 'Escreva o motivo'} onClick={save}>Registrar</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Quantidade (${data.item.unit})`}><input className="input text-xl" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {data.kind === 'entrada' && <Field label={`Custo por ${data.item.unit} (R$)`}><input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>}
        <Field label="Motivo" className="col-span-2"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={data.kind === 'perda' ? 'Ex.: venceu, caiu no chão' : 'Ex.: compra no mercado'} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function HistoryModal({ item, onClose }) {
  const ask = useAsk();
  const s = useSession();
  const toast = useToast();
  const h = useLoad(() => (item ? api(`/api/stock/items/${item.id}/movements`) : Promise.resolve(null)), [item?.id]);
  if (!item) return null;
  const reverse = async (m) => {
    const reason = await ask.reason({ title: 'Reverter movimento', danger: true, confirmLabel: 'Reverter', reasons: ['Lançado em duplicidade', 'Quantidade errada', 'Item errado'] }); if (!reason) return;
    try { await api(`/api/stock/movements/${m.id}/reverse`, { method: 'POST', body: { reason } }); h.reload(); } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <Modal open wide onClose={onClose} title={`Movimentos — ${item.name}`}>
      {h.loading ? <Loading /> : (
        <table className="table-clean"><tbody>{(h.data || []).map((m) => (
          <tr key={m.id}><td className="whitespace-nowrap">{dateTime(m.created_at, s.tz)}</td><td>{MOV[m.kind]}{m.reverses_id ? ` (de #${m.reverses_id})` : ''}</td>
            <td className="text-xs text-muted">{m.reason || (m.ref_type === 'order_item' ? `item vendido #${m.ref_id}` : '')}{m.user_name ? ` · ${m.user_name}` : ''}</td>
            <td className={`text-right font-mono ${m.qty < 0 ? 'text-rust' : 'text-ok'}`}>{m.qty > 0 ? '+' : ''}{qfmt(m.qty, item.unit)}</td>
            <td>{['entrada', 'perda', 'ajuste'].includes(m.kind) && s.can('estoque.ajustar') && <button className="text-xs underline" onClick={() => reverse(m)}>reverter</button>}</td></tr>
        ))}</tbody></table>)}
    </Modal>
  );
}

function Recipes({ stock }) {
  const s = useSession();
  const r = useLoad(() => api('/api/stock/recipes'), []);
  const [edit, setEdit] = useState(null);
  const [produce, setProduce] = useState(null);
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <ErrorBox error={r.error} onRetry={r.reload} />;
  return (
    <div>
      <p className="mb-3 text-sm text-muted">Escolha a estratégia de cada produto: <b>ficha técnica</b> (a venda baixa os insumos) ou <b>produto acabado</b> (a venda baixa o próprio item, produzido ou comprado pronto). Nunca as duas. Cada alteração da ficha cria uma nova versão.</p>
      <div className="card overflow-x-auto">
        <table className="table-clean">
          <thead><tr><th>Produto</th><th>Estratégia</th><th>Composição</th><th className="text-right">Preço</th><th className="text-right">Custo teórico</th><th className="text-right">Margem</th><th /></tr></thead>
          <tbody>{r.data.map((p) => (
            <tr key={p.id}>
              <td className="font-semibold">{p.name}</td>
              <td>{p.stock_mode === 'ficha' ? <Badge tone="info">ficha v{p.version}</Badge> : p.stock_mode === 'acabado' ? <Badge tone="ok">acabado</Badge> : <span className="text-xs text-muted">sem controle</span>}</td>
              <td className="text-xs text-muted">{p.stock_mode === 'acabado' ? p.stock_item_name : p.lines.map((l) => `${qfmt(l.qty, l.unit)} ${l.name}`).join(' + ')}</td>
              <td className="text-right">{money(p.price_cents)}</td>
              <td className="text-right">{p.theoretical_cost_cents != null ? money(p.theoretical_cost_cents) : '—'}</td>
              <td className={`text-right ${p.margin_pct != null && p.margin_pct < 50 ? 'text-warn' : ''}`}>{p.margin_pct != null ? `${p.margin_pct.toLocaleString('pt-BR')}%` : '—'}</td>
              <td className="whitespace-nowrap text-right">{s.can('estoque.ajustar') && <button className="text-xs underline" onClick={() => setEdit(p)}>definir</button>}
                {p.stock_mode === 'acabado' && p.recipe_id && s.can('estoque.ajustar') && <> · <button className="text-xs underline" onClick={() => setProduce(p)}>produzir</button></>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <RecipeModal product={edit} stock={stock} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); r.reload(); }} />
      <ProduceModal product={produce} onClose={() => setProduce(null)} />
    </div>
  );
}

function RecipeModal({ product, stock, onClose, onSaved }) {
  const [mode, setMode] = useState('nenhum');
  const [item, setItem] = useState('');
  const [yieldQty, setYield] = useState('1');
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!product) return;
    setErr(null); setMode(product.stock_mode); setItem(product.stock_item_id ? String(product.stock_item_id) : ''); setYield(String(product.yield_qty || 1));
    setLines(product.lines.map((l) => ({ stock_item_id: String(l.stock_item_id), qty: String(l.qty).replace('.', ','), loss_pct: String(l.loss_pct || 0) })));
  }, [product]);
  if (!product) return null;
  const save = async () => {
    try {
      await api(`/api/stock/recipes/${product.id}`, { method: 'PUT', body: { stock_mode: mode, stock_item_id: item ? Number(item) : null, yield_qty: num(yieldQty) || 1,
        lines: lines.filter((l) => l.stock_item_id && num(l.qty) > 0).map((l) => ({ stock_item_id: Number(l.stock_item_id), qty: num(l.qty), loss_pct: num(l.loss_pct || 0) })) } });
      onSaved();
    } catch (e) { setErr(e); }
  };
  const unitOf = (id) => stock.find((x) => String(x.id) === String(id))?.unit || '';
  return (
    <Modal open wide onClose={onClose} title={`Estoque de ${product.name}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar nova versão</button></>}>
      <div className="grid grid-cols-3 gap-2">
        {[['nenhum', 'Sem controle'], ['ficha', 'Ficha técnica'], ['acabado', 'Produto acabado']].map(([k, l]) => (
          <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)} className={`rounded-lg border p-3 font-semibold ${mode === k ? 'border-copper bg-copper/15' : 'border-line'}`}>{l}</button>
        ))}
      </div>
      {mode === 'acabado' && (
        <Field label="Item de estoque baixado na venda (1 por unidade vendida)" className="mt-3">
          <select className="input" value={item} onChange={(e) => setItem(e.target.value)}><option value="">Escolha…</option>{stock.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select>
        </Field>
      )}
      {mode !== 'nenhum' && (
        <div className="mt-3">
          <div className="flex items-end gap-3">
            <h3 className="font-display text-xl">{mode === 'ficha' ? 'Insumos da ficha' : 'Ficha de produção (opcional)'}</h3>
            <Field label="Rendimento (porções)" className="ml-auto w-36"><input className="input" inputMode="decimal" value={yieldQty} onChange={(e) => setYield(e.target.value)} /></Field>
          </div>
          <div className="mt-2 space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_90px_auto] items-center gap-2">
                <select className="input" value={l.stock_item_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, stock_item_id: e.target.value } : x)))} aria-label="Insumo">
                  <option value="">Insumo…</option>{stock.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                <div className="relative"><input className="input pr-8" inputMode="decimal" placeholder="Qtd" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} aria-label="Quantidade" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">{unitOf(l.stock_item_id)}</span></div>
                <div className="relative"><input className="input pr-6" inputMode="decimal" value={l.loss_pct} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, loss_pct: e.target.value } : x)))} aria-label="Perda prevista" title="Perda prevista (%)" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">%</span></div>
                <button className="rounded p-2 hover:bg-raised" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remover"><Trash2 size={16} /></button>
              </div>
            ))}
            <button className="btn-ghost" onClick={() => setLines([...lines, { stock_item_id: '', qty: '', loss_pct: '0' }])}><Plus size={16} /> Adicionar insumo</button>
          </div>
        </div>
      )}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function ProduceModal({ product, onClose }) {
  const [qty, setQty] = useState('');
  const [err, setErr] = useState(null);
  const toast = useToast();
  useEffect(() => { setQty(''); setErr(null); }, [product]);
  if (!product) return null;
  const go = async () => {
    try { const r = await api('/api/stock/produce', { method: 'POST', body: { product_id: product.id, qty: num(qty) } }); toast(`Produção registrada (custo ${money(r.cost_cents)})`); onClose(); } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Produzir ${product.name}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" aria-disabled={(!num(qty)) || undefined} data-why={'Informe a quantidade a produzir'} onClick={go}>Registrar produção</button></>}>
      <p className="text-sm text-muted">Consome os insumos da ficha de produção e dá entrada no estoque do produto acabado.</p>
      <Field label="Quantidade produzida" className="mt-3"><input className="input text-xl" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function Purchases({ stock, onChanged }) {
  const ask = useAsk();
  const s = useSession();
  const toast = useToast();
  const p = useLoad(() => api('/api/stock/purchases'), []);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState(null);
  if (p.loading && !p.data) return <Loading />;
  const cancel = async (x) => { const reason = await ask.reason({ title: `Cancelar compra #${x.id}`, danger: true, confirmLabel: 'Cancelar compra', reasons: ['Fornecedor não entregou', 'Pedido em duplicidade', 'Pedido errado'] }); if (!reason) return; try { await api(`/api/stock/purchases/${x.id}/cancel`, { method: 'POST', body: { reason } }); p.reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <div className="space-y-3">
      {s.can('compras.gerenciar') && <GuardedButton missing={!stock.length && 'Cadastre ao menos um insumo em Estoque › Insumos antes de registrar uma compra (ou use Lançar nota, que cria os insumos).'} onClick={() => setCreating(true)} data-new-purchase><ShoppingCart size={16} /> Nova compra</GuardedButton>}
      {!p.data?.length ? <Empty icon={ShoppingCart} title="Nenhuma compra">Registre as compras dos fornecedores; o recebimento dá entrada no estoque e atualiza o custo médio.</Empty> : (
        <div className="card overflow-x-auto"><table className="table-clean">
          <thead><tr><th>#</th><th>Fornecedor</th><th>Documento</th><th>Vencimento</th><th>Situação</th><th className="text-right">Total</th><th /></tr></thead>
          <tbody>{p.data.map((x) => (
            <tr key={x.id}><td>{x.id}</td><td className="font-semibold">{x.supplier}<div className="text-xs font-normal text-muted">{x.lines.map((l) => `${qfmt(l.qty, l.unit)} ${l.name}`).join(', ')}</div></td>
              <td>{x.document || '—'}</td><td>{x.due_date ? x.due_date.split('-').reverse().join('/') : '—'}</td>
              <td><Badge tone={x.status === 'recebida' ? 'ok' : x.status === 'cancelada' ? 'muted' : 'warn'}>{x.status}</Badge></td><td className="text-right">{money(x.total_cents)}</td>
              <td className="whitespace-nowrap text-right">{x.status !== 'cancelada' && <><button className="inline-flex items-center gap-1 text-xs underline" onClick={() => { if (!printPurchase(x, s.me?.company?.name || '')) toast('Permita janelas pop-up para imprimir', 'bad'); }} aria-label={`Imprimir pedido ${x.id}`}><Printer size={12} /> pedido</button>{['aberta', 'parcial'].includes(x.status) && ' · '}</>}
                {['aberta', 'parcial'].includes(x.status) && s.can('compras.gerenciar') && <button className="text-xs underline" onClick={() => setReceiving(x)}>receber</button>}
                {x.status === 'aberta' && s.can('compras.gerenciar') && <> · <button className="text-xs underline" onClick={() => cancel(x)}>cancelar</button></>}</td></tr>
          ))}</tbody></table></div>
      )}
      <PurchaseModal open={creating} stock={stock} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); p.reload(); toast('Compra registrada'); }} />
      <ReceiveModal purchase={receiving} onClose={() => setReceiving(null)} onSaved={() => { setReceiving(null); p.reload(); onChanged(); toast('Recebimento registrado'); }} />
    </div>
  );
}

function PurchaseModal({ open, stock, onClose, onSaved }) {
  const [f, setF] = useState({ supplier: '', document: '', due_date: '' });
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setF({ supplier: '', document: '', due_date: '' }); setLines([{ stock_item_id: '', qty: '', cost: '' }]); setErr(null); } }, [open]);
  if (!open) return null;
  const total = lines.reduce((s, l) => s + Math.round(num(l.qty || 0) * (parseCents(l.cost || '0') || 0)), 0);
  const save = async () => {
    try {
      await api('/api/stock/purchases', { method: 'POST', body: { supplier: f.supplier, document: f.document || undefined, due_date: f.due_date || undefined,
        lines: lines.filter((l) => l.stock_item_id).map((l) => ({ stock_item_id: Number(l.stock_item_id), qty: num(l.qty), unit_cost_cents: parseCents(l.cost) ?? 0 })) } });
      onSaved();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open wide onClose={onClose} title="Nova compra" footer={<><span className="mr-auto font-display text-xl">Total {money(total)}</span><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Fornecedor"><input className="input" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
        <Field label="Nota/documento"><input className="input" value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></Field>
        <Field label="Vencimento (a pagar)"><input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
      </div>
      <div className="mt-3 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_120px_auto] gap-2">
            <select className="input" value={l.stock_item_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, stock_item_id: e.target.value } : x)))} aria-label="Insumo">
              <option value="">Insumo…</option>{stock.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select>
            <input className="input" inputMode="decimal" placeholder="Qtd" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} aria-label="Quantidade" />
            <input className="input" inputMode="decimal" placeholder="R$ unit." value={l.cost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} aria-label="Custo unitário" />
            <button className="rounded p-2 hover:bg-raised" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remover"><Trash2 size={16} /></button>
          </div>
        ))}
        <button className="btn-ghost" onClick={() => setLines([...lines, { stock_item_id: '', qty: '', cost: '' }])}><Plus size={16} /> Linha</button>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function ReceiveModal({ purchase, onClose, onSaved }) {
  const [q, setQ] = useState({});
  const [err, setErr] = useState(null);
  useEffect(() => { if (purchase) { setErr(null); setQ(Object.fromEntries(purchase.lines.map((l) => [l.id, String(Number(l.qty) - Number(l.received_qty)).replace('.', ',')]))); } }, [purchase]);
  if (!purchase) return null;
  const save = async () => {
    try { await api(`/api/stock/purchases/${purchase.id}/receive`, { method: 'POST', body: { lines: Object.entries(q).filter(([, v]) => num(v) > 0).map(([id, v]) => ({ line_id: Number(id), qty: num(v) })) } }); onSaved(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Receber compra #${purchase.id}`} footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Confirmar recebimento</button></>}>
      <p className="text-sm text-muted">Informe o que chegou. Recebimento parcial mantém a compra aberta para o restante.</p>
      <table className="table-clean mt-2"><tbody>{purchase.lines.map((l) => (
        <tr key={l.id}><td>{l.name}</td><td className="text-xs text-muted">{qfmt(l.received_qty, l.unit)} de {qfmt(l.qty, l.unit)}</td>
          <td className="w-28"><input className="input" inputMode="decimal" value={q[l.id] ?? ''} onChange={(e) => setQ({ ...q, [l.id]: e.target.value })} aria-label={`Recebido de ${l.name}`} /></td></tr>
      ))}</tbody></table>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function Inventory({ stock, onChanged, goItems }) {
  const s = useSession();
  const toast = useToast();
  const inv = useLoad(() => api('/api/stock/inventories'), []);
  const [counts, setCounts] = useState(null);
  const start = () => setCounts(Object.fromEntries(stock.map((i) => [i.id, ''])));
  const save = async () => {
    try {
      const r = await api('/api/stock/inventories', { method: 'POST', body: { counts: Object.entries(counts).filter(([, v]) => v !== '').map(([id, v]) => ({ stock_item_id: Number(id), counted: num(v) })) } });
      setCounts(null); inv.reload(); toast(`Contagem salva com ${r.lines.filter((l) => l.diff).length} divergência(s). Aguarda aprovação.`);
    } catch (e) { toast(e.message, 'bad'); }
  };
  const approve = async (x) => { try { const r = await api(`/api/stock/inventories/${x.id}/approve`, { method: 'POST' }); toast(`${r.adjustments} ajuste(s) aplicados`); inv.reload(); onChanged(); } catch (e) { toast(e.message, 'bad'); } };
  const discard = async (x) => { try { await api(`/api/stock/inventories/${x.id}/discard`, { method: 'POST' }); inv.reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <div className="space-y-3">
      {!stock.length && <NoStockHint goItems={goItems} onChanged={onChanged} />}
      {!counts ? s.can('estoque.ajustar') && !!stock.length && <button className="btn-primary" onClick={start}><ClipboardCheck size={16} /> Nova contagem</button> : (
        <div className="card p-4">
          <h3 className="font-display text-xl">Contagem física</h3>
          <p className="text-sm text-muted">Conte o que existe de fato. Deixe em branco o que não foi contado. O saldo do sistema só é mostrado depois, na divergência.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stock.map((i) => <Field key={i.id} label={`${i.name} (${i.unit})`}><input className="input" inputMode="decimal" value={counts[i.id]} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} /></Field>)}
          </div>
          <div className="mt-3 flex gap-2"><button className="btn-ghost" onClick={() => setCounts(null)}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar contagem</button></div>
        </div>
      )}
      {(inv.data || []).map((x) => (
        <div key={x.id} className="card p-4">
          <div className="flex flex-wrap items-center gap-2"><b>Inventário #{x.id}</b><span className="text-sm text-muted">{dateTime(x.created_at, s.tz)} · {x.user_name}</span>
            <Badge tone={x.status === 'aprovado' ? 'ok' : x.status === 'aberto' ? 'warn' : 'muted'}>{x.status}</Badge>
            {x.approved_name && <span className="text-xs text-muted">aprovado por {x.approved_name}</span>}
            {x.status === 'aberto' && s.can('pdv.autorizar') && <div className="ml-auto flex gap-2"><button className="btn-ghost py-1" onClick={() => discard(x)}>Descartar</button><button className="btn-primary py-1" onClick={() => approve(x)}>Aprovar ajustes</button></div>}
          </div>
          <table className="table-clean mt-2"><thead><tr><th>Insumo</th><th className="text-right">Sistema</th><th className="text-right">Contado</th><th className="text-right">Diferença</th>{x.lines[0]?.value_cents != null && s.can('relatorios.cmv') && <th className="text-right">Valor</th>}</tr></thead>
            <tbody>{x.lines.map((l) => <tr key={l.stock_item_id}><td>{l.name}</td><td className="text-right">{qfmt(l.system, l.unit)}</td><td className="text-right">{qfmt(l.counted, l.unit)}</td>
              <td className={`text-right font-semibold ${l.diff < 0 ? 'text-rust' : l.diff > 0 ? 'text-ok' : ''}`}>{l.diff > 0 ? '+' : ''}{qfmt(l.diff, l.unit)}</td>
              {s.can('relatorios.cmv') && <td className="text-right">{money(l.value_cents)}</td>}</tr>)}</tbody></table>
        </div>
      ))}
    </div>
  );
}

// Sem insumos não há o que contar nem corrigir: explica e oferece os dois caminhos
function NoStockHint({ goItems, onChanged }) {
  const s = useSession();
  const [open, setOpen] = useState(false);
  return (
    <div className="card stripe p-5" data-no-stock>
      <h3 className="font-display text-xl">Ainda não há itens no estoque</h3>
      <p className="mt-1 text-sm text-muted">A contagem e a correção trabalham sobre os itens do estoque (insumos e produtos vendidos prontos). Os produtos do cardápio só entram no estoque quando você escolhe controlá-los.</p>
      {s.can('estoque.ajustar') && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setOpen(true)}><Package size={16} /> Controlar produtos do cardápio</button>
          <button className="btn-ghost" onClick={goItems}><Plus size={16} /> Cadastrar insumo</button>
        </div>
      )}
      <FromMenuModal open={open} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChanged(); }} />
    </div>
  );
}

// Produtos vendidos prontos (cerveja, refrigerante, água…) passam a ter estoque próprio e baixam a cada venda
function FromMenuModal({ open, onClose, onDone }) {
  const toast = useToast();
  const r = useLoad(() => (open ? api('/api/stock/recipes') : Promise.resolve(null)), [open]);
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setSel({}); }, [open]);
  if (!open) return null;
  const list = (r.data || []).filter((p) => p.stock_mode === 'nenhum');
  const ids = Object.keys(sel).filter((k) => sel[k]).map(Number);
  const save = async () => {
    setBusy(true);
    try { const x = await api('/api/stock/items/from-products', { method: 'POST', body: { product_ids: ids } }); toast(`${x.linked} produto(s) no estoque. Agora registre o saldo pela contagem ou pela correção.`); onDone(); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open wide onClose={onClose} title="Controlar produtos do cardápio no estoque"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy} aria-disabled={(!ids.length) || undefined} data-why={'Marque ao menos um produto'} onClick={save}>Controlar {ids.length || ''} produto(s)</button></>}>
      <p className="mb-3 text-sm text-muted">Use para itens vendidos do jeito que chegam (bebidas em lata/garrafa, água, sobremesas prontas). Cada um vira um item de estoque em unidades, com baixa automática na venda. Pratos montados na cozinha ficam melhor com ficha técnica.</p>
      {r.loading ? <Loading /> : !list.length ? <p className="text-sm text-muted">Todos os produtos já têm controle de estoque.</p> : (
        <>
          <div className="mb-2 flex gap-2 text-xs"><button className="underline" onClick={() => setSel(Object.fromEntries(list.map((p) => [p.id, true])))}>marcar todos</button><button className="underline" onClick={() => setSel({})}>limpar</button></div>
          <div className="grid max-h-[50vh] gap-1 overflow-auto sm:grid-cols-2">
            {list.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line p-2 hover:bg-raised">
                <input type="checkbox" checked={!!sel[p.id]} onChange={(e) => setSel({ ...sel, [p.id]: e.target.checked })} />
                <span className="flex-1">{p.name}</span><span className="text-xs text-muted">{money(p.price_cents)}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

const REASON_HELP = { contagem: 'A contagem física não bate com o sistema', quebra: 'Garrafa quebrou, produto avariado', vencimento: 'Venceu e foi descartado',
  erro_lancamento: 'Entrada ou venda lançada errada', consumo_interno: 'Consumo da equipe ou cortesia sem lançamento', furto_desvio: 'Suspeita de furto ou desvio (sempre vai para aprovação)',
  devolucao: 'Devolvido ao fornecedor sem nota de devolução', outro: 'Explique na justificativa' };

const blankCorrection = (item) => ({ id: item?.id ? String(item.id) : '', counted: '', reason: 'contagem', just: '', evidence: '' });
function CorrectionModal({ open, item, stock, onClose, onDone }) {
  const s = useSession();
  const toast = useToast();
  const [f, setF] = useState(() => blankCorrection(item));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { if (open) { setF(blankCorrection(item)); setErr(null); setResult(null); } }, [open, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const it = stock.find((x) => String(x.id) === f.id);
  const counted = f.counted === '' ? null : num(f.counted);
  const diff = it && counted != null && !Number.isNaN(counted) ? Math.round((counted - it.balance) * 1000) / 1000 : null;
  const value = diff != null && it?.avg_cost_cents != null ? Math.round(diff * it.avg_cost_cents) : null;
  const send = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/stock/corrections', { method: 'POST', body: { stock_item_id: Number(f.id), counted_qty: counted, reason_code: f.reason, justification: f.just.trim(),
        evidence: f.evidence.trim() || undefined, expected_system_qty: it.balance } });
      setResult(r);
      toast(r.status === 'aplicada' ? 'Correção aplicada' : 'Correção enviada para aprovação');
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  if (result) {
    return (
      <Modal open onClose={onDone} title={`Correção #${result.id}`} footer={<button className="btn-primary" onClick={onDone}>Concluir</button>}>
        {result.status === 'aplicada' ? <p className="flex items-center gap-2 text-ok"><CheckCircle2 size={18} /> Aplicada: o saldo de {it?.name} agora é {qfmt(counted, it?.unit)}.</p> : (
          <div className="space-y-2">
            <p className="font-semibold text-warn">Aguardando aprovação de outra pessoa (gerente ou proprietário).</p>
            <ul className="list-disc pl-5 text-sm">{result.rules.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="text-sm text-muted">O saldo só muda quando a correção for aprovada em Estoque › Correções. Pedidos não decididos vencem e precisam ser refeitos.</p>
          </div>
        )}
      </Modal>
    );
  }
  const ok = it && counted != null && counted >= 0 && diff !== 0 && f.just.trim().length >= 15;
  return (
    <Modal open wide onClose={onClose} title="Corrigir estoque"
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" disabled={busy} aria-disabled={(!ok) || undefined} data-why={'Preencha item, quantidade e motivo'} onClick={send} data-corr-send>{busy ? 'Enviando…' : 'Registrar correção'}</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item do estoque" className="sm:col-span-2">
          <select className="input" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} disabled={!!item?.id} data-corr-item>
            <option value="">Escolha…</option>{stock.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        {it && <div className="rounded-lg bg-raised p-3 text-sm"><div className="text-xs uppercase text-muted">Saldo no sistema agora</div><div className="font-mono text-xl">{qfmt(it.balance, it.unit)}</div></div>}
        <Field label={`Saldo real contado${it ? ` (${it.unit})` : ''}`} hint="Informe quanto existe de fato, não a diferença">
          <input className="input text-xl" inputMode="decimal" value={f.counted} onChange={(e) => setF({ ...f, counted: e.target.value })} data-corr-counted />
        </Field>
        {diff != null && (
          <div className={`rounded-lg p-3 text-sm sm:col-span-2 ${diff < 0 ? 'bg-rust/10 text-rust' : diff > 0 ? 'bg-ok/10 text-ok' : 'bg-raised'}`}>
            Diferença: <b>{diff > 0 ? '+' : ''}{qfmt(diff, it.unit)}</b>{value != null && <> · impacto <b>{money(value)}</b></>}{diff === 0 && ' — igual ao sistema, nada a corrigir'}
          </div>
        )}
        <Field label="Motivo" className="sm:col-span-2" hint={REASON_HELP[f.reason]}>
          <select className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} data-corr-reason>
            {Object.entries({ contagem: 'Divergência de contagem', quebra: 'Quebra / avaria', vencimento: 'Vencimento / validade', erro_lancamento: 'Erro de lançamento', consumo_interno: 'Consumo interno / cortesia', furto_desvio: 'Furto ou desvio', devolucao: 'Devolução ao fornecedor', outro: 'Outro' }).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label={`Justificativa (${f.just.trim().length}/15 caracteres no mínimo)`} className="sm:col-span-2">
          <textarea className="input min-h-[80px]" value={f.just} maxLength={500} onChange={(e) => setF({ ...f, just: e.target.value })} placeholder="O que aconteceu, quando e quem conferiu" data-corr-just />
        </Field>
        <Field label="Evidência (opcional)" className="sm:col-span-2" hint="Nº da nota, foto enviada ao grupo, boletim de ocorrência…">
          <input className="input" value={f.evidence} maxLength={300} onChange={(e) => setF({ ...f, evidence: e.target.value })} />
        </Field>
      </div>
      {!s.can('pdv.autorizar') && <p className="mt-2 text-xs text-muted">Seu perfil não aprova correções: o pedido vai para um gerente ou proprietário.</p>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

const CSTATUS = { pendente: ['warn', 'pendente'], aplicada: ['ok', 'aplicada'], rejeitada: ['bad', 'rejeitada'], expirada: ['muted', 'vencida'] };

function Corrections({ stock, onChanged, goItems }) {
  const ask = useAsk();
  const s = useSession();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const c = useLoad(() => api(`/api/stock/corrections${status ? `?status=${status}` : ''}`), [status]);
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  useEffect(() => { if (c.data?.config) setCfg({ limit: centsToInput(c.data.config.correction_limit_cents), pct: String(c.data.config.correction_max_pct), days: String(c.data.config.correction_expire_days) }); }, [c.data?.config]);
  const pending = (c.data?.items || []).filter((x) => x.status === 'pendente');
  const decide = async (x, ok) => {
    let note = '';
    if (!ok) { note = await ask.reason({ title: 'Rejeitar correção', danger: true, confirmLabel: 'Rejeitar', reasons: ['Contagem não confere', 'Falta justificativa', 'Recontar antes'] }) || ''; if (!note) return; }
    else if (Number(x.requested_by) === Number(s.me?.user?.id ?? s.me?.id)) { note = await ask.reason({ title: 'Aprovar o próprio pedido', message: 'Você está aprovando o próprio pedido (não há outro aprovador). Registre uma observação.', label: 'Observação', reasons: ['Conferido pessoalmente'] }) || ''; if (!note) return; }
    try { await api(`/api/stock/corrections/${x.id}/${ok ? 'approve' : 'reject'}`, { method: 'POST', body: note ? { note } : {} }); toast(ok ? 'Correção aprovada e aplicada' : 'Correção rejeitada'); c.reload(); onChanged(); }
    catch (e) { toast(e.message, 'bad'); c.reload(); }
  };
  const saveCfg = async () => {
    try { await api('/api/stock/settings', { method: 'PUT', body: { correction_limit_cents: parseCents(cfg.limit) ?? 0, correction_max_pct: num(cfg.pct), correction_expire_days: Math.round(num(cfg.days)) } }); toast('Regras de correção salvas'); c.reload(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const conf = c.data?.config;
  return (
    <div className="space-y-4">
      {!stock.length && <NoStockHint goItems={goItems} onChanged={onChanged} />}
      <div className="flex flex-wrap items-center gap-2">
        {s.can('estoque.ajustar') && !!stock.length && <button className="btn-primary" onClick={() => setOpen(true)} data-corr-new><Wrench size={16} /> Corrigir estoque</button>}
        {!!pending.length && <Badge tone="warn">{pending.length} aguardando aprovação</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className="input py-1.5" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
            <option value="">Todas</option><option value="pendente">Pendentes</option><option value="aplicada">Aplicadas</option><option value="rejeitada">Rejeitadas</option><option value="expirada">Vencidas</option>
          </select>
          <button className="btn-ghost" onClick={() => download(`/api/stock/corrections?format=csv${status ? `&status=${status}` : ''}`, 'correcoes-estoque.csv').catch((e) => toast(e.message, 'bad'))}><Download size={16} /> CSV</button>
        </div>
      </div>
      <details className="card p-4" open={!c.data?.items?.length}>
        <summary className="flex cursor-pointer items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-copper" /> Padrões de auditoria da correção</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Informa-se o <b>saldo real contado</b>; o sistema calcula a diferença e o valor pelo custo médio.</li>
          <li>Motivo de uma lista fechada e <b>justificativa obrigatória</b> (mín. 15 caracteres); evidência opcional.</li>
          <li>Aplicação direta só por gerente/proprietário e dentro dos limites{conf ? <> (até <b>{money(conf.correction_limit_cents)}</b> e <b>{conf.correction_max_pct}%</b> do saldo)</> : ''}.</li>
          <li>Acima dos limites, motivo <b>furto/desvio</b>, 3ª correção do mesmo item em 30 dias ou pedido de quem não aprova → <b>aprovação por outra pessoa</b>.</li>
          <li>Sem outro aprovador na empresa, o proprietário aprova o próprio pedido com observação, e o registro fica marcado como <b>autoaprovado</b>.</li>
          <li>Pedidos pendentes <b>vencem</b> em {conf?.correction_expire_days || 7} dias: a contagem precisa ser refeita.</li>
          <li>Nada é editado nem apagado: a correção vira um movimento "Correção" vinculado ao pedido, e tudo vai para a Auditoria (antes/depois, valor, quem pediu, quem decidiu).</li>
        </ul>
        {cfg && s.can('configuracoes.gerenciar') && (
          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <Field label="Limite de valor (R$)"><input className="input w-32" inputMode="decimal" value={cfg.limit} onChange={(e) => setCfg({ ...cfg, limit: e.target.value })} /></Field>
            <Field label="Limite de diferença (%)"><input className="input w-32" inputMode="decimal" value={cfg.pct} onChange={(e) => setCfg({ ...cfg, pct: e.target.value })} /></Field>
            <Field label="Vencimento (dias)"><input className="input w-28" inputMode="numeric" value={cfg.days} onChange={(e) => setCfg({ ...cfg, days: e.target.value })} /></Field>
            <button className="btn-ghost" onClick={saveCfg}>Salvar regras</button>
          </div>
        )}
      </details>
      <ErrorBox error={c.error} onRetry={c.reload} />
      {c.loading && !c.data ? <Loading /> : !(c.data?.items || []).length ? <Empty icon={Wrench} title="Nenhuma correção">As correções de saldo aparecem aqui, com quem pediu, quem aprovou e o motivo.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>#</th><th>Data</th><th>Item</th><th className="text-right">Sistema → Real</th><th className="text-right">Diferença</th><th className="text-right">Valor</th><th>Motivo</th><th>Situação</th><th>Pedido / decisão</th><th /></tr></thead>
            <tbody>{c.data.items.map((x) => (
              <tr key={x.id} data-corr-row={x.status}>
                <td className="text-muted">{x.id}</td>
                <td className="whitespace-nowrap">{dateTime(x.created_at, s.tz)}</td>
                <td className="font-semibold">{x.item_name}{x.recurrent && <span className="ml-1"><Badge tone="warn">recorrente</Badge></span>}</td>
                <td className="whitespace-nowrap text-right font-mono">{qfmt(x.system_qty, x.unit)} → {qfmt(x.counted_qty, x.unit)}</td>
                <td className={`text-right font-mono font-semibold ${x.diff_qty < 0 ? 'text-rust' : 'text-ok'}`}>{x.diff_qty > 0 ? '+' : ''}{qfmt(x.diff_qty, x.unit)}</td>
                <td className="text-right">{x.value_cents != null ? money(x.value_cents) : '—'}</td>
                <td className="max-w-[260px]"><div>{x.reason_label}</div><div className="text-xs text-muted">{x.justification}{x.evidence ? ` · evidência: ${x.evidence}` : ''}</div></td>
                <td><Badge tone={CSTATUS[x.status][0]}>{CSTATUS[x.status][1]}</Badge>{x.self_approved && <div className="mt-1"><Badge tone="warn">autoaprovada</Badge></div>}</td>
                <td className="text-xs"><div>pedido: {x.requested_name}</div>{x.decided_name && <div>decisão: {x.decided_name}</div>}{x.decision_note && <div className="text-muted">{x.decision_note}</div>}
                  {x.status === 'pendente' && x.approval_rule && <div className="text-warn">{x.approval_rule}</div>}</td>
                <td className="whitespace-nowrap">{x.status === 'pendente' && s.can('pdv.autorizar') && <div className="flex gap-1">
                  <button className="btn-ghost py-1 text-xs" onClick={() => decide(x, false)}>Rejeitar</button>
                  <button className="btn-primary py-1 text-xs" onClick={() => decide(x, true)} data-corr-approve={x.id}>Aprovar</button></div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <CorrectionModal open={open} stock={stock} onClose={() => setOpen(false)} onDone={() => { setOpen(false); c.reload(); onChanged(); }} />
    </div>
  );
}

// ---- Código de barras: leitor (funciona como teclado) ou câmera ----
function BarcodeEntry({ busy, onResult, onError }) {
  const [code, setCode] = useState('');
  const [reading, setReading] = useState(false);
  const [cam, setCam] = useState(false);
  const input = useRef(null);
  const video = useRef(null);
  const scanner = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => () => scanner.current?.stop(), []);
  const send = async (raw) => {
    const v = String(raw || '').trim(); if (!v) return;
    setReading(true); onError(null);
    try { onResult(await api('/api/stock/barcode', { method: 'POST', body: { code: v } })); setCode(''); }
    catch (e) { onError(e); } finally { setReading(false); input.current?.focus(); }
  };
  const openCam = async () => {
    setCam(true);
    await new Promise((r) => setTimeout(r, 50));
    scanner.current = await startScanner(video.current, (txt) => { setCam(false); send(txt); }, (e) => { setCam(false); onError(e); });
  };
  const closeCam = () => { scanner.current?.stop(); setCam(false); };
  return (
    <div className="card p-4" data-barcode>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2"><Barcode size={28} className="text-copper" />
          <div><div className="font-display text-2xl leading-none">Ler código de barras</div>
            <div className="text-xs text-muted">O código de barras da nota fiscal em papel (DANFE) ou do pedido de compra impresso pelo RUSTEN. Use o leitor, a câmera ou digite os números.</div></div></div>
        <form className="flex min-w-[260px] flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); send(code); }}>
          <input ref={input} className="input font-mono" inputMode="numeric" autoComplete="off" placeholder="Aponte o leitor aqui…" value={code}
            onChange={(e) => setCode(e.target.value)} aria-label="Código de barras" disabled={busy || reading} data-barcode-input />
          <button className="btn-primary" disabled={busy || reading} aria-disabled={(!code.trim()) || undefined} data-why={'Leia o código com o leitor ou a câmera, ou digite os números'}>{reading ? <Loader2 className="animate-spin" size={16} /> : <ScanLine size={16} />} Lançar</button>
        </form>
        <button type="button" className="btn-ghost" onClick={openCam} disabled={busy || reading}><Camera size={16} /> Câmera</button>
      </div>
      {cam && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4">
          <video ref={video} className="max-h-[70vh] w-full max-w-xl rounded-lg" playsInline muted />
          <p className="text-sm text-white">Aproxime o código de barras da nota fiscal (DANFE) ou do pedido. Deite o celular para códigos longos.</p>
          <button className="btn-ghost text-white" onClick={closeCam}><X size={16} /> Fechar</button>
        </div>
      )}
    </div>
  );
}

// Pedido de compra lido pelo código: confere o que chegou (quantidade e preço) e lança no estoque
function ReceiveByCode({ purchase, onClose, onDone }) {
  const [rows, setRows] = useState(() => purchase.lines.map((l) => ({ ...l, left: Math.max(0, Number(l.qty) - Number(l.received_qty)),
    qty: String(Math.max(0, Number(l.qty) - Number(l.received_qty))).replace('.', ','), cost: centsToInput(Math.round(Number(l.unit_cost_cents))) })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const total = rows.reduce((a, r) => a + Math.round(num(r.qty || 0) * (parseCents(r.cost || '0') || 0)), 0);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const lines = rows.filter((r) => num(r.qty) > 0).map((r) => ({ line_id: r.id, qty: num(r.qty), unit_cost_cents: parseCents(r.cost || '0') ?? Number(r.unit_cost_cents) }));
      if (!lines.length) throw new Error('Nada a receber');
      const out = await api(`/api/stock/purchases/${purchase.id}/receive`, { method: 'POST', body: { lines } });
      onDone(out.status);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="card p-4" data-po={purchase.id}>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-display text-2xl">Pedido de compra #{purchase.id}</span>
        <span className="text-muted">{purchase.supplier}{purchase.document ? ` · ${purchase.document}` : ''}</span>
        <Badge tone="warn">{purchase.status}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">Já vem preenchido com o que falta receber. Ajuste se chegou diferente ou se o preço mudou: o custo médio do insumo é recalculado.</p>
      <table className="table-clean mt-2">
        <thead><tr><th>Insumo</th><th>Falta</th><th className="w-28">Chegou</th><th className="w-32">R$ unit.</th><th className="text-right">Total</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id}>
            <td className="font-semibold">{r.name}<div className="text-xs font-normal text-muted">custo médio atual {money(Math.round(Number(r.avg_cost_cents)))} / {r.unit}</div></td>
            <td className="text-sm text-muted">{qfmt(r.left, r.unit)}</td>
            <td><input className="input px-2" inputMode="decimal" value={r.qty} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} aria-label={`Chegou de ${r.name}`} /></td>
            <td><input className="input px-2" inputMode="decimal" value={r.cost} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} aria-label={`Preço de ${r.name}`} /></td>
            <td className="text-right">{money(Math.round(num(r.qty || 0) * (parseCents(r.cost || '0') || 0)))}</td>
          </tr>
        ))}</tbody>
      </table>
      <ErrorBox error={err} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="font-display text-2xl">Total {money(total)}</span>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={busy} onClick={save} data-po-confirm>{busy ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Receber e lançar no estoque</button>
        </div>
      </div>
    </div>
  );
}

/** Pedido de compra para o fornecedor, com o código de barras que dá entrada no estoque quando a mercadoria chega. */
function printPurchase(x, companyName) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return false;
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = x.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="n">${esc(qfmt(l.qty, l.unit))}</td><td class="n">${esc(money(Math.round(Number(l.unit_cost_cents))))}</td><td class="n">${esc(money(Math.round(Number(l.qty) * Number(l.unit_cost_cents))))}</td></tr>`).join('');
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido de compra ${x.id}</title><style>
    body{font:14px system-ui,sans-serif;margin:32px;color:#111} h1{font-size:22px;margin:0} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border-bottom:1px solid #ccc;padding:6px;text-align:left} .n{text-align:right} .bc{margin-top:24px;text-align:center} .bc div{font:16px monospace;letter-spacing:2px}
    .muted{color:#555}</style></head><body>
    <h1>Pedido de compra nº ${x.id}</h1><div class="muted">${esc(companyName)} · ${esc(new Date(x.created_at).toLocaleDateString('pt-BR'))}</div>
    <p><b>Fornecedor:</b> ${esc(x.supplier)}${x.document ? ` · ${esc(x.document)}` : ''}${x.due_date ? ` · vencimento ${esc(x.due_date.split('-').reverse().join('/'))}` : ''}</p>
    <table><thead><tr><th>Item</th><th class="n">Qtd</th><th class="n">R$ unit.</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><th colspan="3" class="n">Total</th><th class="n">${esc(money(x.total_cents))}</th></tr></tfoot></table>
    <div class="bc">${code128Svg(x.code)}<div>${esc(x.code)}</div><p class="muted">Na entrega, leia este código no RUSTEN (Estoque › Lançar nota) para dar entrada.</p></div>
    <p class="muted" style="text-align:center">Se a impressão não abrir sozinha, use Ctrl+P.</p></body></html>`);
  w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch { /* usuário imprime pelo botão */ } }, 300);
  return true;
}

// ---- Lançar nota: foto (lida por IA) ou XML da NF-e → conferência → entrada no estoque ----
async function shrink(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 6_000_000) throw new Error('PDF muito grande (máx. 6 MB)');
    return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(file); });
  }
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

function parseNfe(xml) {
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  if (d.querySelector('parsererror')) throw new Error('Arquivo XML inválido');
  const g = (el, tag) => el?.getElementsByTagName(tag)?.[0]?.textContent?.trim() || null;
  const inf = d.getElementsByTagName('infNFe')[0];
  if (!inf) throw new Error('Este XML não é de uma NF-e');
  const key = (inf.getAttribute('Id') || '').replace(/^NFe/, '');
  const emit = d.getElementsByTagName('emit')[0];
  const items = [...d.getElementsByTagName('det')].map((det) => {
    const p = det.getElementsByTagName('prod')[0];
    return { description: g(p, 'xProd'), qty: Number(g(p, 'qCom')), unit: g(p, 'uCom'), unit_price: Number(g(p, 'vUnCom')), total: Number(g(p, 'vProd')) };
  }).filter((i) => i.description);
  return { supplier_doc: g(emit, 'CNPJ') || g(emit, 'CPF'), supplier: g(emit, 'xFant') || g(emit, 'xNome'), document: g(d, 'nNF') ? `NF-e ${g(d, 'nNF')}` : null, nfe_key: /^\d{44}$/.test(key) ? key : null,
    due_date: g(d.getElementsByTagName('dup')[0], 'dVenc'), total: Number(g(d.getElementsByTagName('ICMSTot')[0], 'vNF')) || null, items, warnings: [] };
}

function NoteImport({ stock, onDone }) {
  const s = useSession();
  const toast = useToast();
  const status = useLoad(() => api('/api/stock/notes/status'), []);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [doc, setDoc] = useState(null);
  const [preview, setPreview] = useState(null);
  const toLines = (items) => items.map((i) => ({ description: i.description, alias: i.alias, match: i.match, note_unit: i.unit || '', qty: String(i.qty ?? '').replace('.', ','),
    factor: String(i.factor || 1).replace('.', ','), cost: i.unit_price != null ? centsToInput(Math.round(i.unit_price * 100)) : '',
    target: i.stock_item_id ? String(i.stock_item_id) : 'novo', new_name: i.description.replace(/\s+/g, ' ').slice(0, 60), new_unit: i.suggested_unit || 'un' }));
  const photo = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    setErr(null); setDoc(null); setBusy('Lendo a nota…');
    try {
      const data = await shrink(f); setPreview(f.type === 'application/pdf' ? null : data);
      const r = await api('/api/stock/notes/read', { method: 'POST', body: { image: data } });
      setDoc({ ...r, source: 'foto', lines: toLines(r.items) });
    } catch (x) { setErr(x); } finally { setBusy(null); }
  };
  const xml = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    setErr(null); setDoc(null); setPreview(null); setBusy('Lendo o XML…');
    try {
      await loadXml(await f.text());
    } catch (x) { setErr(x); } finally { setBusy(null); }
  };
  // XML (arquivo ou buscado pela chave) → itens reconhecidos pelos apelidos aprendidos → conferência
  const loadXml = async (text, expectKey = waitKey?.key) => {
    const n = parseNfe(text);
    if (expectKey && n.nfe_key && n.nfe_key !== expectKey) throw new Error('Este XML é de outra nota: a chave não confere com o código lido.');
    const r = await api('/api/stock/notes/match', { method: 'POST', body: { items: n.items } });
    const warnings = [...(n.warnings || [])];
    if (waitKey?.supplier && !n.supplier) n.supplier = waitKey.supplier;
    setWaitKey(null);
    setDoc({ ...n, source: 'xml', warnings, lines: toLines(r.items) });
  };
  const [waitKey, setWaitKey] = useState(null);
  const [po, setPo] = useState(null);
  const onBarcode = async (r) => {
    setErr(null); setPo(null); setWaitKey(null);
    if (r.kind === 'pedido') {
      if (['recebida', 'cancelada'].includes(r.purchase.status)) { setErr(new Error(`Pedido de compra #${r.purchase.id} já está ${r.purchase.status}.`)); return; }
      setPo(r.purchase); return;
    }
    if (r.duplicate) { setErr(new Error(`Esta NF-e já foi lançada (compra #${r.duplicate}).`)); return; }
    if (r.xml_by_key) {
      setBusy('Buscando o XML da nota pela chave…');
      try {
        const x = await api('/api/stock/notes/xml-by-key', { method: 'POST', body: { key: r.key } });
        if (x.xml) { await loadXml(x.xml, r.key); return; }
        setWaitKey({ ...r, message: x.message });
      } catch (x) { setWaitKey({ ...r, message: x.message }); } finally { setBusy(null); }
      return;
    }
    setWaitKey({ ...r, message: 'Para trazer os itens, importe o XML desta nota (o arquivo que o fornecedor envia por e-mail). A chave é conferida.' });
  };
  const blankLine = () => ({ description: '', alias: '', match: 'novo', note_unit: '', qty: '1', factor: '1', cost: '', target: stock[0] ? String(stock[0].id) : 'novo', new_name: '', new_unit: 'un', manual: true });
  const manual = () => { setErr(null); setPreview(null); setDoc({ supplier: '', document: '', due_date: '', source: 'manual', warnings: [], total: null, lines: [blankLine()] }); };
  const setLine = (i, patch) => setDoc({ ...doc, lines: doc.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const total = doc ? doc.lines.reduce((a, l) => a + Math.round(num(l.qty || 0) * (parseCents(l.cost || '0') || 0)), 0) : 0;
  const confirm = async () => {
    setErr(null); setBusy('Lançando no estoque…');
    try {
      const r = await api('/api/stock/notes/confirm', { method: 'POST', body: { supplier: doc.supplier || '', document: doc.document || null, due_date: doc.due_date || null,
        source: doc.source, nfe_key: doc.nfe_key || null, supplier_doc: /^\d{11}$|^\d{14}$/.test(doc.supplier_doc || '') ? doc.supplier_doc : null, receive: true,
        lines: doc.lines.map((l) => ({ description: l.description || (l.target !== 'novo' ? stock.find((x) => String(x.id) === l.target)?.name : l.new_name) || 'item', alias: l.alias, qty: num(l.qty), factor: num(l.factor) || 1, unit_cost_cents: parseCents(l.cost || '0') ?? 0,
          stock_item_id: l.target !== 'novo' ? Number(l.target) : null, new_item: l.target === 'novo' ? { name: l.new_name, unit: l.new_unit } : null })) } });
      toast(`Compra #${r.purchase_id} lançada: ${r.lines} item(ns) entraram no estoque`); setDoc(null); setPreview(null); onDone();
    } catch (x) { setErr(x); } finally { setBusy(null); }
  };
  if (!s.can('compras.gerenciar')) return <Empty icon={Camera} title="Sem permissão">Peça ao gerente o perfil com "Registrar compras e recebimentos".</Empty>;
  return (
    <div className="space-y-4">
      {!doc && !po && <BarcodeEntry busy={!!busy} onResult={onBarcode} onError={setErr} />}
      {waitKey && !doc && (
        <div className="card border-copper/50 p-4 text-sm" data-note-waitkey>
          <div className="font-semibold">NF-e {waitKey.info.number} · série {waitKey.info.series} · {waitKey.info.uf} {waitKey.info.issued.split('-').reverse().join('/')}{waitKey.supplier ? ` · ${waitKey.supplier}` : ` · CNPJ ${waitKey.info.cnpj}`}</div>
          <p className="mt-1 text-muted">{waitKey.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="btn-primary cursor-pointer"><FileCode2 size={16} /> Importar XML desta nota<input type="file" accept=".xml,text/xml,application/xml" className="sr-only" onChange={xml} /></label>
            {waitKey.xml_by_key && <button className="btn-ghost" onClick={() => onBarcode(waitKey)}>Buscar de novo</button>}
            <button className="btn-ghost" onClick={() => setWaitKey(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {po && <ReceiveByCode purchase={po} onClose={() => setPo(null)} onDone={(st) => { setPo(null); toast(`Pedido #${po.id} ${st === 'recebida' ? 'recebido' : 'recebido em parte'}: estoque e custo médio atualizados`); onDone(); }} />}
      {!doc && !po && (
        <div className="grid gap-3 md:grid-cols-3">
          <label className={`card flex cursor-pointer flex-col items-center gap-2 p-6 text-center hover:border-copper ${!status.data?.photo ? 'opacity-60' : ''}`}
            onClick={(e) => { if (status.data && !status.data.photo) { e.preventDefault(); toast(s.can('configuracoes.gerenciar') ? 'A leitura por foto ainda não está configurada: informe a chave em Configurações › Integrações.' : 'A leitura por foto ainda não está configurada. Peça ao gerente; enquanto isso, use o XML ou digite a nota.', 'warn'); } }}>
            <Camera size={36} className="text-copper" />
            <span className="font-display text-2xl">Fotografar nota ou pedido</span>
            <span className="text-sm text-muted">Nota fiscal, cupom, pedido do fornecedor ou lista à mão. O sistema lê os itens, quantidades e preços — você confere antes de lançar.</span>
            <input type="file" accept="image/*,application/pdf" capture="environment" className="sr-only" onChange={photo} disabled={!!busy || !status.data?.photo} data-note-photo />
            {status.data && !status.data.photo && <span className="text-xs text-warn">Ainda não configurada (Configurações › Integrações).</span>}
          </label>
          <label className="card flex cursor-pointer flex-col items-center gap-2 p-6 text-center hover:border-copper">
            <FileCode2 size={36} className="text-copper" />
            <span className="font-display text-2xl">Importar XML da NF-e</span>
            <span className="text-sm text-muted">O arquivo .xml que o fornecedor envia por e-mail. Leitura exata, sem IA, e a mesma nota não entra duas vezes.</span>
            <input type="file" accept=".xml,text/xml,application/xml" className="sr-only" onChange={xml} disabled={!!busy} data-note-xml />
          </label>
          <button type="button" className="card flex flex-col items-center gap-2 p-6 text-center hover:border-copper" onClick={manual} disabled={!!busy} data-note-manual>
            <Keyboard size={36} className="text-copper" />
            <span className="font-display text-2xl">Digitar nota ou pedido</span>
            <span className="text-sm text-muted">Sem foto e sem XML: informe fornecedor e itens à mão. O lançamento segue a mesma conferência e entra no estoque como compra recebida.</span>
          </button>
        </div>
      )}
      {busy && <div className="flex items-center gap-2 text-muted"><Loader2 className="animate-spin" size={18} /> {busy}</div>}
      <ErrorBox error={err} />
      {doc && (
        <div className="card p-4">
          <div className="flex flex-wrap items-start gap-4">
            {preview && <img src={preview} alt="Foto da nota" className="h-40 w-32 rounded border border-line object-cover" />}
            <div className="grid flex-1 gap-3 sm:grid-cols-3">
              <Field label="Fornecedor"><input className="input" value={doc.supplier || ''} onChange={(e) => setDoc({ ...doc, supplier: e.target.value })} /></Field>
              <Field label="Documento"><input className="input" value={doc.document || ''} onChange={(e) => setDoc({ ...doc, document: e.target.value })} /></Field>
              <Field label="Vencimento (a pagar)"><input className="input" type="date" value={doc.due_date || ''} onChange={(e) => setDoc({ ...doc, due_date: e.target.value })} /></Field>
            </div>
          </div>
          {!!doc.warnings?.length && <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm">{doc.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
          <p className="mt-3 text-sm text-muted">Confira cada linha. Em <b>por embalagem</b>, informe quantas unidades do estoque vêm em cada unidade da nota (ex.: caixa com 12). O sistema lembra a escolha na próxima nota deste fornecedor.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="table-clean">
              <thead><tr><th>Na nota</th><th className="w-20">Qtd</th><th className="w-24">Por embalagem</th><th>Vai para o insumo</th><th className="w-28">R$ unit. (nota)</th><th className="text-right">Total</th><th /></tr></thead>
              <tbody>{doc.lines.map((l, i) => {
                const it = stock.find((x) => String(x.id) === l.target);
                const qtyStock = num(l.qty || 0) * (num(l.factor) || 1);
                return (
                  <tr key={i} data-note-line={i}>
                    <td className="max-w-[220px]">{l.manual ? <input className="input py-1" placeholder="Descrição na nota (opcional)" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Descrição" /> : <div className="font-semibold">{l.description}</div>}<div className="text-xs text-muted">{l.note_unit}{l.match === 'aprendido' ? ' · reconhecido' : l.match === 'semelhante' ? ' · sugerido' : ''}</div></td>
                    <td><input className="input px-2" inputMode="decimal" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} aria-label="Quantidade" /></td>
                    <td><input className="input px-2" inputMode="decimal" value={l.factor} onChange={(e) => setLine(i, { factor: e.target.value })} aria-label="Unidades por embalagem" /></td>
                    <td>
                      <select className="input" value={l.target} onChange={(e) => setLine(i, { target: e.target.value })} aria-label="Insumo">
                        <option value="novo">+ Criar insumo novo</option>{stock.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select>
                      {l.target === 'novo' && <div className="mt-1 flex gap-1"><input className="input py-1 text-sm" value={l.new_name} onChange={(e) => setLine(i, { new_name: e.target.value })} aria-label="Nome do novo insumo" />
                        <select className="input w-20 py-1 text-sm" value={l.new_unit} onChange={(e) => setLine(i, { new_unit: e.target.value })} aria-label="Unidade">{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div>}
                      <div className="text-xs text-muted">Entra: {qfmt(qtyStock, it?.unit || l.new_unit)}</div>
                    </td>
                    <td><input className="input px-2" inputMode="decimal" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} aria-label="Preço unitário" /></td>
                    <td className="text-right">{money(Math.round(num(l.qty || 0) * (parseCents(l.cost || '0') || 0)))}</td>
                    <td><button onClick={() => setDoc({ ...doc, lines: doc.lines.filter((_, j) => j !== i) })} aria-label="Remover linha"><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {doc.source === 'manual' && <button className="btn-ghost mt-2" onClick={() => setDoc({ ...doc, lines: [...doc.lines, blankLine()] })} data-note-add><Plus size={16} /> Adicionar item</button>}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="font-display text-2xl">Total {money(total)}</span>
            {doc.total != null && Math.abs(Math.round(doc.total * 100) - total) > 1 && <span className="text-sm text-warn">A nota diz {money(Math.round(doc.total * 100))} — confira quantidades e preços (frete e descontos não entram).</span>}
            <div className="ml-auto flex gap-2">
              <button className="btn-ghost" onClick={() => { setDoc(null); setPreview(null); }}>Descartar</button>
              <button className="btn-primary" disabled={!!busy} aria-disabled={(!doc.lines.length || (doc.supplier || '').trim().length < 2) || undefined} data-why={!doc.lines.length ? 'Adicione ao menos um item' : 'Informe o fornecedor'} onClick={confirm} data-note-confirm><CheckCircle2 size={16} /> Lançar no estoque</button>
            </div>
          </div>
        </div>
      )}
      {s.can('configuracoes.gerenciar') && !doc && (
        <p className="text-sm text-muted">Leitura por foto e busca da nota pelo código de barras se configuram em <Link className="font-semibold text-copper underline" to="/configuracoes/integracoes">Configurações › Integrações</Link>.</p>
      )}
    </div>
  );
}
