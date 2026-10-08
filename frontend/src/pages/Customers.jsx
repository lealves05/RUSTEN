// Clientes: cadastro com CPF, histórico de consumo, fidelidade (extrato), importação com prévia e exportação.
import { useEffect, useState } from 'react';
import { Cake, Download, Gift, NotebookPen, Plus, Search, Upload, Users } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { money, dateTime, dateBR } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Toggle, useLoad, useToast, useAsk } from '../components/ui.jsx';
import { cpfMask, cpfDigits, cpfValid } from '../components/CustomerPicker.jsx';
import { AccountPanel, OpenAccountsModal } from '../components/Account.jsx';

const KIND = { ganho: 'Ganho', resgate: 'Resgate', estorno: 'Estorno', expiracao: 'Vencidos', ajuste: 'Ajuste' };

export default function Customers() {
  const s = useSession();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [bday, setBday] = useState(false);
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);
  const [modal, setModal] = useState(null);
  const toast = useToast();
  useEffect(() => { const t = setTimeout(() => { setQuery(term); setPage(0); }, 300); return () => clearTimeout(t); }, [term]);
  const list = useLoad(() => api(`/api/customers?q=${encodeURIComponent(query)}&tag=${encodeURIComponent(tag)}${bday ? '&birthday=mes' : ''}&limit=50&offset=${page * 50}`), [query, tag, bday, page]);
  const sum = useLoad(() => api('/api/customers/summary'), []);
  const manage = s.can('clientes.gerenciar');
  return (
    <div>
      <PageHeader title="Clientes" subtitle="Cadastro, histórico, fidelidade e consentimentos. O CPF identifica o cliente ao abrir a comanda."
        actions={<>
          {manage && <button className="btn-primary" onClick={() => setEdit({})}><Plus size={16} /> Novo cliente</button>}
          {manage && s.can('dados.pessoais') && s.hasModule('importacao_planilhas') && <button className="btn-ghost" onClick={() => setModal('import')}><Upload size={16} /> Importar</button>}
          {manage && s.hasModule('importacao_planilhas') && <button className="btn-ghost" onClick={() => download('/api/customers/export/csv', 'clientes.csv').catch((e) => toast(e.message, 'bad'))}><Download size={16} /> Exportar</button>}
          {manage && s.can('configuracoes.gerenciar') && <button className="btn-ghost" onClick={() => setModal('loyalty')}><Gift size={16} /> Fidelidade</button>}
          <button className="btn-ghost" onClick={() => setModal('accounts')} data-open-accounts><NotebookPen size={16} /> Fiado e créditos</button>
        </>} />
      {sum.data && (
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Clientes" value={sum.data.total} />
          <Stat label="Aniversariantes do mês" value={sum.data.birthdays} />
          <Stat label="Aceitam WhatsApp" value={sum.data.whatsapp_ok} />
          <Stat label="Fidelidade" value={sum.data.loyalty.enabled ? `${sum.data.points} pts em aberto` : 'desligada'} />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Nome, CPF ou telefone" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar cliente" /></div>
        <select className="input w-auto" value={tag} onChange={(e) => { setTag(e.target.value); setPage(0); }} aria-label="Etiqueta">
          <option value="">Todas as etiquetas</option>{sum.data?.tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.n})</option>)}
        </select>
        <button className={`btn-ghost ${bday ? 'border-copper bg-copper/15' : ''}`} onClick={() => { setBday(!bday); setPage(0); }}><Cake size={16} /> Aniversariantes</button>
      </div>
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data.items.length ? (
        <Empty icon={Users} title="Nenhum cliente">{query ? 'Nada encontrado para a busca.' : 'Cadastre clientes aqui ou direto no PDV, pelo CPF, ao abrir a comanda.'}</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-clean">
            <thead><tr><th>Nome</th><th>CPF</th><th>Telefone</th><th className="text-right">Visitas</th><th className="text-right">Gasto</th><th className="text-right">Pontos</th><th>Contato</th></tr></thead>
            <tbody>{list.data.items.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-raised" onClick={() => setView(c.id)}>
                <td className="font-semibold">{c.name}{c.tags?.map((t) => <span key={t} className="chip ml-1 border-line text-[10px]">{t}</span>)}</td>
                <td className="font-mono text-xs">{c.cpf || '—'}</td><td>{c.phone || '—'}</td>
                <td className="text-right">{c.visits}</td><td className="text-right">{money(c.spent_cents)}</td><td className="text-right">{c.points}</td>
                <td>{c.unsubscribed ? <Badge tone="muted">descadastrado</Badge> : c.consent_whatsapp ? <Badge tone="ok">WhatsApp</Badge> : <span className="text-xs text-muted">sem consentimento</span>}</td>
              </tr>
            ))}</tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line p-2 text-sm">
            <span className="text-muted">{list.data.total} cliente(s)</span>
            <div className="flex gap-2"><button className="btn-ghost py-1" disabled={!page} onClick={() => setPage(page - 1)}>Anterior</button>
              <button className="btn-ghost py-1" disabled={(page + 1) * 50 >= list.data.total} onClick={() => setPage(page + 1)}>Próxima</button></div>
          </div>
        </div>
      )}
      <CustomerModal data={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); sum.reload(); toast('Cliente salvo'); }} />
      <CustomerView id={view} onClose={() => setView(null)} onEdit={(c) => { setView(null); setEdit(c); }} onChanged={() => { list.reload(); sum.reload(); }} />
      <OpenAccountsModal open={modal === 'accounts'} onClose={() => setModal(null)} onPick={(cid) => { setModal(null); setView(cid); }} />
      <ImportModal open={modal === 'import'} onClose={() => setModal(null)} onDone={() => { list.reload(); sum.reload(); }} />
      <LoyaltyModal open={modal === 'loyalty'} cfg={sum.data?.loyalty} onClose={() => setModal(null)} onDone={() => { sum.reload(); toast('Fidelidade atualizada'); }} />
    </div>
  );
}

