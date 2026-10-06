// Estrutura da aplicação: menu (lateral recolhível ou superior), barra do topo, busca global e portões.
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Armchair, ChartColumn, Bell, Bike, BookOpen, ChefHat, House, LifeBuoy, LogOut, Megaphone, Menu, MessageCircle, Package,
  PanelLeft, PanelLeftClose, ScanBarcode, Search, Settings, Users, Wallet, Wifi, WifiOff, X, Banknote, PlayCircle, MoreHorizontal,
} from 'lucide-react';
import { useSession } from '../lib/session.jsx';
import { api, terminal } from '../lib/api.js';
import { Badge, Logo, Modal, useToast } from './ui.jsx';
import { beep } from '../pdv/useScanner.js';
import { DemoBar } from './Activate.jsx';
import { lessonFor } from '../lib/training.js';

export const NAV = [
  { to: '/', label: 'Início', icon: House, end: true, tip: 'Resumo do dia' },
  { to: '/pdv', label: 'PDV', icon: ScanBarcode, module: 'pdv', perm: 'pdv.lancar', tip: 'Lançar itens e receber' },
  { to: '/salao', label: 'Salão', icon: Armchair, module: 'salao', perm: 'salao.visualizar', tip: 'Mesas e comandas' },
  { to: '/cozinha', label: 'Cozinha', icon: ChefHat, module: 'cozinha', perm: 'cozinha.operar', tip: 'Filas de produção (KDS)' },
  { to: '/delivery', label: 'Delivery', icon: Bike, module: 'delivery', perm: 'delivery.gerenciar', tip: 'Pedidos, retirada e cardápio digital' },
  { to: '/cardapio', label: 'Cardápio', icon: BookOpen, module: 'cardapio', perm: 'cardapio.visualizar', tip: 'Produtos, preços e códigos' },
  { to: '/estoque', label: 'Estoque', icon: Package, module: 'estoque', perm: 'estoque.visualizar', tip: 'Insumos, fichas técnicas e compras' },
  { to: '/clientes', label: 'Clientes', icon: Users, module: 'clientes', perm: 'clientes.visualizar', tip: 'Cadastro e fidelidade' },
  { to: '/financeiro/caixa', label: 'Financeiro', icon: Wallet, module: 'pdv', anyPerm: ['caixa.abrir', 'financeiro.visualizar'], tip: 'Caixa e recebimentos' },
  { to: '/relatorios', label: 'Relatórios', icon: ChartColumn, module: 'relatorios', perm: 'relatorios.visualizar', tip: 'Vendas, CMV e indicadores' },
  { to: '/marketing', label: 'Marketing', icon: Megaphone, module: 'marketing', perm: 'marketing.gerenciar', tip: 'Campanhas e avaliações' },
  { to: '/agente', label: 'Agente', icon: MessageCircle, module: 'agente', anyPerm: ['agente.atender', 'agente.gerenciar'], tip: 'Atendimento por WhatsApp' },
  { to: '/configuracoes', label: 'Configurações', icon: Settings, tip: 'Empresa, PDV, usuários e assinatura' },
  { to: '/suporte', label: 'Suporte', icon: LifeBuoy, tip: 'Ajuda e contato' },
];

export function visibleNav(s) {
  return NAV.filter((n) => (!n.module || s.hasModule(n.module))
    && (!n.perm || s.can(n.perm)) && (!n.anyPerm || n.anyPerm.some((p) => s.can(p))));
}

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true); const down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    const t = setInterval(() => fetch(`${import.meta.env.VITE_API_URL || ''}/api/health`, { cache: 'no-store' }).then((r) => setOn(r.ok)).catch(() => setOn(false)), 30000);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); clearInterval(t); };
  }, []);
  return on;
}

