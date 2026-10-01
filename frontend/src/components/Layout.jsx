// Estrutura da aplicação: menu (lateral recolhível ou superior), barra do topo, busca global e portões.
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Armchair, ChartColumn, Bell, Bike, BookOpen, ChefHat, House, LifeBuoy, LogOut, Megaphone, Menu, MessageCircle, Package,
  PanelLeft, PanelLeftClose, ScanBarcode, Search, Settings, Users, Wallet, Wifi, WifiOff, X, Banknote, PlayCircle,
} from 'lucide-react';
import { useSession } from '../lib/session.jsx';
import { api, terminal } from '../lib/api.js';
import { Badge, Logo, Modal } from './ui.jsx';
import { DemoBar } from './Activate.jsx';
import { lessonFor } from '../lib/training.js';

export const NAV = [
  { to: '/', label: 'Início', icon: House, end: true, tip: 'Resumo do dia' },
  { to: '/pdv', label: 'PDV', icon: ScanBarcode, module: 'pdv', perm: 'pdv.lancar', tip: 'Lançar itens e receber' },
  { to: '/salao', label: 'Salão', icon: Armchair, module: 'salao', perm: 'salao.visualizar', tip: 'Mesas e comandas' },
  { to: '/em-breve/cozinha', label: 'Cozinha', icon: ChefHat, module: 'cozinha', soon: true, tip: 'Filas de produção (KDS)' },
  { to: '/em-breve/delivery', label: 'Delivery', icon: Bike, module: 'delivery', soon: true, tip: 'Pedidos, retirada e cardápio digital' },
  { to: '/cardapio', label: 'Cardápio', icon: BookOpen, module: 'cardapio', perm: 'cardapio.visualizar', tip: 'Produtos, preços e códigos' },
  { to: '/em-breve/estoque', label: 'Estoque', icon: Package, module: 'estoque', soon: true, tip: 'Insumos, fichas técnicas e compras' },
  { to: '/em-breve/clientes', label: 'Clientes', icon: Users, module: 'clientes', soon: true, tip: 'Cadastro e fidelidade' },
  { to: '/financeiro/caixa', label: 'Financeiro', icon: Wallet, module: 'pdv', anyPerm: ['caixa.abrir', 'financeiro.visualizar'], tip: 'Caixa e recebimentos' },
  { to: '/em-breve/relatorios', label: 'Relatórios', icon: ChartColumn, module: 'relatorios', soon: true, tip: 'Vendas, CMV e indicadores' },
  { to: '/em-breve/marketing', label: 'Marketing', icon: Megaphone, module: 'marketing', soon: true, tip: 'Campanhas e avaliações' },
  { to: '/em-breve/agente', label: 'Agente', icon: MessageCircle, module: 'agente', soon: true, tip: 'Atendimento por WhatsApp' },
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

export default function Layout() {
  const s = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rusten.nav') === 'min');
  const [mobile, setMobile] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [cash, setCash] = useState(null);
  const online = useOnline();
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
      className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold uppercase tracking-wide transition
        ${isActive ? 'bg-copper text-white dark:text-black' : 'text-ink/80 hover:bg-raised'}`}>
      <n.icon size={19} className="shrink-0" aria-hidden />
      {!compact && <span className="flex-1">{n.label}</span>}
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
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
            <button className={`rounded p-2 hover:bg-raised ${topMenu ? '' : 'md:hidden'}`} onClick={() => setMobile(true)} aria-label="Abrir menu"><Menu size={20} /></button>
            {topMenu && <div className="hidden md:block"><Logo size={30} withText={false} /></div>}
            <button onClick={() => setSearchOpen(true)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-left text-sm text-muted hover:border-copper sm:max-w-md">
              <Search size={16} /> <span className="truncate">Buscar comanda, mesa, produto…</span>
              <kbd className="ml-auto hidden rounded border border-line px-1.5 text-[10px] sm:inline">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-2 text-sm">
              <span className="hidden lg:inline text-muted" title="Unidade">{unit?.name}</span>
              <button onClick={() => nav('/financeiro/caixa')} className="hidden sm:inline-flex" title="Situação do caixa deste terminal">
                {cash?.open ? <Badge tone="ok" icon={Banknote}>Caixa aberto</Badge> : <Badge tone="warn" icon={Banknote}>Caixa fechado</Badge>}
              </button>
              {!terminal.id && <span className="hidden sm:inline"><Badge tone="warn">Sem terminal</Badge></span>}
              <span title={online ? 'Conectado ao servidor' : 'Sem conexão com o servidor'}>
                {online ? <Badge tone="ok" icon={Wifi}>Online</Badge> : <Badge tone="bad" icon={WifiOff}>Offline</Badge>}
              </span>
              {(() => { const l = lessonFor(loc.pathname); return l && !loc.pathname.startsWith('/suporte') ? (
                <button onClick={() => nav(`/suporte?aula=${l.n}`)} className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-copper hover:bg-raised md:inline-flex" title={`Vídeo-aula: ${l.title}`}>
                  <PlayCircle size={16} /> Aula
                </button>) : null; })()}
              <span className="relative" title={warning || 'Sem avisos'}>
                <Bell size={19} className={warning ? 'text-warn' : 'text-muted'} aria-label="Notificações" />
                {warning && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rust" />}
              </span>
              <div className="hidden text-right leading-tight md:block">
                <div className="font-semibold">{s.me?.user?.name}</div>
                <div className="text-xs text-muted">{s.me?.user?.roleName}</div>
              </div>
              <button className="rounded p-2 hover:bg-raised" onClick={() => s.logout()} aria-label="Sair" title="Sair"><LogOut size={18} /></button>
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
        <DemoBar />
        {!s.me?.terminalId && (s.can('pdv.lancar') || s.can('caixa.abrir')) && <TerminalBar onSet={() => s.reload()} />}
        <main className="min-w-0 flex-1 p-3 sm:p-5"><Outlet /></main>
      </div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function TerminalBar({ onSet }) {
  const [list, setList] = useState([]);
  useEffect(() => { api('/api/admin/terminals').then(setList).catch(() => {}); }, []);
  if (!list.length) return null;
  return (
    <div className="no-print flex flex-wrap items-center gap-2 border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm">
      <Badge tone="warn">Terminal</Badge> Identifique este dispositivo (define o caixa e a configuração do leitor):
      {list.filter((t) => t.active).map((t) => <button key={t.id} className="btn-ghost py-1" onClick={() => { terminal.set(t.id); onSet(); }}>{t.name}</button>)}
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
    <Modal open={open} onClose={onClose} title="Buscar">
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