const Stat = ({ label, value }) => <div className="card p-3"><div className="text-xs uppercase text-muted">{label}</div><div className="font-display text-2xl">{value}</div></div>;

function CustomerModal({ data, onClose, onSaved }) {
  const s = useSession();
  const [f, setF] = useState({});
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!data) return;
    setErr(null);
    setF({ name: data.name || '', cpf: data.cpf && !data.masked ? cpfDigits(data.cpf) : '', phone: data.masked ? '' : data.phone || '', email: data.masked ? '' : data.email || '',
      birthday: data.birthday || '', tags: (data.tags || []).join(', '), preferences: data.preferences || '', notes: data.notes || '',
      consent_whatsapp: !!data.consent_whatsapp, consent_email: !!data.consent_email, street: data.address?.street || '', number: data.address?.number || '', district: data.address?.district || '' });
  }, [data]);
  if (!data) return null;
  const personal = s.can('dados.pessoais') || !data.id;
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e });
  const save = async () => {
    try {
      if (f.cpf && !cpfValid(f.cpf)) throw new Error('CPF inválido');
      const body = { name: f.name, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), preferences: f.preferences || null, notes: f.notes || null,
        consent_whatsapp: f.consent_whatsapp, consent_email: f.consent_email };
      if (personal) Object.assign(body, { cpf: f.cpf || null, phone: f.phone || null, email: f.email || '', birthday: f.birthday || '', address: { street: f.street, number: f.number, district: f.district } });
      await api(data.id ? `/api/customers/${data.id}` : '/api/customers', { method: data.id ? 'PUT' : 'POST', body });
      onSaved();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open wide onClose={onClose} title={data.id ? 'Editar cliente' : 'Novo cliente'} footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" className="sm:col-span-2"><input className="input" value={f.name} onChange={set('name')} /></Field>
        {personal ? <>
          <Field label="CPF"><input className="input" inputMode="numeric" value={cpfMask(f.cpf)} onChange={(e) => setF({ ...f, cpf: cpfDigits(e.target.value) })} /></Field>
          <Field label="Celular (com DDD)"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field label="E-mail"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field label="Aniversário"><input className="input" type="date" value={f.birthday} onChange={set('birthday')} /></Field>
          <Field label="Rua"><input className="input" value={f.street} onChange={set('street')} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Número"><input className="input" value={f.number} onChange={set('number')} /></Field><Field label="Bairro"><input className="input" value={f.district} onChange={set('district')} /></Field></div>
        </> : <p className="text-sm text-muted sm:col-span-2">Dados pessoais protegidos: seu perfil não pode ver nem alterar CPF, telefone, e-mail e endereço.</p>}
        <Field label="Etiquetas (separadas por vírgula)" hint="Ex.: vip, chope, aniversário"><input className="input" value={f.tags} onChange={set('tags')} /></Field>
        <Field label="Preferências"><input className="input" value={f.preferences} onChange={set('preferences')} placeholder="Ex.: mesa na varanda, sem cebola" /></Field>
        <Field label="Observações" className="sm:col-span-2"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        <div className="sm:col-span-2 rounded-lg border border-line p-2">
          <div className="label px-2">Consentimentos (registrados com data)</div>
          <Toggle checked={!!f.consent_whatsapp} onChange={(v) => setF({ ...f, consent_whatsapp: v })} label="Aceita receber mensagens por WhatsApp" />
          <Toggle checked={!!f.consent_email} onChange={(v) => setF({ ...f, consent_email: v })} label="Aceita receber e-mails" />
        </div>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function CustomerView({ id, onClose, onEdit, onChanged }) {
  const ask = useAsk();
  const s = useSession();
  const toast = useToast();
  const d = useLoad(() => (id ? api(`/api/customers/${id}`) : Promise.resolve(null)), [id]);
  if (!id) return null;
  const adjust = async () => {
    const v = await ask.value({ title: 'Ajustar pontos', label: 'Pontos', message: 'Número positivo credita; negativo (ex.: -20) debita.', inputMode: 'numeric', placeholder: 'ex.: 20 ou -20',
      validate: (t) => (Number.isInteger(Number(t)) && Number(t) !== 0 ? null : 'Informe um número inteiro diferente de zero') }); if (!v) return;
    const pts = Number(v);
    const reason = await ask.reason({ title: 'Motivo do ajuste de pontos', reasons: ['Compra anterior ao cadastro', 'Correção', 'Cortesia'] }); if (!reason) return;
    try { await api(`/api/customers/${id}/points`, { method: 'POST', body: { points: pts, reason } }); d.reload(); onChanged(); } catch (e) { toast(e.message, 'bad'); }
  };
  const anonymize = async () => {
    const reason = await ask.reason({ title: 'Anonimizar cliente', danger: true, confirmLabel: 'Anonimizar', message: 'Remove nome, CPF, contatos e endereço. Consumos e pagamentos são preservados.', reasons: ['Pedido do titular (LGPD)', 'Cadastro duplicado'] }); if (!reason) return;
    try { await api(`/api/customers/${id}/anonymize`, { method: 'POST', body: { reason } }); onClose(); onChanged(); toast('Cliente anonimizado'); } catch (e) { toast(e.message, 'bad'); }
  };
  const c = d.data?.customer;
  return (
    <Modal open wide onClose={onClose} title={c?.name || 'Cliente'}
      footer={c && <>{s.can('clientes.gerenciar') && s.can('dados.pessoais') && s.can('pdv.autorizar') && <button className="btn-ghost mr-auto text-rust" onClick={anonymize}>Anonimizar</button>}
        {s.can('clientes.gerenciar') && s.can('pdv.autorizar') && <button className="btn-ghost" onClick={adjust}>Ajustar pontos</button>}
        {s.can('clientes.gerenciar') && <button className="btn-primary" onClick={() => onEdit(c)}>Editar</button>}</>}>
      {d.error ? <ErrorBox error={d.error} /> : d.loading || !c ? <Loading /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Visitas" value={c.visits} /><Stat label="Gasto" value={money(c.spent_cents)} /><Stat label="Ticket médio" value={money(d.data.ticket_cents)} /><Stat label="Pontos" value={c.points} />
          </div>
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            <div>CPF: <b>{c.cpf || '—'}</b></div><div>Telefone: <b>{c.phone || '—'}</b></div><div>E-mail: <b>{c.email || '—'}</b></div>
            <div>Aniversário: <b>{c.birthday ? dateBR(c.birthday) : '—'}</b></div>
            {c.preferences && <div className="sm:col-span-2">Preferências: {c.preferences}</div>}
            <div className="sm:col-span-2">Contato: {c.unsubscribed ? 'descadastrado de campanhas' : [c.consent_whatsapp && 'WhatsApp', c.consent_email && 'e-mail'].filter(Boolean).join(' e ') || 'sem consentimento'}</div>
          </div>
          {s.hasModule('conta_cliente') && <section><h3 className="font-display text-xl">Conta: crédito e fiado</h3>
            <AccountPanel customerId={id} customerName={c.name} onChanged={onChanged} />
          </section>}
          <section><h3 className="font-display text-xl">Histórico de consumo</h3>
            {!d.data.history.length ? <p className="text-sm text-muted">Sem consumos identificados.</p> : (
              <table className="table-clean"><tbody>{d.data.history.map((h) => (
                <tr key={h.id}><td>{dateTime(h.opened_at, s.tz)}</td><td className="text-xs text-muted">{h.items}</td><td>{h.status}</td><td className="text-right">{money(h.items_cents)}</td></tr>
              ))}</tbody></table>)}
          </section>
          <section><h3 className="font-display text-xl">Extrato de pontos</h3>
            {!d.data.ledger.length ? <p className="text-sm text-muted">Sem movimentação.</p> : (
              <table className="table-clean"><tbody>{d.data.ledger.map((l) => (
                <tr key={l.id}><td>{dateTime(l.created_at, s.tz)}</td><td>{KIND[l.kind]}</td><td className="text-xs text-muted">{l.reason}{l.expires_at ? ` · vence ${dateBR(l.expires_at)}` : ''}</td>
                  <td className={`text-right font-semibold ${l.points < 0 ? 'text-rust' : 'text-ok'}`}>{l.points > 0 ? '+' : ''}{l.points}</td></tr>
              ))}</tbody></table>)}
          </section>
          {!!d.data.reviews.length && <section><h3 className="font-display text-xl">Avaliações</h3>
            {d.data.reviews.map((r) => <div key={r.id} className="text-sm">{'★'.repeat(r.score)}{'☆'.repeat(5 - r.score)} {r.comment && `— ${r.comment}`}</div>)}</section>}
        </div>
      )}
    </Modal>
  );
}

