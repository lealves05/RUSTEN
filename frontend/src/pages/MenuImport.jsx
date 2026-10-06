// Cardápio › Importar: planilha de produtos (.xlsx ou CSV — inclusive a exportada da InfinitePay ou de outro sistema)
// ou a Loja Online da InfinitePay. Categorias da planilha que não existem no RUSTEN abrem uma tela para indicar
// uma categoria existente ou criar a da planilha. Nada é gravado antes da confirmação.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Store, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { readSheetFile } from '../lib/xlsx.js';
import { parseMenuGrid, COL_LABEL } from '../lib/menuSheet.js';
import { Badge, ErrorBox, Field, Modal, Toggle, useToast } from '../components/ui.jsx';

const ACTION = { criar: ['Novo', 'ok'], atualizar: ['Atualizar', 'info'], igual: ['Sem mudança', 'muted'], ignorar: ['Ignorado', 'warn'] };
const LAST = 'rusten.menuImport.handle';
const remembered = () => { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } };
const CHANGE = { preco: 'preço', custo: 'custo', categoria: 'categoria', reativar: 'reativar', pausar: 'pausar', renomear: 'nome', ordem: 'ordem', codigo: 'código', codigo_barras: 'código de barras' };
const STEPS = ['Origem', 'Categorias', 'Conferir e importar'];
const nk = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stem = (s) => nk(s).split(' ').map((w) => w.replace(/(oes|aes|es|s)$/, '')).join(' ');
// sugestão de categoria existente parecida (plural, acento, "e" no meio…)
const suggest = (name, cats) => cats.find((c) => stem(c.name) === stem(name)) || cats.find((c) => stem(c.name).includes(stem(name)) || stem(name).includes(stem(c.name))) || null;

