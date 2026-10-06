// Configurações: empresa/aparência, PDV (leitura e lançamento), usuários, perfis, unidades/terminais, assinatura e auditoria.
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, terminal, download } from '../lib/api.js';
import { dateTime, bp } from '../lib/format.js';
import { useSession, applyTheme } from '../lib/session.jsx';
import Subscription from './Subscription.jsx';
import { InfinitePaySettings } from '../components/InfinitePay.jsx';
import NoteIntegrations from '../components/NoteIntegrations.jsx';
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader, Toggle, useLoad, useToast, useAsk } from '../components/ui.jsx';

export default function Settings() {
  const s = useSession();
  const tabs = [
    ['empresa', 'Empresa e aparência', true],
    ['pdv', 'PDV › Leitura e lançamento', true],
    ['usuarios', 'Usuários', s.can('usuarios.gerenciar')],
    ['perfis', 'Perfis e permissões', s.can('usuarios.gerenciar')],
    ['unidades', 'Unidades e terminais', true],
    ['integracoes', 'Integrações', s.can('configuracoes.gerenciar')],
    ['assinatura', 'Assinatura', true],
    ['auditoria', 'Auditoria', s.can('auditoria.visualizar')],
  ].filter((t) => t[2]);
  return (
    <div>
      <PageHeader title="Configurações" />
      <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Seções">
          {tabs.map(([k, l]) => <NavLink key={k} to={`/configuracoes/${k}`} className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'bg-copper text-white dark:text-black' : 'hover:bg-raised'}`}>{l}</NavLink>)}
        </nav>
        <div className="min-w-0">
          <Routes>
            <Route index element={<Navigate to="empresa" replace />} />
            <Route path="empresa" element={<Company />} />
            <Route path="pdv" element={<PdvSettings />} />
            <Route path="usuarios" element={<Users />} />
            <Route path="perfis" element={<Roles />} />
            <Route path="unidades" element={<Units />} />
            <Route path="integracoes" element={<div className="space-y-6"><InfinitePaySettings /><NoteIntegrations /></div>} />
            <Route path="assinatura" element={<Subscription />} />
            <Route path="auditoria" element={<Audit />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function Company() {
  const ask = useAsk();
  const s = useSession();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => api('/api/admin/settings'));
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (data) setF({ name: data.name, segment: data.segment, document: data.document || '', phone: data.phone || '', email: data.email || '', timezone: data.timezone, appearance: { theme: 'auto', density: 'confortavel', menu: 'lateral', ...(data.settings?.appearance || {}) } }); }, [data]);
  if (loading || !f) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const manage = s.can('configuracoes.gerenciar');
  const save = async () => {
    try { await api('/api/admin/settings', { method: 'PUT', body: { ...f, document: f.document || null, phone: f.phone || null, email: f.email || null } }); applyTheme(f.appearance.theme); toast('Configurações salvas'); s.reload(); }
    catch (e) { setErr(e); }
  };
  const removeDemo = async () => {
    if (!await ask.confirm({ title: 'Remover demonstração', message: 'Remover o cardápio de demonstração? Produtos já vendidos serão apenas desativados.', confirmLabel: 'Remover', danger: true })) return;
    try { const r = await api('/api/menu/demo', { method: 'DELETE' }); toast(`${r.removed} removidos, ${r.deactivated} desativados`); } catch (e) { setErr(e); }
  };
  const ap = (k, v) => setF({ ...f, appearance: { ...f.appearance, [k]: v } });
  return (
    <div className="card space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome"><input className="input" disabled={!manage} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="CPF/CNPJ"><input className="input" disabled={!manage} value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></Field>
        <Field label="Telefone"><input className="input" disabled={!manage} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="E-mail"><input className="input" disabled={!manage} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Fuso horário"><select className="input" disabled={!manage} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
          {['America/Sao_Paulo', 'America/Manaus', 'America/Cuiaba', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Porto_Velho', 'America/Rio_Branco', 'America/Noronha'].map((z) => <option key={z}>{z}</option>)}</select></Field>
      </div>
      <h3 className="font-display text-2xl">Aparência</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tema"><select className="input" value={f.appearance.theme} onChange={(e) => { ap('theme', e.target.value); applyTheme(e.target.value); }}><option value="auto">Automático</option><option value="claro">Claro</option><option value="escuro">Escuro</option></select></Field>
        <Field label="Densidade"><select className="input" value={f.appearance.density} onChange={(e) => ap('density', e.target.value)}><option value="confortavel">Confortável</option><option value="compacta">Compacta</option></select></Field>
        <Field label="Menu"><select className="input" value={f.appearance.menu} onChange={(e) => ap('menu', e.target.value)}><option value="lateral">Lateral</option><option value="superior">Superior</option></select></Field>
      </div>
      <ErrorBox error={err} />
      <div className="flex flex-wrap gap-2">
        {manage && <button className="btn-primary" onClick={save}>Salvar</button>}
        {manage && <button className="btn-ghost" onClick={removeDemo}>Remover dados de demonstração</button>}
      </div>
    </div>
  );
}

const PDV_FIELDS = [
  ['scanner_enabled', 'Habilitar leitor', 'Processa leituras no PDV. Desligado, o PDV opera só manualmente.'],
  ['double_read_mandatory', 'Dupla leitura obrigatória', 'Cada item exige COMANDA → PRODUTO; lançar manualmente só por exceção autorizada.'],
  ['allow_manual', 'Permitir lançamento manual', 'Busca, catálogo e código digitado.'],
  ['allow_manual_exception', 'Permitir exceção manual na dupla leitura', 'Somente para quem tem a permissão de exceção.'],
  ['exception_requires_manager', 'Exceção exige autorização do gerente', 'Autorização individual, uso único, válida por 2 minutos.'],
  ['allow_mode_change', 'Permitir operador trocar o modo', 'Ainda depende da permissão "Trocar modo de leitura".'],
  ['open_free_card_on_scan', 'Abrir comanda livre ao ler', 'Desligado por padrão; exige permissão de abrir comanda.'],
  ['feedback_sound', 'Sinal sonoro', 'A mensagem visual aparece sempre.'],
  ['require_open_cash', 'Exigir caixa aberto para receber', ''],
];

function PdvSettings() {
  const s = useSession();
  const toast = useToast();
  const [level, setLevel] = useState('company');
  const units = useLoad(() => api('/api/admin/units'));
  const terms = useLoad(() => api('/api/admin/terminals'));
  const [target, setTarget] = useState('');
  const q = level === 'unit' ? `?unit_id=${target}` : level === 'terminal' ? `?terminal_id=${target}` : '';
  const cfg = useLoad(() => (level !== 'company' && !target ? Promise.resolve(null) : api(`/api/admin/pdv-settings${q}`)), [level, target]);
  const [draft, setDraft] = useState({});
  const [err, setErr] = useState(null);
  useEffect(() => { if (cfg.data) setDraft(cfg.data[level] || {}); }, [cfg.data, level]);
  const manage = s.can('configuracoes.gerenciar');
  const eff = cfg.data?.effective;
  const val = (k) => (k in draft ? draft[k] : undefined);
  const save = async () => {
    setErr(null);
    try { await api(`/api/admin/pdv-settings/${level}`, { method: 'PUT', body: { id: Number(target) || undefined, settings: draft } }); toast('Configuração do PDV salva'); cfg.reload(); s.reload(); }
    catch (e) { setErr(e); }
  };
  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm">
        <b>Precedência:</b> terminal → unidade → empresa. Um nível mais específico pode <b>restringir</b>, mas nunca liberar o que um nível superior negou.
        Não é possível desligar ao mesmo tempo o leitor e o lançamento manual.
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Nível"><select className="input" value={level} onChange={(e) => { setLevel(e.target.value); setTarget(''); }}><option value="company">Empresa</option><option value="unit">Unidade</option><option value="terminal">Terminal</option></select></Field>
        {level === 'unit' && <Field label="Unidade"><select className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Escolha…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
        {level === 'terminal' && <Field label="Terminal"><select className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Escolha…</option>{terms.data?.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === terminal.id ? ' (este)' : ''}</option>)}</select></Field>}
      </div>
      {cfg.loading ? <Loading /> : !cfg.data ? <p className="text-sm text-muted">Escolha o item para configurar.</p> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <div className="card p-4">
            <Field label="Modo padrão" hint={level !== 'company' ? 'Vazio = herda do nível acima' : ''}>
              <select className="input" disabled={!manage} value={val('mode') ?? ''} onChange={(e) => setDraft({ ...draft, mode: e.target.value || undefined })}>
                {level !== 'company' && <option value="">Herdar</option>}
                <option value="manual">Manual</option><option value="continua">Leitura contínua</option><option value="dupla">Dupla leitura</option>
              </select>
            </Field>
            <div className="mt-3 divide-y divide-line">
              {PDV_FIELDS.map(([k, l, h]) => (
                <div key={k} className="flex items-center gap-2">
                  <div className="flex-1"><Toggle disabled={!manage} checked={val(k) ?? eff[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} label={l} hint={h} /></div>
                  {level !== 'company' && k in draft && <button className="text-xs underline" onClick={() => { const d = { ...draft }; delete d[k]; setDraft(d); }}>herdar</button>}
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Tempo de espera do produto (s)"><input className="input" type="number" min={3} max={120} disabled={!manage} value={val('product_timeout_s') ?? eff.product_timeout_s} onChange={(e) => setDraft({ ...draft, product_timeout_s: Number(e.target.value) })} /></Field>
              <Field label="Quantidade por leitura"><input className="input" type="number" min={1} max={100} disabled={!manage} value={val('qty_per_scan') ?? eff.qty_per_scan} onChange={(e) => setDraft({ ...draft, qty_per_scan: Number(e.target.value) })} /></Field>
              <Field label="Limite de quantidade na leitura"><input className="input" type="number" min={1} max={100} disabled={!manage} value={val('max_qty_per_scan') ?? eff.max_qty_per_scan} onChange={(e) => setDraft({ ...draft, max_qty_per_scan: Number(e.target.value) })} /></Field>
              <Field label="Terminador do leitor"><select className="input" disabled={!manage} value={val('terminator') ?? eff.terminator} onChange={(e) => setDraft({ ...draft, terminator: e.target.value })}><option>Enter</option><option>Tab</option></select></Field>
              <Field label="Taxa de serviço (%)"><input className="input" inputMode="decimal" disabled={!manage} value={(val('service_fee_bp') ?? eff.service_fee_bp) / 100} onChange={(e) => setDraft({ ...draft, service_fee_bp: Math.round(Number(e.target.value.replace(',', '.')) * 100) || 0 })} /></Field>
              {level === 'company' && <Field label="Prefixo dos cartões"><input className="input font-mono" disabled={!manage} value={val('card_prefix') ?? eff.card_prefix} onChange={(e) => setDraft({ ...draft, card_prefix: e.target.value.toUpperCase() })} /></Field>}
            </div>
            <div className="mt-3"><ErrorBox error={err} /></div>
            {manage && <button className="btn-primary mt-3" onClick={save}>Salvar</button>}
          </div>
          <aside className="card h-fit p-4 text-sm">
            <h3 className="font-display text-xl">Resultado efetivo</h3>
            <ul className="mt-2 space-y-1">
              <li>Modo: <b>{({ manual: 'Manual', continua: 'Leitura contínua', dupla: 'Dupla leitura' })[eff.mode]}</b></li>
              {PDV_FIELDS.map(([k, l]) => <li key={k}>{eff[k] ? <Badge tone="ok">Sim</Badge> : <Badge tone="muted">Não</Badge>} {l}</li>)}
              <li>Espera: {eff.product_timeout_s}s · Qtd/leitura: {eff.qty_per_scan}</li>
              <li>Taxa de serviço: {bp(eff.service_fee_bp)}</li>
            </ul>
            <h3 className="mt-4 font-display text-xl">Testar o leitor</h3>
            <p className="text-muted">Com o PDV aberto, leia uma comanda e um produto: a barra superior mostra cada leitura. Leitores USB/Bluetooth devem estar em modo teclado com o terminador escolhido.</p>
          </aside>
        </div>
      )}
    </div>
  );
}

function Users() {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => api('/api/admin/users'));
  const roles = useLoad(() => api('/api/admin/roles'));
  const units = useLoad(() => api('/api/admin/units'));
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState(null);
  if (loading || roles.loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const save = async () => {
    setErr(null);
    try {
      const body = { name: edit.name, email: edit.email, role_key: edit.role_key, unit_id: edit.unit_id ? Number(edit.unit_id) : null, active: edit.active };
      if (edit.password) body.password = edit.password;
      await api(edit.id ? `/api/admin/users/${edit.id}` : '/api/admin/users', { method: edit.id ? 'PUT' : 'POST', body });
      toast('Usuário salvo'); setEdit(null); reload();
    } catch (e) { setErr(e); }
  };
  return (
    <div>
      <div className="mb-3 flex justify-end"><button className="btn-primary" onClick={() => setEdit({ name: '', email: '', role_key: 'garcom', active: true, password: '' })}>Novo usuário</button></div>
      <div className="card overflow-x-auto"><table className="table-clean">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Unidade</th><th>Situação</th></tr></thead>
        <tbody>{data.map((u) => (
          <tr key={u.id} className="cursor-pointer hover:bg-raised" onClick={() => setEdit({ ...u, password: '' })}>
            <td className="font-semibold">{u.name}</td><td>{u.email}</td><td>{u.role_name}</td><td>{units.data?.find((x) => x.id === u.unit_id)?.name || 'Todas'}</td>
            <td>{!u.active ? <Badge tone="muted">Inativo</Badge> : u.locked ? <Badge tone="bad">Bloqueado</Badge> : <Badge tone="ok">Ativo</Badge>}</td>
          </tr>))}</tbody></table></div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar usuário' : 'Novo usuário'} footer={<><button className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
        {edit && <div className="grid gap-3">
          <Field label="Nome"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="E-mail (login)"><input className="input" type="email" autoComplete="off" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Perfil"><select className="input" value={edit.role_key} onChange={(e) => setEdit({ ...edit, role_key: e.target.value })}>{roles.data.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></Field>
          <Field label="Unidade"><select className="input" value={edit.unit_id || ''} onChange={(e) => setEdit({ ...edit, unit_id: e.target.value })}><option value="">Todas</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <Field label={edit.id ? 'Nova senha (opcional)' : 'Senha inicial'} hint="10+ caracteres, letras e números. Trocar a senha encerra as sessões do usuário."><input className="input" type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
          {edit.id && <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Ativo" />}
          <ErrorBox error={err} />
        </div>}
      </Modal>
    </div>
  );
}

function Roles() {
  const s = useSession();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => api('/api/admin/roles'));
  const [sel, setSel] = useState(null);
  const [perms, setPerms] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => { if (sel) setPerms(sel.permissions); }, [sel]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const myLevel = s.me.user.level;
  const groups = Object.entries(data.catalog).reduce((acc, [k, l]) => { const g = k.split('.')[0]; (acc[g] ||= []).push([k, l]); return acc; }, {});
  const save = async () => { setErr(null); try { await api(`/api/admin/roles/${sel.key}`, { method: 'PUT', body: { permissions: perms } }); toast('Perfil salvo'); setSel(null); reload(); } catch (e) { setErr(e); } };
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <ul className="card divide-y divide-line">
        {data.roles.map((r) => (
          <li key={r.key}><button className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-raised ${sel?.key === r.key ? 'bg-raised' : ''}`} onClick={() => setSel(r)}>
            <span className="font-semibold">{r.name}</span><span className="text-xs text-muted">nível {r.level}</span></button></li>
        ))}
      </ul>
      {!sel ? <p className="text-sm text-muted">Escolha um perfil. Você só altera perfis abaixo do seu nível e só concede permissões que possui.</p> : (
        <div className="card p-4">
          <h3 className="font-display text-2xl">{sel.name}</h3>
          {(sel.key === 'owner' || sel.level >= myLevel) && <p className="text-sm"><Badge tone="warn">Somente leitura</Badge> Perfil no seu nível ou acima.</p>}
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {Object.entries(groups).map(([g, items]) => (
              <fieldset key={g}><legend className="mb-1 text-xs font-bold uppercase text-muted">{g}</legend>
                {items.map(([k, l]) => (
                  <label key={k} className="flex items-start gap-2 py-0.5 text-sm">
                    <input type="checkbox" className="mt-1" disabled={sel.key === 'owner' || sel.level >= myLevel || !s.can(k)} checked={perms.includes(k)}
                      onChange={(e) => setPerms((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))} />
                    <span>{l} <span className="font-mono text-[10px] text-muted">{k}</span></span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <ErrorBox error={err} />
          {sel.key !== 'owner' && sel.level < myLevel && <button className="btn-primary mt-3" onClick={save}>Salvar perfil</button>}
        </div>
      )}
    </div>
  );
}

function Units() {
  const ask = useAsk();
  const s = useSession();
  const toast = useToast();
  const units = useLoad(() => api('/api/admin/units'));
  const terms = useLoad(() => api('/api/admin/terminals'));
  const [err, setErr] = useState(null);
  const manage = s.can('configuracoes.gerenciar');
  if (units.loading || terms.loading) return <Loading />;
  const addUnit = async () => { const name = await ask.value({ title: 'Nova unidade', label: 'Nome da unidade', placeholder: 'ex.: Filial Centro', confirmLabel: 'Criar unidade' }); if (!name) return; try { await api('/api/admin/units', { method: 'POST', body: { name } }); units.reload(); } catch (e) { setErr(e); } };
  const addTerm = async (unit) => { const name = await ask.value({ title: `Novo terminal em ${unit.name}`, label: 'Nome do terminal', message: 'Terminal é cada aparelho que lança ou recebe (ex.: Caixa 2, Tablet do salão).', placeholder: 'ex.: Caixa 2', confirmLabel: 'Criar terminal' }); if (!name) return; try { await api('/api/admin/terminals', { method: 'POST', body: { name, unit_id: unit.id } }); terms.reload(); } catch (e) { setErr(e); } };
  const setCutoff = async (u, v) => { try { await api(`/api/admin/units/${u.id}`, { method: 'PUT', body: { day_cutoff: Number(v) } }); toast('Salvo'); units.reload(); } catch (e) { setErr(e); } };
  return (
    <div className="space-y-4">
      <ErrorBox error={err} />
      {manage && <button className="btn-primary" onClick={addUnit}>Nova unidade</button>}
      {units.data.map((u) => (
        <div key={u.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-2xl">{u.name}</h3>
            <label className="text-sm">Dia comercial vira às{' '}
              <select className="input inline w-24 py-1" disabled={!manage} value={u.day_cutoff} onChange={(e) => setCutoff(u, e.target.value)}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
          </div>
          <ul className="mt-2 divide-y divide-line">
            {terms.data.filter((t) => t.unit_id === u.id).map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2">
                <span>{t.name} {t.id === terminal.id && <Badge tone="info">este dispositivo</Badge>}</span>
                {t.id !== terminal.id && <button className="text-sm underline" onClick={() => { terminal.set(t.id); s.reload(); toast(`Este dispositivo agora é ${t.name}`); }}>usar neste dispositivo</button>}
              </li>
            ))}
          </ul>
          {manage && <button className="btn-ghost mt-2" onClick={() => addTerm(u)}>Adicionar terminal</button>}
        </div>
      ))}
    </div>
  );
}

function Audit() {
  const toast = useToast();
  const s = useSession();
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useLoad(() => api(`/api/admin/audit?limit=50&offset=${page * 50}${action ? `&action=${encodeURIComponent(action)}` : ''}`), [action, page]);
  const csv = () => download('/api/admin/audit?format=csv&limit=500', 'auditoria.csv').catch((e) => toast(e.message, 'bad'));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input max-w-xs" value={action} onChange={(e) => { setAction(e.target.value); setPage(0); }}>
          <option value="">Todas as ações</option>
          {['pdv.', 'pdv.excecao_manual', 'pdv.modo_alterado', 'pdv.item_cancelado', 'pagamento.', 'caixa.', 'consumo.', 'comanda.', 'usuario.', 'perfil.', 'autorizacao.', 'login', 'central.', 'leitura.desconhecida'].map((x) => <option key={x}>{x}</option>)}
        </select>
        <button className="btn-ghost" onClick={csv}>Exportar CSV</button>
      </div>
      {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : (
        <div className="card overflow-x-auto"><table className="table-clean">
          <thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Registro</th><th>Motivo</th><th>Detalhes</th></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}><td className="whitespace-nowrap">{dateTime(r.created_at, s.tz)}</td><td>{r.user_name || 'Sistema'}</td><td className="font-mono text-xs">{r.action}</td>
              <td>{r.entity ? `${r.entity} ${r.entity_id}` : '—'}</td><td>{r.reason || ''}</td><td className="max-w-xs truncate font-mono text-[11px] text-muted" title={JSON.stringify(r.data)}>{JSON.stringify(r.data)}</td></tr>
          ))}</tbody></table></div>
      )}
      <div className="mt-3 flex gap-2"><button className="btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><button className="btn-ghost" disabled={(data?.length || 0) < 50} onClick={() => setPage(page + 1)}>Próxima</button></div>
    </div>
  );
}