// CSV → linhas na posição do arquivo (linha vazia = [])
function csvRows(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const first = lines.find((l) => l.trim()) || '';
  const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const split = (l) => { const out = []; let cur = ''; let qd = false; for (const ch of l) { if (ch === '"') qd = !qd; else if (ch === sep && !qd) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  return lines.map((l) => (l.trim() ? split(l) : []));
}

// colunas que o servidor entende (o resto da planilha — endereço, pedidos… — não sai do navegador)
const IMPORT_COLS = new Set(['nome', 'name', 'cliente', 'nome do cliente', 'nome completo', 'razao social', 'razão social', 'cpf', 'documento', 'cpf ou cnpj', 'cpf/cnpj', 'cnpj',
  'telefone', 'celular', 'whatsapp', 'phone', 'telefone principal', 'fone', 'telefone 1', 'email', 'e-mail', 'e mail', 'aniversario', 'aniversário', 'nascimento', 'data de nascimento', 'birthday']);
function toImportRows(grid) {
  const h = grid.findIndex((r) => r.some((c) => String(c).trim()));
  if (h < 0) return [];
  const head = grid[h].map((x) => String(x).trim().toLowerCase());
  if (!head.some((x) => ['nome', 'name', 'cliente', 'nome do cliente', 'nome completo'].includes(x))) throw new Error('Não achei a coluna "nome" na primeira linha da planilha.');
  const out = [];
  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i];
    if (!r.some((c) => String(c).trim())) continue;
    const o = { _line: i + 1 };
    head.forEach((k, j) => { if (IMPORT_COLS.has(k) && r[j] != null && String(r[j]).trim() && o[k] == null) o[k] = String(r[j]).trim(); });
    out.push(o);
  }
  return out;
}

