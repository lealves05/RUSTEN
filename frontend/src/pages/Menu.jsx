// Cardápio: produtos, preços, códigos de leitura, opções e categorias.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Download, ImagePlus, Plus, Trash2, Upload } from 'lucide-react';
import { xlsxBlob, saveBlob } from '../lib/xlsxWrite.js';
import { menuExportRows } from '../lib/menuSheet.js';
import MenuImport from './MenuImport.jsx';
import { api } from '../lib/api.js';
import { money, parseCents, centsToInput, dateTime } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Toggle, useLoad, useToast } from '../components/ui.jsx';

const KINDS = { resale: 'Revenda', recipe: 'Preparado (receita)', produced: 'Produção própria', combo: 'Combo', addon: 'Adicional', weight: 'Por peso' };

export default function Menu() {
  const s = useSession();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const [catModal, setCatModal] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const exportMenu = async () => {
    setExporting(true);
    try {
      const rows = await api('/api/menu/export');
      saveBlob(xlsxBlob('Produtos', menuExportRows(rows)), `cardapio-rusten-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast(`${rows.length} produto(s) exportado(s)`);
    } catch (e) { toast(e.message || 'Não foi possível exportar'); } finally { setExporting(false); }
  };
  const products = useLoad(() => api('/api/menu/products?active=all'));
  const cats = useLoad(() => api('/api/menu/categories'));
  const sectors = useLoad(() => api('/api/menu/sectors'));
  const manage = s.can('cardapio.gerenciar');
  useEffect(() => {
    const id = Number(params.get('produto'));
    if (id && products.data) setEdit(products.data.find((p) => p.id === id) || null);
  }, [params, products.data]);
  if (products.loading || cats.loading) return <Loading />;
  if (products.error) return <ErrorBox error={products.error} onRetry={products.reload} />;
  const list = products.data.filter((p) => (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.codes.includes(q) || p.sku === q) && (!cat || p.category_id === Number(cat)));
  const catName = (id) => cats.data.find((c) => c.id === id)?.name || '—';
  return (
    <div>
      <PageHeader title="Cardápio" subtitle="Preços, códigos de leitura e opções valem igualmente em todos os modos do PDV"
        actions={manage && <><button className="btn-ghost" onClick={() => setImporting(true)}><Upload size={16} /> Importar</button><button className="btn-ghost" onClick={exportMenu} disabled={exporting}><Download size={16} /> {exporting ? 'Gerando…' : 'Exportar'}</button><button className="btn-ghost" onClick={() => setCatModal(true)}>Categorias</button><button className="btn-primary" onClick={() => setEdit({})}><Plus size={16} /> Novo produto</button></>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Buscar por nome, SKU ou código" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[220px]" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas as categorias</option>{cats.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      {!list.length ? <Empty icon={BookOpen} title="Nenhum produto">{products.data.length ? 'Nada encontrado com esse filtro.' : <>Cadastre o primeiro produto do cardápio{manage && <> ou <button className="underline" onClick={() => setImporting(true)}>importe uma planilha de produtos</button></>}.</>}</Empty> : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Produto</th><th>Categoria</th><th>Tipo</th><th className="text-right">Preço</th>{list[0]?.cost_cents !== undefined && <th className="text-right">Custo</th>}<th>Códigos</th><th>Situação</th></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={manage ? 'cursor-pointer hover:bg-raised' : ''} onClick={() => manage && setEdit(p)}>
                  <td><div className="font-semibold">{p.name}</div>{p.groups.length > 0 && <div className="text-xs text-muted">{p.groups.map((g) => g.name).join(' · ')}</div>}</td>
                  <td>{catName(p.category_id)}</td>
                  <td>{KINDS[p.kind]}</td>
                  <td className="text-right">{money(p.price_cents)}{p.kind === 'weight' ? `/${p.unit}` : ''}</td>
                  {p.cost_cents !== undefined && <td className="text-right">{money(p.cost_cents)}</td>}
                  <td className="font-mono text-xs">{p.codes.join(', ') || '—'}</td>
                  <td className="space-x-1">{p.active ? <Badge tone="ok">Ativo</Badge> : <Badge tone="muted">Inativo</Badge>}{p.demo && <Badge tone="warn">Demo</Badge>}{p.favorite && <Badge tone="info">Favorito</Badge>}{p.photo_v && <Badge tone="muted" icon={ImagePlus}>Foto</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <ProductForm product={edit} cats={cats.data} sectors={sectors.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); products.reload(); }} />}
      {manage && <MenuImport open={importing} onClose={() => setImporting(false)} onDone={() => { products.reload(); cats.reload(); }} />}
      <CategoriesModal open={catModal} cats={cats.data} onClose={() => setCatModal(false)} onChanged={cats.reload} />
    </div>
  );
}

function ProductForm({ product, cats, sectors, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !product.id;
  const [f, setF] = useState(() => ({
    name: product.name || '', description: product.description || '', sku: product.sku || '', kind: product.kind || 'resale', unit: product.unit || 'un',
    price: centsToInput(product.price_cents), cost: centsToInput(product.cost_cents ?? 0), category_id: product.category_id || '', sector_id: product.sector_id || '',
    favorite: !!product.favorite, active: product.active ?? true, channels: product.channels || ['pdv', 'delivery', 'cardapio_digital'], allergens: product.allergens || '', codes: (product.codes || []).join('\n'),
    groups: (product.groups || []).map((g) => ({ name: g.name, min: g.min, max: g.max, options: g.options.map((o) => ({ name: o.name, price: centsToInput(o.price_cents) })) })),
  }));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(null);
  const [photo, setPhoto] = useState({ url: null, changed: false }); // foto do cardápio digital
  useEffect(() => { if (!isNew && product.photo_v) api(`/api/menu/products/${product.id}/photo`).then((r) => setPhoto({ url: r.data_url, changed: false })).catch(() => {}); }, [isNew, product.id, product.photo_v]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setGroup = (i, patch) => setF((x) => ({ ...x, groups: x.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));
  useEffect(() => { if (!isNew) api(`/api/menu/products/${product.id}/prices`).then(setHistory).catch(() => {}); }, [isNew, product.id]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const price = parseCents(f.price); const cost = parseCents(f.cost || '0');
      if (price == null) throw new Error('Preço inválido');
      if (cost == null) throw new Error('Custo inválido');
      const groups = f.groups.map((g) => ({ name: g.name.trim(), min: Number(g.min), max: Number(g.max),
        options: g.options.filter((o) => o.name.trim()).map((o) => { const c = parseCents(o.price || '0'); if (c == null) throw new Error(`Preço inválido em ${o.name}`); return { name: o.name.trim(), price_cents: c }; }) }));
      const body = { name: f.name, description: f.description || null, sku: f.sku || null, kind: f.kind, unit: f.kind === 'weight' && f.unit === 'un' ? 'kg' : f.unit,
        price_cents: price, cost_cents: cost, category_id: f.category_id ? Number(f.category_id) : null, sector_id: f.sector_id ? Number(f.sector_id) : null,
        favorite: f.favorite, active: f.active, channels: f.channels.length ? f.channels : ['pdv'], allergens: f.allergens || null, codes: f.codes.split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean), groups };
      const r = await api(isNew ? '/api/menu/products' : `/api/menu/products/${product.id}`, { method: isNew ? 'POST' : 'PUT', body });
      const id = isNew ? r.id : product.id;
      if (photo.changed) {
        try {
          if (photo.url) await api(`/api/menu/products/${id}/photo`, { method: 'PUT', body: { data_url: photo.url } });
          else await api(`/api/menu/products/${id}/photo`, { method: 'DELETE' });
        } catch (e2) { toast(`Produto salvo, mas a foto não: ${e2.message}`, 'warn'); onSaved(); return; }
      }
      toast(isNew ? 'Produto criado' : 'Produto salvo'); onSaved();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={isNew ? 'Novo produto' : product.name} wide
      footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save} disabled={busy}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Tipo"><select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value)}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Unidade de venda"><select className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)}>{['un', 'kg', 'g', 'L', 'ml'].map((u) => <option key={u}>{u}</option>)}</select></Field>
        <Field label={`Preço (R$${f.kind === 'weight' ? ` por ${f.unit}` : ''})`}><input className="input" inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <Field label="Custo (R$)" hint="Visível só para quem vê CMV/gerencia o cardápio"><input className="input" inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label="Categoria"><select className="input" value={f.category_id} onChange={(e) => set('category_id', e.target.value)}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Setor de produção" hint="Sem setor = não vai para cozinha/bar"><select className="input" value={f.sector_id} onChange={(e) => set('sector_id', e.target.value)}><option value="">Não produz</option>{sectors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="SKU (opcional)" hint="Seu código interno do produto."><input className="input" value={f.sku} onChange={(e) => set('sku', e.target.value)} /></Field>
        <Field label="Códigos de leitura" hint="Um por linha (EAN, etiqueta própria…). Zeros à esquerda são preservados."><textarea className="input font-mono" rows={3} value={f.codes} onChange={(e) => set('codes', e.target.value)} /></Field>
        <Field label="Descrição" hint="Aparece para o cliente no cardápio digital." className="sm:col-span-2"><input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="sm:col-span-2"><PhotoField photo={photo} onChange={(url) => setPhoto({ url, changed: true })} onError={setErr} /></div>
        <Field label="Ingredientes/alergênicos (informados pelo estabelecimento)" className="sm:col-span-2"><input className="input" value={f.allergens} onChange={(e) => set('allergens', e.target.value)} /></Field>
        <Toggle checked={f.favorite} onChange={(v) => set('favorite', v)} label="Favorito no PDV" />
        <Toggle checked={f.active} onChange={(v) => set('active', v)} label="Disponível para venda" />
        <Toggle checked={f.channels.includes('cardapio_digital')} onChange={(v) => set('channels', v ? [...new Set([...f.channels, 'delivery', 'cardapio_digital'])] : f.channels.filter((c) => c !== 'cardapio_digital' && c !== 'delivery'))}
          label="Aparece no cardápio digital" hint="Cliente pode pedir pelo celular (entrega ou retirada)." />
      </div>
      <div className="mt-5">
        <div className="flex items-center justify-between"><h3 className="font-display text-2xl">Opções e adicionais</h3>
          <button className="btn-ghost py-1 text-sm" onClick={() => set('groups', [...f.groups, { name: '', min: 0, max: 1, options: [{ name: '', price: '0,00' }] }])}><Plus size={14} /> Grupo</button></div>
        {!f.groups.length && <p className="text-sm text-muted">Sem opções. Ex.: ponto da carne (obrigatório, escolha 1), adicionais (opcional, até 3).</p>}
        {f.groups.map((g, i) => (
          <div key={i} className="mt-2 rounded-lg border border-line p-3">
            <div className="grid grid-cols-[1fr_80px_80px_auto] items-end gap-2">
              <Field label="Grupo"><input className="input" value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} /></Field>
              <Field label="Mínimo"><input className="input" type="number" min={0} value={g.min} onChange={(e) => setGroup(i, { min: e.target.value })} /></Field>
              <Field label="Máximo"><input className="input" type="number" min={1} value={g.max} onChange={(e) => setGroup(i, { max: e.target.value })} /></Field>
              <button className="btn-ghost" aria-label="Remover grupo" onClick={() => set('groups', f.groups.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
            {g.options.map((o, k) => (
              <div key={k} className="mt-2 grid grid-cols-[1fr_110px_auto] gap-2">
                <input className="input" placeholder="Opção" value={o.name} onChange={(e) => setGroup(i, { options: g.options.map((x, z) => (z === k ? { ...x, name: e.target.value } : x)) })} />
                <input className="input" placeholder="+ R$" inputMode="decimal" value={o.price} onChange={(e) => setGroup(i, { options: g.options.map((x, z) => (z === k ? { ...x, price: e.target.value } : x)) })} />
                <button className="btn-ghost" aria-label="Remover opção" onClick={() => setGroup(i, { options: g.options.filter((_, z) => z !== k) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="mt-2 text-sm underline" onClick={() => setGroup(i, { options: [...g.options, { name: '', price: '0,00' }] })}>+ opção</button>
          </div>
        ))}
      </div>
      {history?.length > 0 && (
        <div className="mt-5"><h3 className="font-display text-2xl">Histórico de preço</h3>
          <ul className="text-sm">{history.map((h, i) => <li key={i}>{dateTime(h.created_at)} — {h.old_cents == null ? 'inicial' : money(h.old_cents)} → <b>{money(h.new_cents)}</b> {h.user_name && `(${h.user_name})`}</li>)}</ul></div>
      )}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

// Foto opcional (cardápio digital): reduzida no navegador para até 800 px e ~300 KB antes do envio
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Use uma imagem JPG, PNG ou WebP');
  const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Não foi possível ler a imagem')); r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida')); i.src = src; });
  for (const [max, q] of [[800, 0.82], [640, 0.72], [480, 0.6]]) {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/jpeg', q);
    if (out.length * 0.75 < 290 * 1024) return out;
  }
  throw new Error('Imagem grande demais mesmo reduzida. Tente outra foto.');
}

function PhotoField({ photo, onChange, onError }) {
  const pick = async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { onChange(await shrink(file)); } catch (x) { onError(x); } };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line p-3" data-photo-field>
      {photo.url ? <img src={photo.url} alt="Foto do produto" className="h-20 w-20 rounded-lg object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-raised text-muted"><ImagePlus /></div>}
      <div className="flex-1 text-sm"><div className="font-semibold">Foto (opcional)</div><div className="text-xs text-muted">Aparece no cardápio digital. Foto deitada, com boa luz, fica melhor.</div></div>
      <label className="btn-ghost cursor-pointer"><ImagePlus size={16} /> {photo.url ? 'Trocar' : 'Escolher foto'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={pick} data-photo-input /></label>
      {photo.url && <button type="button" className="btn-ghost text-rust" onClick={() => onChange(null)}><Trash2 size={16} /> Remover</button>}
    </div>
  );
}

function CategoriesModal({ open, cats, onClose, onChanged }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const add = async () => { try { await api('/api/menu/categories', { method: 'POST', body: { name, sort: cats.length } }); setName(''); onChanged(); } catch (e) { setErr(e); } };
  const toggle = async (c) => { try { await api(`/api/menu/categories/${c.id}`, { method: 'PUT', body: { active: !c.active } }); onChanged(); } catch (e) { setErr(e); } };
  return (
    <Modal open={open} onClose={onClose} title="Categorias">
      <div className="flex gap-2"><input className="input" placeholder="Nova categoria" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn-primary" aria-disabled={(!name.trim()) || undefined} data-why={'Digite o nome da categoria'} onClick={add}>Adicionar</button></div>
      <ul className="mt-3 divide-y divide-line">{cats.map((c) => <li key={c.id} className="flex items-center justify-between py-2"><span>{c.name} {c.demo && <Badge tone="warn">Demo</Badge>}</span><button className="text-sm underline" onClick={() => toggle(c)}>{c.active ? 'desativar' : 'ativar'}</button></li>)}</ul>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