export default function MenuImport({ open, onClose, onDone }) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [tab, setTab] = useState('arquivo');
  const [handle, setHandle] = useState(remembered);
  const [fileName, setFileName] = useState('');
  const [src, setSrc] = useState(null); // { source, items, categories, warnings, store, handle, columns }
  const [opts, setOpts] = useState({ update_prices: true, update_costs: true, update_categories: true, inactive_unavailable: true });
  const [sectorsOf, setSectorsOf] = useState({});
  const [catMap, setCatMap] = useState({}); // confirmado (vai para o servidor)
  const [ask, setAsk] = useState(null); // { names: [], existing: [], draft: {name: 'new' | id} }
  const [plan, setPlan] = useState(null);
  const [skip, setSkip] = useState(() => new Set());
  const [filter, setFilter] = useState('mudancas');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStep(1); setTab('arquivo'); setSrc(null); setPlan(null); setErr(null); setSkip(new Set()); setSectorsOf({}); setCatMap({}); setAsk(null); setFileName('');
    api('/api/infinitepay/settings').then((c) => { if (c?.handle) setHandle((h) => h || c.handle); }).catch(() => {});
  }, [open]);

  const body = (extra = {}) => ({
    source: src.source, items: src.items.filter((_, i) => !skip.has(i)), categories: src.categories, category_sectors: sectorsOf, category_map: catMap, ...opts, ...extra,
  });
  // prévia sempre recalculada no servidor (opções, setores, categorias indicadas e itens desmarcados)
  useEffect(() => {
    if (!src) return;
    let alive = true;
    setBusy(true); setErr(null);
    api('/api/menu/import', { method: 'POST', body: { ...body(), items: src.items, dry_run: true } })
      .then((p) => {
        if (!alive) return;
        setPlan(p);
        if (p.unresolved?.length) {
          // categorias da planilha que não existem: perguntar antes de seguir
          setAsk((a) => ({ names: [...new Set([...(a?.names || []), ...p.unresolved])], existing: p.existing_categories,
            draft: { ...(a?.draft || {}), ...Object.fromEntries(p.unresolved.map((n) => [n, a?.draft?.[n] ?? (suggest(n, p.existing_categories)?.id || 'new')])) } }));
          setStep(2);
        } else setStep(3);
      })
      .catch((e) => alive && setErr(e))
      .finally(() => alive && setBusy(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, opts, sectorsOf, catMap]);

  const fetchStore = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/menu/import/infinitepay/fetch', { method: 'POST', body: { handle } });
      try { localStorage.setItem(LAST, r.handle); } catch { /* sem armazenamento: só não lembra */ }
      setSrc({ source: 'infinitepay', store: r.store, handle: r.handle, warnings: r.warnings || [], categories: r.categories.map((c) => c.name),
        items: r.products.map((p) => ({ name: p.name, category: p.category, price_cents: p.price_cents, available: p.available, variations: p.variations })) });
    } catch (e) { setErr(e); setBusy(false); }
  };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setErr(null); setFileName(f.name); setBusy(true); setAsk(null); setCatMap({}); setSkip(new Set());
    try {
      const r = parseMenuGrid(await readSheetFile(f));
      if (!r.items.length) throw new Error(r.errors.join(' '));
      if (r.items.length > 3000) throw new Error('Máximo de 3.000 produtos por importação: divida a planilha.');
      setSrc({ source: 'arquivo', store: null, warnings: r.errors, categories: [], items: r.items, columns: r.columns, skipped: r.skipped });
    } catch (x) { setErr(x); setBusy(false); } finally { e.target.value = ''; }
  };
  const confirmCats = () => {
    setCatMap(Object.fromEntries(ask.names.map((n) => [n, ask.draft[n] === 'new' ? { create: true } : { category_id: Number(ask.draft[n]) }])));
  };
  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/menu/import', { method: 'POST', body: body() });
      toast(`Cardápio importado: ${r.created} novo(s), ${r.updated} atualizado(s), ${r.categories_created} categoria(s) criada(s)`);
      onDone(); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const restart = () => { setStep(1); setSrc(null); setPlan(null); setAsk(null); setCatMap({}); setSkip(new Set()); };

  const rows = useMemo(() => (plan ? plan.items.map((it, i) => ({ ...it, i, variations: src?.items[i]?.variations })) : []), [plan, src]);
  const shown = rows.filter((r) => filter === 'todos' || (filter === 'mudancas' ? r.action === 'criar' || r.action === 'atualizar' : r.action === filter));
  const selected = rows.filter((r) => !skip.has(r.i) && (r.action === 'criar' || r.action === 'atualizar')).length;
  const toggle = (i) => setSkip((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const countIn = (name) => (src ? src.items.filter((x) => nk(x.category) === nk(name)).length : 0);
  const isFile = src?.source === 'arquivo';

  const footer = step === 1
    ? <><button className="btn-ghost" onClick={onClose}>Cancelar</button>
      {tab === 'loja' && <button className="btn-primary" disabled={busy || !handle.trim()} onClick={fetchStore}><Download size={16} /> {busy ? 'Lendo a loja…' : 'Buscar cardápio'}</button>}</>
    : step === 2
      ? <><button className="btn-ghost" onClick={restart}>Voltar</button><button className="btn-primary" disabled={busy || !ask} onClick={confirmCats} data-cat-continue>Continuar</button></>
      : <><button className="btn-ghost" onClick={() => (ask ? setStep(2) : restart())}>Voltar</button>
        <button className="btn-primary" disabled={busy || !plan || plan.unresolved?.length || (!selected && !plan.summary.categorias_criar && !plan.summary.categorias_atualizar)} onClick={apply}>
          {busy ? 'Aguarde…' : `Importar ${selected} produto(s)`}</button></>;

  return (
    <Modal open={open} onClose={onClose} wide title="Importar produtos" footer={footer}>
      <ol className="mb-4 flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-wide">
        {STEPS.map((t, i) => (
          <li key={t} className={`rounded-full border px-3 py-1 ${i + 1 === step ? 'border-copper text-copper' : i + 1 < step ? 'border-ok text-ok' : 'border-line text-muted'}`}>{i + 1}. {t}</li>))}
      </ol>

      {step === 1 && (
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <button className={tab === 'arquivo' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('arquivo')}><FileSpreadsheet size={16} /> Planilha (Excel ou CSV)</button>
            <button className={tab === 'loja' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('loja')}><Store size={16} /> Loja InfinitePay</button>
          </div>
          {tab === 'arquivo' ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">Use a planilha de produtos exportada da InfinitePay (ou de outro sistema), ou a exportada pelo próprio RUSTEN (botão <b>Exportar</b>).
                Colunas reconhecidas: <b>Nome</b>, <b>Categoria</b>, <b>Preço Venda</b>, <b>Preço Custo</b>, <b>Código</b> / Cód. PDV, <b>Código de barras</b> / Cód. Busca, <b>Medida</b>, <b>Status Venda</b> e <b>Setor</b>. As demais (impostos, estoque…) são ignoradas.</p>
              <label className="btn-ghost inline-flex cursor-pointer"><Upload size={16} /> {busy ? 'Lendo a planilha…' : fileName ? 'Escolher outra planilha' : 'Escolher planilha'}
                <input type="file" className="sr-only" data-menu-file accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} /></label>
              {fileName && <span className="ml-2 text-sm">{fileName}</span>}
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="InfiniteTag ou endereço da loja" hint="O mesmo usuário da InfinitePay, sem o $ (ex.: meubar), ou o link loja.infinitepay.io/meubar">
                <input className="input" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handle.trim() && fetchStore()} placeholder="meubar" />
              </Field>
              <p className="text-sm text-muted">Lê o catálogo publicado na Loja Online da InfinitePay. Só funciona com a Loja Online ativa; senão, exporte os produtos no portal da InfinitePay e use a aba Planilha.</p>
            </div>
          )}
        </div>
      )}

      {step === 2 && ask && (
        <div className="space-y-3" data-cat-step>
          <Note>{ask.names.length === 1 ? 'Esta categoria da planilha não existe' : `Estas ${ask.names.length} categorias da planilha não existem`} no seu cardápio. Para cada uma, indique uma categoria que você já tem ou crie a da planilha.</Note>
          <div className="overflow-x-auto"><table className="table-clean">
            <thead><tr><th>Categoria na planilha</th><th className="text-right">Produtos</th><th>No RUSTEN</th></tr></thead>
            <tbody>{ask.names.map((n) => {
              const sug = suggest(n, ask.existing);
              return (
                <tr key={n}>
                  <td className="font-semibold">{n}</td>
                  <td className="text-right">{countIn(n)}</td>
                  <td>
                    <select className="input py-1" aria-label={`Categoria para ${n}`} value={ask.draft[n] ?? 'new'} onChange={(e) => setAsk((a) => ({ ...a, draft: { ...a.draft, [n]: e.target.value === 'new' ? 'new' : Number(e.target.value) } }))}>
                      <option value="new">Criar “{n}”</option>
                      {ask.existing.length > 0 && <optgroup label="Usar uma categoria que já existe">{ask.existing.map((c) => <option key={c.id} value={c.id}>{c.name}{sug?.id === c.id ? ' (sugerida)' : ''}</option>)}</optgroup>}
                    </select>
                  </td>
                </tr>);
            })}</tbody>
          </table></div>
          <div className="flex flex-wrap gap-3 text-sm">
            <button className="underline" onClick={() => setAsk((a) => ({ ...a, draft: Object.fromEntries(a.names.map((n) => [n, 'new'])) }))}>criar todas</button>
            {ask.existing.length > 0 && <button className="underline" onClick={() => setAsk((a) => ({ ...a, draft: Object.fromEntries(a.names.map((n) => [n, suggest(n, a.existing)?.id || 'new'])) }))}>usar as sugeridas</button>}
          </div>
        </div>
      )}

      {step === 3 && plan && (
        <div className="space-y-4">
          {src.store && <p className="text-sm">Loja: <b>{src.store}</b> {src.handle && <span className="text-muted">(loja.infinitepay.io/{src.handle})</span>} — {src.items.length} produto(s), {src.categories.length} categoria(s)</p>}
          {isFile && <p className="text-sm">Planilha: <b>{fileName}</b> — {src.items.length} produto(s){src.skipped ? `, ${src.skipped} linha(s) ignorada(s) (total/rodapé ou sem preço)` : ''}. Colunas usadas: {src.columns.map((c) => COL_LABEL[c]).join(', ')}.</p>}
          {src.warnings?.map((w) => <Note key={w}>{w}</Note>)}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Box l="Produtos novos" v={plan.summary.criar} />
            <Box l="A atualizar" v={plan.summary.atualizar} />
            <Box l="Sem mudança" v={plan.summary.igual} />
            <Box l="Categorias novas / atualizadas" v={`${plan.summary.categorias_criar} / ${plan.summary.categorias_atualizar}`} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Toggle checked={opts.update_prices} onChange={(v) => setOpts((o) => ({ ...o, update_prices: v }))} label="Atualizar preço de venda" hint="Nos produtos que já existem (fica no histórico)" />
            {isFile && <Toggle checked={opts.update_costs} onChange={(v) => setOpts((o) => ({ ...o, update_costs: v }))} label="Atualizar custo" />}
            <Toggle checked={opts.update_categories} onChange={(v) => setOpts((o) => ({ ...o, update_categories: v }))} label="Mover para a categoria da importação" />
            <Toggle checked={opts.inactive_unavailable} onChange={(v) => setOpts((o) => ({ ...o, inactive_unavailable: v }))} label={isFile ? 'Pausados ficam inativos' : 'Indisponíveis entram inativos'} />
          </div>

          {plan.categories.length > 0 && (
            <div>
              <h3 className="font-display text-2xl">Categorias</h3>
              <p className="text-sm text-muted">O setor vale para os produtos novos de cada categoria (é para onde o pedido vai: Cozinha, Bar…). Pode mudar depois em cada produto.</p>
              <div className="overflow-x-auto"><table className="table-clean">
                <thead><tr><th>Categoria</th><th>O que acontece</th><th>Setor dos produtos novos</th></tr></thead>
                <tbody>{plan.categories.map((c) => (
                  <tr key={c.name}>
                    <td className="font-semibold">{c.name}{c.current_name && nk(c.current_name) !== nk(c.name) && <div className="text-xs text-muted">{c.mapped ? 'vai para' : 'hoje'}: {c.current_name}</div>}</td>
                    <td><Badge tone={c.action === 'criar' ? 'ok' : c.action === 'atualizar' ? 'info' : 'muted'}>{c.action === 'criar' ? 'Criar' : c.mapped ? `Usar “${c.current_name}”` : c.action === 'atualizar' ? `Atualizar (${c.changes.map((x) => CHANGE[x]).join(', ')})` : 'Já existe'}</Badge></td>
                    <td><select className="input py-1" value={c.sector_id ?? ''} onChange={(e) => setSectorsOf((s) => ({ ...s, [c.name]: e.target.value ? Number(e.target.value) : null }))}>
                      <option value="">Não produz</option>{plan.sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                  </tr>))}</tbody>
              </table></div>
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-2xl">Produtos</h3>
              <select className="input max-w-[220px] py-1" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Mostrar produtos">
                <option value="mudancas">Novos e a atualizar</option><option value="todos">Todos</option><option value="criar">Só novos</option><option value="atualizar">Só a atualizar</option><option value="igual">Sem mudança</option><option value="ignorar">Ignorados</option>
              </select>
            </div>
            {!shown.length ? <p className="py-3 text-sm text-muted">Nada nesta lista.</p> : (
              <div className="max-h-[45vh] overflow-auto"><table className="table-clean">
                <thead><tr><th /><th>Produto</th><th>Categoria</th>{isFile && <th className="text-right">Custo</th>}<th className="text-right">Preço</th><th>O que acontece</th></tr></thead>
                <tbody>{shown.map((r) => {
                  const can = r.action === 'criar' || r.action === 'atualizar';
                  return (
                    <tr key={r.i} className={skip.has(r.i) ? 'opacity-50' : ''}>
                      <td>{can && <input type="checkbox" aria-label={`Importar ${r.name}`} checked={!skip.has(r.i)} onChange={() => toggle(r.i)} />}</td>
                      <td><div className="font-semibold">{r.name}</div>
                        {(r.sku || r.codes?.length > 0) && <div className="font-mono text-xs text-muted">{[r.sku && `cód. ${r.sku}`, ...(r.codes || [])].filter(Boolean).join(' · ')}</div>}
                        {r.current_name && r.current_name !== r.name && <div className="text-xs text-muted">no RUSTEN: {r.current_name}</div>}
                        {r.variations > 1 && <div className="text-xs text-warn">{r.variations} variações na InfinitePay — entra com o preço padrão</div>}
                        {!r.available && <div className="text-xs text-muted">{isFile ? 'pausado na planilha' : 'indisponível na InfinitePay'}</div>}
                        {r.warnings?.map((w) => <div key={w} className="text-xs text-warn">{w}</div>)}</td>
                      <td>{r.category_resolved || r.category || '—'}</td>
                      {isFile && <td className="whitespace-nowrap text-right">{r.cost_cents == null ? '—' : money(r.cost_cents)}</td>}
                      <td className="whitespace-nowrap text-right">{r.changes?.includes('preco') && <span className="mr-1 text-xs text-muted line-through">{money(r.current_price_cents)}</span>}{money(r.price_cents)}</td>
                      <td><Badge tone={ACTION[r.action][1]}>{ACTION[r.action][0]}</Badge>{r.changes?.length > 0 && <span className="ml-1 text-xs text-muted">{r.changes.map((x) => CHANGE[x]).join(', ')}</span>}{r.reason && <span className="ml-1 text-xs text-muted">{r.reason}</span>}</td>
                    </tr>);
                })}</tbody>
              </table></div>
            )}
          </div>
          <p className="text-xs text-muted">Produtos novos entram como revenda e sem estoque controlado (o estoque da planilha não é importado). Nada é excluído: o que existe só no RUSTEN continua igual.
            Os nomes ficam ligados à maquininha, então o relatório de vendas da InfinitePay passa a reconhecer esses produtos sozinho.</p>
        </div>
      )}
      {busy && step > 1 && <p className="mt-2 text-sm text-muted">Atualizando a prévia…</p>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

const Box = ({ l, v }) => <div className="card p-3"><div className="text-xs uppercase text-muted">{l}</div><div className="font-display text-2xl">{v}</div></div>;
const Note = ({ children }) => <div className="flex gap-2 rounded-lg border border-warn p-3 text-sm"><AlertTriangle size={18} className="shrink-0" /><div>{children}</div></div>;