const ST = { ok: ['Novo', 'ok'], aviso: ['Novo (com aviso)', 'warn'], repetido: ['Repetido na planilha', 'muted'], duplicado: ['Já cadastrado', 'muted'], erro: ['Erro', 'bad'] };

function ImportModal({ open, onClose, onDone }) {
  const [rows, setRows] = useState(null);
  const [file, setFile] = useState('');
  const [preview, setPreview] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [filter, setFilter] = useState('importar');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const toast = useToast();
  useEffect(() => { if (open) { setRows(null); setPreview(null); setErr(null); setFile(''); setSel(new Set()); setFilter('importar'); setQ(''); } }, [open]);
  const onFile = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setErr(null); setPreview(null); setRows(null); setFile(f.name); setBusy(true);
    try {
      let grid;
      if (/\.xlsx$/i.test(f.name)) grid = await (await import('../lib/xlsx.js')).readXlsx(await f.arrayBuffer());
      else if (/\.xls$/i.test(f.name)) throw new Error('Arquivo .xls antigo: abra no Excel e salve como .xlsx ou CSV.');
      else grid = csvRows(await f.text());
      const r = toImportRows(grid);
      if (!r.length) throw new Error('Nenhuma linha com dados abaixo do cabeçalho.');
      if (r.length > 5000) throw new Error('Máximo de 5.000 clientes por importação: divida a planilha.');
      const p = await api('/api/customers/import', { method: 'POST', body: { rows: r, dry_run: true } });
      setRows(r); setPreview(p);
      setSel(new Set(p.report.filter((x) => x.status === 'ok' || x.status === 'aviso').map((x) => x.line)));
    } catch (x) { setErr(x); } finally { setBusy(false); e.target.value = ''; }
  };
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/customers/import', { method: 'POST', body: { rows: rows.filter((x) => sel.has(x._line)), dry_run: false } });
      toast(`${r.valid} cliente(s) importado(s)`); onDone(); onClose();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  const can = (r) => r.status === 'ok' || r.status === 'aviso';
  const list = preview ? preview.report.filter((r) => (filter === 'todos' || (filter === 'importar' ? can(r) : r.status === filter))
    && (!q || `${r.name} ${r.cpf || ''} ${r.phone || ''}`.toLowerCase().includes(q.toLowerCase()))) : [];
  const toggle = (line) => setSel((s) => { const n = new Set(s); if (n.has(line)) n.delete(line); else n.add(line); return n; });
  const setAll = (on) => setSel((s) => { const n = new Set(s); list.filter(can).forEach((r) => (on ? n.add(r.line) : n.delete(r.line))); return n; });
  const sm = preview?.summary;
  return (
    <Modal open={open} wide onClose={onClose} title="Importar clientes" footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button>
      <button className="btn-primary" aria-disabled={(!sel.size || busy) || undefined} data-why="Escolha o arquivo e marque os clientes que vão entrar" onClick={() => sel.size && !busy && go()}>Importar {sel.size}</button></>}>
      <p className="text-sm text-muted">Planilha do Excel (<b>.xlsx</b>) ou CSV com as colunas <b>nome</b>, <b>cpf</b>, <b>telefone</b>, <b>email</b>, <b>aniversario</b> (outros nomes comuns, como "CPF ou CNPJ" e "Telefone Principal", também valem).
        Clientes repetidos na planilha ou já cadastrados (mesmo CPF, telefone ou, sem os dois, mesmo nome) ficam de fora. Importar não registra consentimento de marketing.</p>
      <label className="btn-ghost mt-3 inline-flex cursor-pointer"><Upload size={16} /> {file ? 'Trocar arquivo' : 'Escolher arquivo'}
        <input type="file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={onFile} data-import-file /></label>
      {file && <span className="ml-2 text-sm">{file}</span>}
      {busy && !preview && <p className="mt-2 text-sm text-muted">Lendo a planilha…</p>}
      {preview && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2 text-sm" data-import-summary>
            <Badge tone="ok">{sm.ok + sm.aviso} novos</Badge>
            {sm.aviso > 0 && <Badge tone="warn">{sm.aviso} com aviso</Badge>}
            {sm.repetido > 0 && <Badge tone="muted">{sm.repetido} repetidos na planilha (excluídos)</Badge>}
            {sm.duplicado > 0 && <Badge tone="muted">{sm.duplicado} já cadastrados (excluídos)</Badge>}
            {sm.erro > 0 && <Badge tone="bad">{sm.erro} com erro</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input max-w-[220px] py-1" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Mostrar">
              <option value="importar">Novos (podem entrar)</option><option value="todos">Todas as linhas</option><option value="aviso">Com aviso</option>
              <option value="repetido">Repetidos na planilha</option><option value="duplicado">Já cadastrados</option><option value="erro">Com erro</option>
            </select>
            <input className="input max-w-[220px] py-1" placeholder="Buscar nome, CPF ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
            {list.some(can) && <><button className="text-sm underline" onClick={() => setAll(true)}>marcar todos</button><button className="text-sm underline" onClick={() => setAll(false)}>desmarcar todos</button></>}
            <span className="ml-auto text-sm"><b>{sel.size}</b> marcado(s)</span>
          </div>
          <div className="max-h-[50vh] overflow-auto">
            {!list.length ? <p className="py-3 text-sm text-muted">Nada nesta lista.</p> : (
              <table className="table-clean">
                <thead><tr><th /><th>Linha</th><th>Nome</th><th>CPF</th><th>Telefone</th><th>Situação</th></tr></thead>
                <tbody>{list.map((r) => (
                  <tr key={r.line} className={can(r) && !sel.has(r.line) ? 'opacity-50' : ''}>
                    <td>{can(r) && <input type="checkbox" aria-label={`Importar ${r.name}`} checked={sel.has(r.line)} onChange={() => toggle(r.line)} />}</td>
                    <td>{r.line}</td><td className="font-semibold">{r.name || '—'}</td><td className="whitespace-nowrap font-mono text-xs">{r.cpf || '—'}</td><td className="whitespace-nowrap">{r.phone || '—'}</td>
                    <td><Badge tone={ST[r.status][1]}>{ST[r.status][0]}</Badge>{r.message && <div className="text-xs text-muted">{r.message}</div>}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function LoyaltyModal({ open, cfg, onClose, onDone }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open && cfg) { setF({ ...cfg, real_per_point: String(cfg.cents_per_point / 100).replace('.', ','), value: String(cfg.point_value_cents / 100).replace('.', ',') }); setErr(null); } }, [open, cfg]);
  if (!open || !f) return null;
  const cents = (v) => Math.round(Number(String(v).replace(',', '.')) * 100);
  const save = async () => {
    try {
      await api('/api/customers/loyalty', { method: 'PUT', body: { enabled: f.enabled, cents_per_point: cents(f.real_per_point), point_value_cents: cents(f.value), validity_days: Number(f.validity_days), min_redeem: Number(f.min_redeem) } });
      onDone(); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open onClose={onClose} title="Programa de fidelidade" footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <Toggle checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label="Fidelidade ligada" hint="Clientes identificados acumulam pontos ao encerrar o consumo." />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="R$ gastos para 1 ponto"><input className="input" inputMode="decimal" value={f.real_per_point} onChange={(e) => setF({ ...f, real_per_point: e.target.value })} /></Field>
        <Field label="Valor de 1 ponto no resgate (R$)"><input className="input" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="Validade (dias)"><input className="input" inputMode="numeric" value={f.validity_days} onChange={(e) => setF({ ...f, validity_days: e.target.value })} /></Field>
        <Field label="Resgate mínimo (pontos)"><input className="input" inputMode="numeric" value={f.min_redeem} onChange={(e) => setF({ ...f, min_redeem: e.target.value })} /></Field>
      </div>
      <p className="mt-2 text-xs text-muted">Pontos contam sobre o consumo (sem taxa de serviço). Reabrir um consumo estorna os pontos ganhos; estornar um pagamento com pontos devolve os pontos.</p>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
