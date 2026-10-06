// Cardápio › Importar: traz produtos e categorias da Loja InfinitePay (ou de uma planilha CSV), mostra o que
// vai mudar e só grava depois da confirmação. Categorias que não existem são criadas; as existentes são atualizadas.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Store } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { parseMenuCsv } from '../lib/menuCsv.js';
import { Badge, ErrorBox, Field, Modal, Toggle, useToast } from '../components/ui.jsx';

const ACTION = { criar: ['Novo', 'ok'], atualizar: ['Atualizar', 'info'], igual: ['Sem mudança', 'muted'], ignorar: ['Ignorado', 'warn'] };
const LAST = 'rusten.menuImport.handle';
const remembered = () => { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } };
const CHANGE = { preco: 'preço', categoria: 'categoria', reativar: 'reativar', renomear: 'nome', ordem: 'ordem' };

export default function MenuImport({ open, onClose, onDone }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [tab, setTab] = useState('loja');
  const [handle, setHandle] = useState(remembered);
  const [csv, setCsv] = useState('');
  const [src, setSrc] = useState(null); // { source, items, categories, warnings, store, handle }
  const [opts, setOpts] = useState({ update_prices: true, update_categories: true, inactive_unavailable: true });
  const [sectorsOf, setSectorsOf] = useState({});
  const [plan, setPlan] = useState(null);
  const [skip, setSkip] = useState(() => new Set());
  const [filter, setFilter] = useState('mudancas');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStep(1); setTab('loja'); setSrc(null); setPlan(null); setErr(null); setSkip(new Set()); setSectorsOf({});
    api('/api/infinitepay/settings').then((c) => { if (c?.handle) setHandle((h) => h || c.handle); }).catch(() => {});
  }, [open]);

  const body = (extra = {}) => ({
    source: src.source, items: src.items.filter((_, i) => !skip.has(i)), categories: src.categories, category_sectors: sectorsOf, ...opts, ...extra,
  });
  // prévia sempre recalculada no servidor (opções, setores e itens desmarcados)
  useEffect(() => {
    if (!src) return;
    let alive = true;
    setBusy(true); setErr(null);
    api('/api/menu/import', { method: 'POST', body: { ...body(), items: src.items, dry_run: true } })
      .then((p) => { if (alive) { setPlan(p); setStep(2); } })
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, opts, sectorsOf]);

  const fetchStore = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/menu/import/infinitepay/fetch', { method: 'POST', body: { handle } });
      try { localStorage.setItem(LAST, r.handle); } catch { /* sem armazenamento: só não lembra */ }
      setSrc({ source: 'infinitepay', store: r.store, handle: r.handle, warnings: r.warnings || [], categories: r.categories.map((c) => c.name),
        items: r.products.map((p) => ({ name: p.name, category: p.category, price_cents: p.price_cents, available: p.available, variations: p.variations })) });
    } catch (e) { setErr(e); setBusy(false); }
  };
  const readCsv = (text) => {
    const r = parseMenuCsv(text);
    if (!r.items.length) { setErr(new Error(r.errors.join(' '))); return; }
    setSrc({ source: 'planilha', store: null, warnings: r.errors, categories: [], items: r.items });
  };
  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/menu/import', { method: 'POST', body: body() });
      toast(`Cardápio importado: ${r.created} novo(s), ${r.updated} atualizado(s), ${r.categories_created} categoria(s) criada(s)`);
      onDone(); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const rows = useMemo(() => (plan ? plan.items.map((it, i) => ({ ...it, i, variations: src?.items[i]?.variations })) : []), [plan, src]);
  const shown = rows.filter((r) => filter === 'todos' || (filter === 'mudancas' ? r.action === 'criar' || r.action === 'atualizar' : r.action === filter));
  const selected = rows.filter((r) => !skip.has(r.i) && (r.action === 'criar' || r.action === 'atualizar')).length;
  const toggle = (i) => setSkip((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });

  return (
    <Modal open={open} onClose={onClose} wide title="Importar cardápio"
      footer={step === 1
        ? <><button className="btn-ghost" onClick={onClose}>Cancelar</button>
          {tab === 'loja'
            ? <button className="btn-primary" disabled={busy || !handle.trim()} onClick={fetchStore}><Download size={16} /> {busy ? 'Lendo a loja…' : 'Buscar cardápio'}</button>
            : <button className="btn-primary" disabled={busy || !csv.trim()} onClick={() => readCsv(csv)}>Conferir</button>}</>
        : <><button className="btn-ghost" onClick={() => { setStep(1); setTab('loja'); setSrc(null); setPlan(null); }}>Voltar</button>
          <button className="btn-primary" disabled={busy || !plan || (!selected && !plan.summary.categorias_criar && !plan.summary.categorias_atualizar)} onClick={apply}>
            {busy ? 'Aguarde…' : `Importar ${selected} produto(s)`}</button></>}>
      <ol className="mb-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
        {['Origem', 'Conferir e importar'].map((t, i) => (
          <li key={t} className={`rounded-full border px-3 py-1 ${i + 1 === step ? 'border-copper text-copper' : i + 1 < step ? 'border-ok text-ok' : 'border-line text-muted'}`}>{i + 1}. {t}</li>))}
      </ol>

      {step === 1 && (
        <div>
          <div className="mb-3 flex gap-2">
            <button className={tab === 'loja' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('loja')}><Store size={16} /> Loja InfinitePay</button>
            <button className={tab === 'csv' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('csv')}><FileSpreadsheet size={16} /> Planilha (CSV)</button>
          </div>
          {tab === 'loja' ? (
            <div className="space-y-3">
              <Field label="InfiniteTag ou endereço da loja" hint="O mesmo usuário da InfinitePay, sem o $ (ex.: meubar), ou o link loja.infinitepay.io/meubar">
                <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handle.trim() && fetchStore()} placeholder="meubar" />
              </Field>
              <p className="text-sm text-muted">O RUSTEN lê o catálogo publicado na Loja Online da InfinitePay (produtos, preços e categorias). Nada muda no seu cardápio até você conferir e confirmar no próximo passo.
                Se a loja não estiver publicada, ative em <b>app InfinitePay › Loja Online</b> ou use a aba Planilha.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="Arquivo CSV" hint="Colunas: nome, categoria, preço (e, se quiser, disponível). Separador ; ou ,">
                <input className="input" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
              </Field>
              <Field label="…ou cole as linhas aqui"><textarea className="input font-mono text-sm" rows={7} value={csv} onChange={(e) => setCsv(e.target.value)}
                placeholder={'nome;categoria;preço\nChopp Pilsen 300ml;CHOPP e CERVEJA;12,00\nBatata frita;COZINHA;32,90'} /></Field>
            </div>
          )}
        </div>
      )}

      {step === 2 && plan && (
        <div className="space-y-4">
          {src.store && <p className="text-sm">Loja: <b>{src.store}</b> {src.handle && <span className="text-muted">(loja.infinitepay.io/{src.handle})</span>} — {src.items.length} produto(s), {src.categories.length} categoria(s)</p>}
          {src.warnings?.map((w) => <Note key={w}>{w}</Note>)}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Box l="Produtos novos" v={plan.summary.criar} />
            <Box l="A atualizar" v={plan.summary.atualizar} />
            <Box l="Sem mudança" v={plan.summary.igual} />
            <Box l="Categorias novas / atualizadas" v={`${plan.summary.categorias_criar} / ${plan.summary.categorias_atualizar}`} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle checked={opts.update_prices} onChange={(v) => setOpts((o) => ({ ...o, update_prices: v }))} label="Atualizar preços" hint="Produtos que já existem passam a ter o preço da InfinitePay (fica no histórico)" />
            <Toggle checked={opts.update_categories} onChange={(v) => setOpts((o) => ({ ...o, update_categories: v }))} label="Mover para a categoria da InfinitePay" />
            <Toggle checked={opts.inactive_unavailable} onChange={(v) => setOpts((o) => ({ ...o, inactive_unavailable: v }))} label="Indisponíveis entram inativos" />
          </div>

          {plan.categories.length > 0 && (
            <div>
              <h3 className="font-display text-2xl">Categorias</h3>
              <p className="text-sm text-muted">O setor vale para os produtos novos de cada categoria (é para onde o pedido vai: Cozinha, Bar…). Pode mudar depois em cada produto.</p>
              <div className="overflow-x-auto"><table className="table-clean">
                <thead><tr><th>Categoria</th><th>O que acontece</th><th>Setor dos produtos novos</th></tr></thead>
                <tbody>{plan.categories.map((c) => (
                  <tr key={c.name}>
                    <td className="font-semibold">{c.name}{c.current_name && c.current_name !== c.name && <div className="text-xs text-muted">hoje: {c.current_name}</div>}</td>
                    <td><Badge tone={c.action === 'criar' ? 'ok' : c.action === 'atualizar' ? 'info' : 'muted'}>{c.action === 'criar' ? 'Criar' : c.action === 'atualizar' ? `Atualizar (${c.changes.map((x) => CHANGE[x]).join(', ')})` : 'Já existe'}</Badge></td>
                    <td><select className="input py-1" value={c.sector_id ?? ''} onChange={(e) => setSectorsOf((s) => ({ ...s, [c.name]: e.target.value ? Number(e.target.value) : null }))}>
                      <option value="">Não produz</option>{plan.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                  </tr>))}</tbody>
              </table></div>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-2xl">Produtos</h3>
              <select className="input max-w-[220px] py-1" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="mudancas">Novos e a atualizar</option><option value="todos">Todos</option><option value="criar">Só novos</option><option value="atualizar">Só a atualizar</option><option value="igual">Sem mudança</option><option value="ignorar">Ignorados</option>
              </select>
            </div>
            {!shown.length ? <p className="py-3 text-sm text-muted">Nada nesta lista.</p> : (
              <div className="max-h-[45vh] overflow-auto"><table className="table-clean">
                <thead><tr><th /><th>Produto</th><th>Categoria</th><th className="text-right">Preço</th><th>O que acontece</th></tr></thead>
                <tbody>{shown.map((r) => {
                  const can = r.action === 'criar' || r.action === 'atualizar';
                  return (
                    <tr key={r.i} className={skip.has(r.i) ? 'opacity-50' : ''}>
                      <td>{can && <input type="checkbox" aria-label={`Importar ${r.name}`} checked={!skip.has(r.i)} onChange={() => toggle(r.i)} />}</td>
                      <td><div className="font-semibold">{r.name}</div>
                        {r.current_name && r.current_name !== r.name && <div className="text-xs text-muted">no RUSTEN: {r.current_name}</div>}
                        {r.variations > 1 && <div className="text-xs text-warn">{r.variations} variações na InfinitePay — entra com o preço padrão; tamanhos/opções podem ser ajustados no produto</div>}
                        {!r.available && <div className="text-xs text-muted">indisponível na InfinitePay</div>}</td>
                      <td>{r.category || '—'}</td>
                      <td className="whitespace-nowrap text-right">{r.changes?.includes('preco') && <span className="mr-1 text-xs text-muted line-through">{money(r.current_price_cents)}</span>}{money(r.price_cents)}</td>
                      <td><Badge tone={ACTION[r.action][1]}>{ACTION[r.action][0]}</Badge>{r.changes?.length > 0 && <span className="ml-1 text-xs text-muted">{r.changes.map((x) => CHANGE[x]).join(', ')}</span>}{r.reason && <span className="ml-1 text-xs text-muted">{r.reason}</span>}</td>
                    </tr>);
                })}</tbody>
              </table></div>
            )}
          </div>
          <p className="text-xs text-muted">Produtos novos entram como revenda, unidade, custo R$ 0,00 e sem estoque controlado. Nada é excluído: o que existe só no RUSTEN continua igual.
            {src.source === 'infinitepay' && ' Os nomes ficam ligados à maquininha, então o relatório de vendas da InfinitePay passa a reconhecer esses produtos sozinho.'}</p>
        </div>
      )}
      {busy && step === 2 && <p className="mt-2 text-sm text-muted">Atualizando a prévia…</p>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

const Box = ({ l, v }) => <div className="card p-3"><div className="text-xs uppercase text-muted">{l}</div><div className="font-display text-2xl">{v}</div></div>;
const Note = ({ children }) => <div className="flex gap-2 rounded-lg border border-warn p-3 text-sm"><AlertTriangle size={18} className="shrink-0" /><div>{children}</div></div>;