// Pedidos do cardápio digital/WhatsApp: contador no menu, som e aviso em qualquer tela; alerta quando um pedido novo espera demais.
const WAIT_ALERT_MIN = 5;
function useDeliveryAlerts(s, nav) {
  const toast = useToast();
  const [state, setState] = useState({ waiting: [], late: [] });
  const seen = useRef(null);
  const warned = useRef(new Set());
  const enabled = s.hasModule('delivery') && s.can('delivery.gerenciar');
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = async () => {
      try {
        const rows = await api('/api/delivery/orders?status=abertos');
        if (!alive) return;
        const waiting = rows.filter((o) => o.status === 'recebido');
        const now = Date.now();
        const late = waiting.filter((o) => now - new Date(o.created_at).getTime() > WAIT_ALERT_MIN * 60000);
        if (!seen.current && waiting.length) {
          toast(`${waiting.length} pedido(s) do delivery aguardando confirmação`, 'info', { action: { label: 'Ver pedidos', run: () => nav('/delivery') }, ms: 10000 });
        }
        if (seen.current) {
          const fresh = waiting.filter((o) => !seen.current.has(o.id));
          if (fresh.length) {
            beep('ok');
            toast(fresh.length === 1 ? `Novo pedido #${fresh[0].number} de ${fresh[0].customer_name || 'cliente'} — confirme para ir à cozinha` : `${fresh.length} pedidos novos aguardando confirmação`, 'info',
              { action: { label: 'Ver pedidos', run: () => nav('/delivery') }, ms: 12000 });
          }
          const newlyLate = late.filter((o) => !warned.current.has(o.id));
          if (newlyLate.length) { beep('warn'); newlyLate.forEach((o) => warned.current.add(o.id)); }
        }
        seen.current = new Set(rows.map((o) => o.id));
        setState({ waiting, late });
      } catch { /* sem conexão: tenta na próxima */ }
    };
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = state.waiting.length ? `(${state.waiting.length}) ${base}` : base;
  }, [state.waiting.length]);
  return state;
}

export default function Layout() {
  const s = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rusten.nav') === 'min');
  const [mobile, setMobile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cash, setCash] = useState(null);
  const online = useOnline();
  const deliv = useDeliveryAlerts(s, nav);
  const badges = { '/delivery': deliv.waiting.length };
  const topMenu = s.me?.company?.settings?.appearance?.menu === 'superior';
  const items = visibleNav(s);
  const unit = s.me?.units?.find((u) => u.id === s.me?.unitId);

  useEffect(() => { setMobile(false); }, [loc.pathname]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      if (e.altKey && !e.ctrlKey) {
        const map = { p: '/pdv', s: '/salao', c: '/financeiro/caixa', i: '/' };
        const to = map[e.key.toLowerCase()];
        if (to) { e.preventDefault(); nav(to); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);
  useEffect(() => {
    let alive = true;
    const load = () => api('/api/cash/current').then((c) => alive && setCash(c)).catch(() => alive && setCash(null));
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [loc.pathname, s.me?.terminalId]);

  const toggle = () => { const v = !collapsed; setCollapsed(v); localStorage.setItem('rusten.nav', v ? 'min' : 'full'); };
  const warning = s.me?.access?.warning;

  const links = (compact) => items.map((n) => (
    <NavLink key={n.to} to={n.to} end={n.end} title={compact ? `${n.label} — ${n.tip}` : n.tip}
      className={({ isActive }) => `group flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold uppercase tracking-wide transition
        ${isActive ? 'bg-copper text-white dark:text-black' : 'text-ink/80 hover:bg-raised'}`}>
      <span className="relative shrink-0"><n.icon size={19} aria-hidden />{compact && badges[n.to] > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-rust px-1 text-[10px] font-bold text-white">{badges[n.to]}</span>}</span>
      {!compact && <span className="flex-1">{n.label}</span>}
      {!compact && badges[n.to] > 0 && <span className="rounded-full bg-rust px-2 text-xs font-bold normal-case text-white" aria-label={`${badges[n.to]} pedido(s) aguardando`}>{badges[n.to]}</span>}
      {!compact && n.soon && <span className="whitespace-nowrap rounded bg-raised px-1.5 text-[9px] font-bold normal-case tracking-normal text-muted group-hover:bg-surface">em breve</span>}
    </NavLink>
  ));

  return (
    <div className="flex min-h-screen">
      {!topMenu && (
        <aside className={`no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface p-3 md:flex ${collapsed ? 'w-[68px]' : 'w-60'}`}>
          <div className="mb-4 flex items-center justify-between px-1">
            <Logo size={34} withText={!collapsed} />
          </div>
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto" aria-label="Menu principal">{links(collapsed)}</nav>
          <button className="btn-ghost mt-2 justify-start px-3 text-xs" onClick={toggle} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            {collapsed ? <PanelLeft size={16} /> : <><PanelLeftClose size={16} /> Recolher</>}
          </button>
        </aside>
      )}

      {mobile && (
        <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setMobile(false)}>
          <aside className="h-full w-72 overflow-y-auto bg-surface p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between"><Logo size={32} /><button onClick={() => setMobile(false)} aria-label="Fechar menu"><X /></button></div>
            <nav className="flex flex-col gap-1">{links(false)}</nav>
            <div className="mt-4 border-t border-line pt-3 text-sm">
              <div className="font-semibold">{s.me?.user?.name}</div><div className="text-xs text-muted">{s.me?.user?.roleName}{unit?.name ? ` · ${unit.name}` : ''}</div>
              <button className="btn-ghost mt-2 w-full" onClick={() => s.logout()}><LogOut size={16} /> Sair</button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
            <button className={`flex h-11 w-11 items-center justify-center rounded hover:bg-raised ${topMenu ? '' : 'md:hidden'}`} onClick={() => setMobile(true)} aria-label="Abrir menu"><Menu size={20} /></button>
            {topMenu && <div className="hidden md:block"><Logo size={30} withText={false} /></div>}
            <button onClick={() => setSearchOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-left text-sm text-muted hover:border-copper sm:max-w-md">
              <Search size={16} /> <span className="truncate">Buscar comanda, mesa, produto…</span>
              <kbd className="ml-auto hidden rounded border border-line px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-2 text-sm">
              <span className="hidden lg:inline text-muted" title="Unidade">{unit?.name}</span>
              <button onClick={() => nav('/financeiro/caixa')} className="inline-flex min-h-[44px] items-center" title="Situação do caixa deste terminal" data-cash-badge>
                {cash?.open ? <Badge tone="ok" icon={Banknote}><span className="hidden sm:inline">Caixa </span>aberto</Badge> : <Badge tone="warn" icon={Banknote}><span className="hidden sm:inline">Caixa </span>fechado</Badge>}
              </button>
              {!terminal.id && <span className="hidden sm:inline"><Badge tone="warn">Sem terminal</Badge></span>}
              <span title={online ? 'Conectado ao servidor' : 'Sem conexão com o servidor'} className={online ? 'hidden sm:inline' : ''}>
                {online ? <Badge tone="ok" icon={Wifi}>Online</Badge> : <Badge tone="bad" icon={WifiOff}>Offline</Badge>}
              </span>
              {(() => { const l = lessonFor(loc.pathname); return l && !loc.pathname.startsWith('/suporte') ? (
                <button onClick={() => nav(`/suporte?aula=${l.n}`)} className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-copper hover:bg-raised md:inline-flex" title={`Vídeo-aula: ${l.title}`}>
                  <PlayCircle size={16} /> Aula
                </button>) : null; })()}
              <NoticeBell warning={warning} deliv={deliv} onGo={nav} canBilling={s.can('assinatura.gerenciar')} />
              <div className="hidden text-right leading-tight md:block">
                <div className="font-semibold">{s.me?.user?.name}</div>
                <div className="text-xs text-muted">{s.me?.user?.roleName}</div>
              </div>
              <button className="hidden h-11 w-11 items-center justify-center rounded hover:bg-raised sm:flex" onClick={() => s.logout()} aria-label="Sair" title="Sair"><LogOut size={18} /></button>
            </div>
          </div>
          {topMenu && <nav className="hidden gap-1 overflow-x-auto px-3 pb-2 md:flex" aria-label="Menu principal">{links(false)}</nav>}
          {s.me?.notice && <div className={`border-t px-4 py-1.5 text-sm ${s.me.notice.level === 'warn' ? 'border-warn/40 bg-warn/10' : 'border-copper/30 bg-copper/5'}`}><Badge tone={s.me.notice.level === 'warn' ? 'warn' : 'info'}>Aviso</Badge> {s.me.notice.text}</div>}
          {(s.me?.access?.notices || []).map((n) => (
            <div key={n.text} className={`flex flex-wrap items-center gap-2 border-t px-4 py-1.5 text-sm ${n.level === 'danger' ? 'border-rust/40 bg-rust/10' : 'border-warn/40 bg-warn/10'}`}>
              <Badge tone={n.level === 'danger' ? 'bad' : 'warn'}>Assinatura</Badge> <span className="flex-1">{n.text}</span>
              {s.can('assinatura.gerenciar') && <button className="font-semibold underline" onClick={() => nav('/configuracoes/assinatura')}>Ver assinatura</button>}
            </div>
          ))}
        </header>
        {deliv.late.length > 0 && (
          <div className="no-print flex flex-wrap items-center gap-2 border-b border-rust/40 bg-rust/10 px-4 py-2 text-sm" role="alert" data-delivery-late>
            <Badge tone="bad" icon={Bike}>Delivery</Badge>
            <span className="flex-1">{deliv.late.length === 1 ? `Pedido #${deliv.late[0].number} espera confirmação há mais de ${WAIT_ALERT_MIN} min.` : `${deliv.late.length} pedidos esperam confirmação há mais de ${WAIT_ALERT_MIN} min.`} O cliente está vendo "Recebido".</span>
            <button className="btn-danger" onClick={() => nav('/delivery')}>Confirmar agora</button>
          </div>
        )}
        <DemoBar />
        {!s.me?.terminalId && (s.can('pdv.lancar') || s.can('caixa.abrir')) && <TerminalBar onSet={() => s.reload()} />}
        <main className="min-w-0 flex-1 p-3 pb-24 sm:p-5 sm:pb-24 md:pb-5"><Outlet /></main>
      </div>
      <BottomNav items={items} badges={badges} onMore={() => setMobile(true)} />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function TerminalBar({ onSet }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    api('/api/admin/terminals').then((all) => {
      const act = all.filter((t) => t.active);
      // um terminal só: este aparelho usa ele, sem perguntar
      if (act.length === 1) { terminal.set(act[0].id); onSet(); return; }
      setList(all);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  return (
    <div className="no-print flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm">
      <Badge tone="warn">Terminal</Badge> Qual aparelho é este? (define em qual caixa entram os recebimentos):
       {list.filter((t) => t.active).map((t) => <button key={t.id} className="btn-ghost" onClick={() => { terminal.set(t.id); onSet(); }}>{t.name}</button>)}
    </div>
  );
}

function GlobalSearch({ open, onClose }) {
  const [term, setTerm] = useState('');
  const [res, setRes] = useState([]);
  const nav = useNavigate();
  useEffect(() => {
    if (!open) { setTerm(''); setRes([]); return undefined; }
    if (term.trim().length < 2) { setRes([]); return undefined; }
    const ctl = new AbortController();
    const t = setTimeout(() => api(`/api/home/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal }).then(setRes).catch(() => {}), 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [term, open]);
  return (
    <Modal open={open} onClose={onClose} title="Buscar" guard={false}>
      <input className="input" autoFocus placeholder="Número da comanda/mesa, produto, cliente…" value={term} onChange={(e) => setTerm(e.target.value)} />
      <ul className="mt-3 divide-y divide-line">
        {res.map((r) => (
          <li key={`${r.type}-${r.id}`}>
            <button className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-raised" onClick={() => { onClose(); nav(r.to); }}>
              <Badge tone="muted">{r.type}</Badge> {r.label}
            </button>
          </li>
        ))}
        {term.length >= 2 && !res.length && <li className="py-3 text-sm text-muted">Nada encontrado.</li>}
      </ul>
      <p className="mt-3 text-xs text-muted">Atalhos: Alt+P PDV · Alt+S Salão · Alt+C Caixa · Alt+I Início · Ctrl+K busca</p>
    </Modal>
  );
}

// Avisos do sino: assinatura e pedidos do delivery
function NoticeBell({ warning, deliv, onGo, canBilling }) {
  const [open, setOpen] = useState(false);
  const n = (warning ? 1 : 0) + deliv.waiting.length;
  return (
    <div className="relative">
      <button className="relative flex h-11 w-11 items-center justify-center rounded hover:bg-raised" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        aria-label={n ? `Avisos (${n})` : 'Avisos'} title={n ? `${n} aviso(s)` : 'Sem avisos'} data-bell>
        <Bell size={19} className={n ? 'text-warn' : 'text-muted'} aria-hidden />
        {n > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-rust" />}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-72 rounded-xl border border-line bg-surface p-2 text-sm shadow-xl" role="dialog" aria-label="Avisos">
          {!n && <p className="p-2 text-muted">Nenhum aviso agora.</p>}
          {deliv.waiting.length > 0 && <button className="block min-h-[44px] w-full rounded-lg p-2 text-left hover:bg-raised" onClick={() => { setOpen(false); onGo('/delivery'); }}>
            <b>{deliv.waiting.length} pedido(s) do delivery</b> aguardando confirmação</button>}
          {warning && <button className="block min-h-[44px] w-full rounded-lg p-2 text-left hover:bg-raised" onClick={() => { setOpen(false); if (canBilling) onGo('/configuracoes/assinatura'); }}>{warning}</button>}
        </div>
      )}
    </div>
  );
}

// Celular: as ações do dia a dia ficam no polegar
const BOTTOM = ['/salao', '/pdv', '/cozinha', '/delivery', '/', '/financeiro/caixa'];
function BottomNav({ items, badges, onMore }) {
  const shown = BOTTOM.map((to) => items.find((n) => n.to === to)).filter(Boolean).slice(0, 4);
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex h-16 border-t border-line bg-surface md:hidden" aria-label="Atalhos">
      {shown.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive ? 'text-copper' : 'text-muted'}`}>
          <n.icon size={22} aria-hidden />{n.label}
          {badges[n.to] > 0 && <span className="absolute right-[22%] top-1.5 rounded-full bg-rust px-1.5 text-[10px] font-bold text-white">{badges[n.to]}</span>}
        </NavLink>
      ))}
      <button className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-muted" onClick={onMore} aria-label="Abrir menu completo">
        <MoreHorizontal size={22} aria-hidden />Mais
      </button>
    </nav>
  );
}
