// PDV RUSTEN — lançamento manual, leitura contínua e dupla leitura COMANDA → PRODUTO.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowRightLeft, Ban, ChefHat, Gift, Hand, Keyboard, Minus, Pause, Play, Plus, Printer, Receipt, ScanBarcode, Star, Store, Timer, UserRound, X,
} from 'lucide-react';
import CustomerPicker from '../components/CustomerPicker.jsx';
import { api, newKey } from '../lib/api.js';
import { money, qtyFmt, bp, time } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, useToast } from '../components/ui.jsx';
import { useScanner, beep } from './useScanner.js';
import { CancelItemModal, ExceptionModal, OptionsModal, PaymentModal, TransferModal, printPrecheck, sessionLabel, ManagerAuth } from './modals.jsx';

const MODE_LABEL = { manual: 'Manual', continua: 'Leitura contínua', dupla: 'Dupla leitura' };

export default function Pdv() {
  const s = useSession();
  const toast = useToast();
  const st = s.me.pdv;
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState(st.double_read_mandatory ? 'dupla' : st.mode);
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(Number(params.get('sessao')) || null);
  const [active, setActive] = useState(null);
  const [products, setProducts] = useState(null);
  const [cats, setCats] = useState([]);
  const [cat, setCat] = useState('fav');
  const [search, setSearch] = useState('');
  const [qtyNext, setQtyNext] = useState(1);
  const [loadErr, setLoadErr] = useState(null);
  const [reviewFor, setReviewFor] = useState(null);

  // Motor de leitura
  const [phase, setPhase] = useState('idle'); // idle | await_card | await_product | sending | uncertain
  const [pair, setPair] = useState(null); // { card, code, sessionId }
  const [deadline, setDeadline] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [banner, setBanner] = useState(null); // { tone, text, action }
  const [last, setLast] = useState(null);
  const [pending, setPending] = useState(null);
  const [optionsFor, setOptionsFor] = useState(null);
  const [exceptionFor, setExceptionFor] = useState(null);
  const [modal, setModal] = useState(null); // pay | open | cancel | transfer | fee | terminal
  const [cancelItem, setCancelItem] = useState(null);
  const stateRef = useRef({});
  stateRef.current = { phase, pair, mode, activeId, products };
  const scanRef = useRef(null);

  const say = useCallback((tone, text, action) => {
    setBanner({ tone, text, action, at: Date.now() });
    if (st.feedback_sound) beep(tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'bad');
  }, [st.feedback_sound]);

  // ---- Dados ----
  const loadSessions = useCallback(async () => {
    try { setSessions(await api('/api/pdv/sessions')); } catch (e) { setLoadErr(e); }
  }, []);
  const loadActive = useCallback(async (id = stateRef.current.activeId) => {
    if (!id) { setActive(null); return; }
    try { setActive(await api(`/api/pdv/sessions/${id}`)); } catch (e) { setActive(null); if (e.status === 404) setActiveId(null); }
  }, []);
  useEffect(() => {
    Promise.all([api('/api/menu/products'), api('/api/menu/categories')])
      .then(([p, c]) => { setProducts(p); setCats(c.filter((x) => x.active)); if (!p.some((x) => x.favorite)) setCat('all'); })
      .catch(setLoadErr);
    loadSessions();
    const t = setInterval(loadSessions, 20000);
    return () => clearInterval(t);
  }, [loadSessions]);
  useEffect(() => { loadActive(activeId); if (activeId) setParams({ sessao: String(activeId) }, { replace: true }); }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPhase(mode === 'dupla' ? 'await_card' : 'idle'); setPair(null); setDeadline(null); }, [mode]);

  // ---- Temporizador da dupla leitura ----
  useEffect(() => {
    if (!deadline) { setRemaining(null); return undefined; }
    const t = setInterval(() => {
      const left = deadline - Date.now();
      if (left <= 0) {
        setPair(null); setDeadline(null); setPhase('await_card');
        say('warn', 'Tempo esgotado: par descartado, nada foi lançado. Leia a comanda novamente.');
      } else setRemaining(Math.ceil(left / 1000));
    }, 200);
    return () => clearInterval(t);
  }, [deadline, say]);

  const cancelPair = useCallback((why) => {
    setPair(null); setDeadline(null); setPhase('await_card');
    if (why) say('warn', why);
  }, [say]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      const { phase: ph } = stateRef.current;
      if (ph === 'await_product') cancelPair('Par cancelado (Esc). Nenhum item foi lançado.');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelPair]);

  // ---- Lançamento (idempotente) ----
  const afterSuccess = useCallback(async (r, body) => {
    const c = r.confirmation || { product: r.item.description, qty: r.item.qty, total_cents: r.item.total_cents, destination: `Consumo ${r.item.session_id}` };
    const text = `${qtyFmt(c.qty)} × ${c.product} → ${c.destination} · ${money(c.total_cents)}`;
    setLast({ ...c, at: new Date(), replay: r.replay });
    say('ok', r.replay ? `Já estava lançado (sem duplicar): ${text}` : `Lançado: ${text}`);
    setPending(null);
    if (stateRef.current.mode === 'dupla') { setPair(null); setDeadline(null); setPhase('await_card'); } else setPhase('idle');
    setActiveId(body.session_id);
    await loadActive(body.session_id);
    loadSessions();
  }, [say, loadActive, loadSessions]);

  const send = useCallback(async (body) => {
    setPhase('sending');
    try {
      const r = await api('/api/pdv/items', { method: 'POST', body });
      await afterSuccess(r, body);
    } catch (e) {
      if (e.uncertain) {
        setPending(body); setPhase('uncertain');
        say('bad', 'Sem confirmação do servidor. Não lance de novo: use "Conferir operação".');
      } else {
        say('bad', `Não lançado: ${e.message}`);
        if (stateRef.current.mode === 'dupla') { setPair(null); setDeadline(null); setPhase('await_card'); } else setPhase('idle');
      }
    }
  }, [afterSuccess, say]);

  const recover = async () => {
    if (!pending) return;
    setPhase('sending');
    try {
      const r = await api(`/api/pdv/items/by-key/${pending.idempotency_key}`);
      if (r.found) {
        const t = await api(`/api/pdv/sessions/${pending.session_id}`);
        await afterSuccess({ item: r.item, replay: true, totals: t.totals }, pending);
      } else await send(pending); // mesma chave: o servidor nunca duplica
    } catch (e) { setPhase('uncertain'); say('bad', `Ainda sem conexão: ${e.message}`); }
  };

  const productById = (id) => stateRef.current.products?.find((p) => p.id === id);
  const needsOptions = (p) => p && (p.kind === 'weight' || (p.groups || []).length > 0);
  const destOf = (sessionId, card) => (card ? `Comanda ${card.number}` : sessionLabel(sessions.find((x) => x.id === sessionId) || active || { id: sessionId }));

  // ---- Leituras ----
  const openForCard = async (card, code) => {
    const r = await api('/api/pdv/sessions', { method: 'POST', body: { kind: 'comanda', card_id: card.id } });
    loadSessions();
    return { ...card, session_id: r.id, session_status: 'aberta', code };
  };

  const onScan = useCallback(async (raw) => {
    const code = String(raw).trim();
    const { phase: ph, pair: pr, mode: md, activeId: act } = stateRef.current;
    if (ph === 'sending') return say('warn', 'Aguarde a confirmação do lançamento anterior.');
    if (ph === 'uncertain') return say('bad', 'Há uma operação sem confirmação. Confira antes de continuar.');
    if (!st.scanner_enabled && md !== 'manual') return say('bad', 'Leitor desabilitado nesta configuração.');
    let r;
    try { r = await api('/api/pdv/resolve', { method: 'POST', body: { code } }); } catch (e) { return say('bad', e.message); }

    if (md === 'dupla') {
      if (r.type === 'COMANDA') {
        if (ph === 'await_product' && pr && pr.card.id !== r.card.id) return cancelPair(`Outra comanda lida (${r.card.number}) enquanto aguardava o produto da ${pr.card.number}: par cancelado, nada lançado. Leia a comanda novamente.`);
        if (r.card.status !== 'ativo') return say('bad', `Comanda ${r.card.number} bloqueada${r.card.block_reason ? `: ${r.card.block_reason}` : ''}.`);
        let card = { ...r.card, code };
        if (!card.session_id) {
          if (st.open_free_card_on_scan && s.can('pdv.abrir_comanda')) {
            try { card = await openForCard(card, code); } catch (e) { return say('bad', e.message); }
          } else {
            return say('warn', `Comanda ${card.number} sem consumo aberto. Nada foi lançado.`, s.can('pdv.abrir_comanda') ? { label: 'Abrir consumo', run: async () => { try { const c = await openForCard(card, code); setPair({ card: c, code, sessionId: c.session_id }); setDeadline(Date.now() + st.product_timeout_s * 1000); setPhase('await_product'); setActiveId(c.session_id); } catch (e) { say('bad', e.message); } } } : null);
          }
        }
        if (card.session_status === 'em_fechamento') return say('bad', `Comanda ${card.number} em fechamento: não aceita itens.`);
        setPair({ card, code, sessionId: card.session_id });
        setDeadline(Date.now() + st.product_timeout_s * 1000);
        setPhase('await_product');
        setActiveId(card.session_id);
        if (st.feedback_sound) beep('ok');
        setBanner({ tone: 'info', text: `Comanda ${card.number}: agora leia o produto.` });
        return undefined;
      }
      if (r.type === 'PRODUTO') {
        if (ph !== 'await_product' || !pr) return say('bad', 'Produto lido antes da comanda. Leia a COMANDA primeiro — nada foi lançado.');
        const p = productById(r.product.id) || { ...r.product, groups: [] };
        const body = { session_id: pr.sessionId, product_id: p.id, launch_mode: 'dupla', scan: { card_code: pr.code, product_code: code }, idempotency_key: newKey() };
        if (needsOptions(p) || r.product.has_options) { setDeadline(null); setOptionsFor({ product: p, destination: `Comanda ${pr.card.number}`, body }); return undefined; }
        return send(body);
      }
      return say('bad', r.type === 'DESCONHECIDO' ? `Código "${code}" não reconhecido. Nada foi lançado.` : `Código de ${r.type.toLowerCase()} não é usado na dupla leitura.`);
    }

    // Manual e contínua: comanda/mesa selecionam o destino; produto lança no destino ativo
    if (r.type === 'COMANDA') {
      if (r.card.status !== 'ativo') return say('bad', `Comanda ${r.card.number} bloqueada.`);
      if (!r.card.session_id) {
        return say('warn', `Comanda ${r.card.number} sem consumo aberto.`, s.can('pdv.abrir_comanda') ? { label: 'Abrir consumo', run: async () => { try { const c = await openForCard(r.card, code); setActiveId(c.session_id); say('ok', `Destino agora: Comanda ${r.card.number}`); } catch (e) { say('bad', e.message); } } } : null);
      }
      setActiveId(r.card.session_id);
      return say('ok', `Destino agora: Comanda ${r.card.number}`);
    }
    if (r.type === 'MESA') {
      const open = sessions.filter((x) => x.table_id === r.table.id);
      if (open.length === 1) { setActiveId(open[0].id); return say('ok', `Destino agora: Mesa ${r.table.number}`); }
      if (open.length > 1) return say('warn', `Mesa ${r.table.number} tem ${open.length} consumos: escolha na lista.`);
      return say('warn', `Mesa ${r.table.number} sem consumo aberto.`, s.can('pdv.abrir_comanda') ? { label: 'Abrir mesa', run: async () => { try { const c = await api('/api/pdv/sessions', { method: 'POST', body: { kind: 'mesa', table_id: r.table.id } }); setActiveId(c.id); loadSessions(); } catch (e) { say('bad', e.message); } } } : null);
    }
    if (r.type === 'PRODUTO') {
      if (!act) return say('warn', 'Selecione ou leia uma comanda antes do produto. Nada foi lançado.');
      const p = productById(r.product.id) || { ...r.product, groups: [] };
      const body = md === 'continua'
        ? { session_id: act, product_id: p.id, launch_mode: 'continua', scan: { product_code: code }, idempotency_key: newKey() }
        : { session_id: act, product_id: p.id, launch_mode: 'manual', idempotency_key: newKey() };
      if (needsOptions(p) || r.product.has_options) { setOptionsFor({ product: p, destination: destOf(act), body }); return undefined; }
      return send(body);
    }
    return say('bad', `Código "${code}" não reconhecido. Nada foi lançado.`);
  }, [st, s, say, send, cancelPair, sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  useScanner(onScan, { enabled: st.scanner_enabled, terminator: st.terminator });

  // ---- Lançamento pelo catálogo ----
  const pickProduct = (p) => {
    if (phase === 'sending' || phase === 'uncertain') return say('warn', 'Aguarde/resolva o lançamento pendente.');
    if (!activeId) return say('warn', 'Escolha o destino: selecione um consumo, abra uma comanda ou inicie uma venda de balcão.');
    if (!st.allow_manual && !st.double_read_mandatory) return say('bad', 'Lançamento manual desabilitado.');
    if (st.double_read_mandatory) {
      if (!st.allow_manual_exception || !s.can('pdv.excecao_dupla_leitura')) return say('bad', 'Dupla leitura obrigatória: leia a comanda e depois o produto.');
      return setExceptionFor({ product: p, destination: destOf(activeId) });
    }
    if (!s.can('pdv.lancamento_manual')) return say('bad', 'Sem permissão para lançamento manual.');
    const body = { session_id: activeId, product_id: p.id, launch_mode: 'manual', qty: p.kind === 'weight' ? undefined : qtyNext, idempotency_key: newKey() };
    if (needsOptions(p)) return setOptionsFor({ product: p, destination: destOf(activeId), body, askQty: true });
    setQtyNext(1);
    return send(body);
  };

  const onException = ({ reason, authorization }) => {
    const { product, destination } = exceptionFor;
    const body = { session_id: activeId, product_id: product.id, launch_mode: 'excecao', exception_reason: reason, authorization: authorization || undefined, idempotency_key: newKey() };
    setExceptionFor(null);
    if (needsOptions(product)) return setOptionsFor({ product, destination, body, askQty: true });
    return send(body);
  };

  const changeMode = async (to) => {
    if (to === mode) return;
    if (phase === 'sending' || phase === 'uncertain') return say('warn', 'Resolva o lançamento em andamento antes de trocar o modo.');
    try {
      await api('/api/pdv/mode', { method: 'POST', body: { from: mode, to } });
      setMode(to);
      say('ok', `Modo: ${MODE_LABEL[to]}. Itens já lançados não mudam.`);
    } catch (e) { say('bad', e.message); }
  };

  const filtered = useMemo(() => {
    if (!products) return [];
    const q = search.trim().toLowerCase();
    return products.filter((p) => (q ? p.name.toLowerCase().includes(q) || p.sku === search.trim() || p.codes?.includes(search.trim())
      : cat === 'all' ? true : cat === 'fav' ? p.favorite : p.category_id === Number(cat)));
  }, [products, search, cat]);

  const typed = (e) => {
    if (e.key !== 'Enter') return;
    const v = e.currentTarget.value.trim();
    if (!v) return;
    e.currentTarget.value = '';
    onScan(v);
  };

  const canSwitch = s.can('pdv.alterar_modo') && st.allow_mode_change && !st.double_read_mandatory;
  const statusText = mode === 'dupla'
    ? phase === 'await_product' ? `COMANDA ${pair?.card.number} — AGUARDANDO PRODUTO` : phase === 'sending' ? 'ENVIANDO…' : phase === 'uncertain' ? 'OPERAÇÃO SEM CONFIRMAÇÃO' : 'AGUARDANDO COMANDA'
    : mode === 'continua' ? (activeId ? `DESTINO: ${destOf(activeId).toUpperCase()} — LEIA OS PRODUTOS` : 'LEIA OU SELECIONE UMA COMANDA')
      : 'MODO MANUAL — LEITOR NÃO OBRIGATÓRIO';

  if (loadErr) return <ErrorBox error={loadErr} onRetry={() => window.location.reload()} />;
  if (!products) return <Loading label="Preparando o PDV…" />;

  return (
    <div className="-m-3 flex min-h-[calc(100vh-57px)] flex-col sm:-m-5">
      {/* Barra de estado do motor de leitura */}
      <div className={`border-b border-line px-3 py-3 sm:px-5 ${phase === 'await_product' ? 'bg-copper/15' : phase === 'uncertain' ? 'bg-rust/15' : 'bg-surface'}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Modo de operação" className="flex overflow-hidden rounded-lg border border-line">
            {['manual', 'continua', 'dupla'].map((m) => (
              <button key={m} onClick={() => changeMode(m)} disabled={!canSwitch && m !== mode} aria-pressed={mode === m}
                className={`px-3 py-2 text-sm font-semibold ${mode === m ? 'bg-copper text-white dark:text-black' : 'bg-surface hover:bg-raised'} disabled:opacity-40`}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {st.double_read_mandatory && <Badge tone="warn">Dupla leitura obrigatória</Badge>}
          <div className="flex min-w-[220px] flex-1 items-center gap-2" aria-live="assertive">
            <ScanBarcode className={phase === 'await_product' ? 'text-copper' : 'text-muted'} />
            <span className="font-display text-2xl tracking-wide sm:text-3xl">{statusText}</span>
            {remaining != null && <Badge tone="warn" icon={Timer}>{remaining}s</Badge>}
            {phase === 'await_product' && <button className="btn-ghost py-1 text-xs" onClick={() => cancelPair('Par cancelado. Nenhum item foi lançado.')}><X size={14} /> Cancelar par (Esc)</button>}
          </div>
          <label className="flex items-center gap-2">
            <Keyboard size={18} className="text-muted" aria-hidden />
            <input ref={scanRef} data-scan-input className="input w-56 font-mono" placeholder="Digite ou leia o código + Enter" onKeyDown={typed} aria-label="Código da comanda, mesa ou produto" autoComplete="off" />
          </label>
        </div>
        {banner && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="status">
            <Badge tone={banner.tone}>{banner.tone === 'ok' ? 'OK' : banner.tone === 'warn' ? 'Atenção' : banner.tone === 'info' ? 'Leitura' : 'Não lançado'}</Badge>
            <span className="font-medium">{banner.text}</span>
            {banner.action && <button className="btn-ghost py-1 text-xs" onClick={() => { const a = banner.action; setBanner(null); a.run(); }}>{banner.action.label}</button>}
          </div>
        )}
        {phase === 'uncertain' && pending && (
          <div className="mt-2 flex flex-wrap items-center gap-2"><button className="btn-danger" onClick={recover}>Conferir operação (sem duplicar)</button><span className="text-sm text-muted">O item pode ter sido gravado. A conferência usa a mesma identificação da operação.</span></div>
        )}
      </div>

      <div className="grid flex-1 gap-0 lg:grid-cols-[400px_1fr]">
        {/* Consumo ativo */}
        <section className="border-b border-line bg-surface lg:border-b-0 lg:border-r">
          <SessionsStrip sessions={sessions} activeId={activeId} onPick={(id) => { if (mode === 'dupla' && phase === 'await_product') cancelPair('Par cancelado: destino trocado manualmente.'); setActiveId(id); }}
            onOpen={() => setModal('open')} onCounter={async () => { try { const r = await api('/api/pdv/sessions', { method: 'POST', body: { kind: 'balcao' } }); setActiveId(r.id); loadSessions(); } catch (e) { say('bad', e.message); } }} canOpen={s.can('pdv.abrir_comanda')} />
          <ActivePanel session={active} last={last} tz={s.tz}
            onPay={() => setModal('pay')} onPrint={() => printPrecheck(active, s.me.company.name, s.tz) || toast('Permita pop-ups para imprimir', 'warn')}
            onCancelItem={(it) => { setCancelItem(it); setModal('cancel'); }} onTransfer={() => setModal('transfer')} onFee={() => setModal('fee')}
            onRequestClose={async () => { try { await api(`/api/pdv/sessions/${active.id}/${active.status === 'aberta' ? 'request-close' : 'resume'}`, { method: 'POST' }); loadActive(); loadSessions(); } catch (e) { say('bad', e.message); } }}
            onCancelSession={async () => { const reason = prompt('Motivo do cancelamento do consumo:'); if (!reason) return; try { await api(`/api/pdv/sessions/${active.id}/cancel`, { method: 'POST', body: { reason } }); setActiveId(null); loadSessions(); } catch (e) { say('bad', e.message); } }}
            onSuspend={async () => { await api(`/api/pdv/sessions/${active.id}/suspend`, { method: 'POST', body: { suspended: !active.suspended } }).catch(() => {}); loadActive(); loadSessions(); }}
            onCustomer={() => setModal('customer')} onRedeem={() => setModal('redeem')}
            onSend={async () => { try { const r = await api(`/api/pdv/sessions/${active.id}/send`, { method: 'POST' }); toast(`${r.sent} item(ns) enviado(s) à produção`); loadActive(); } catch (e) { say('bad', e.message); } }}
            can={s.can} />
        </section>

        {/* Catálogo */}
        <section className="min-w-0 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input max-w-xs" placeholder="Buscar produto, SKU ou código" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar produto" />
            <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1" title="Quantidade do próximo lançamento manual">
              <button className="rounded p-2 hover:bg-raised" onClick={() => setQtyNext((q) => Math.max(1, q - 1))} aria-label="Diminuir quantidade"><Minus size={16} /></button>
              <span className="w-10 text-center font-display text-2xl">{qtyNext}×</span>
              <button className="rounded p-2 hover:bg-raised" onClick={() => setQtyNext((q) => Math.min(99, q + 1))} aria-label="Aumentar quantidade"><Plus size={16} /></button>
            </div>
            {st.double_read_mandatory && <span className="text-xs text-muted"><Hand size={12} className="inline" /> Clique no produto = exceção autorizada</span>}
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
            {[['fav', 'Favoritos'], ['all', 'Todos'], ...cats.map((c) => [String(c.id), c.name])].map(([k, l]) => (
              <button key={k} onClick={() => { setCat(k); setSearch(''); }} className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-semibold ${cat === k && !search ? 'border-copper bg-copper text-white dark:text-black' : 'border-line bg-surface hover:bg-raised'}`}>{k === 'fav' && <Star size={12} className="mr-1 inline" />}{l}</button>
            ))}
          </div>
          {!filtered.length ? (
            <div className="mt-4"><Empty title="Nada por aqui">{products.length ? 'Nenhum produto nesta seleção.' : 'Cadastre produtos em Cardápio.'}</Empty></div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filtered.map((p) => (
                <button key={p.id} onClick={() => pickProduct(p)} disabled={phase === 'sending'}
                  className="group flex min-h-[84px] flex-col justify-between rounded-xl border border-line bg-surface p-3 text-left transition hover:border-copper hover:shadow-md focus-visible:ring-4 focus-visible:ring-copper/40 disabled:opacity-50">
                  <span className="line-clamp-2 font-semibold leading-tight">{p.name}</span>
                  <span className="mt-1 flex items-center justify-between text-sm">
                    <span className="font-display text-xl text-copper">{money(p.price_cents)}{p.kind === 'weight' ? `/${p.unit}` : ''}</span>
                    {(p.groups?.length > 0) && <span className="text-[10px] uppercase text-muted">opções</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <OptionsModal open={!!optionsFor} product={optionsFor?.product} destination={optionsFor?.destination} askQty={optionsFor?.askQty}
        initialQty={qtyNext}
        onCancel={() => { const wasDupla = optionsFor?.body?.launch_mode === 'dupla'; setOptionsFor(null); if (wasDupla) cancelPair('Opções canceladas: par descartado, nada lançado.'); }}
        onConfirm={(o) => {
          const opt = { ...o };
          if (!optionsFor.askQty && optionsFor.product.kind !== 'weight') delete opt.qty; // leitura: quantidade padrão do servidor
          const body = { ...optionsFor.body, ...opt };
          setOptionsFor(null); setQtyNext(1); send(body);
        }} />
      <ExceptionModal open={!!exceptionFor} product={exceptionFor?.product} destination={exceptionFor?.destination} requiresManager={st.exception_requires_manager}
        onCancel={() => setExceptionFor(null)} onConfirm={onException} />
      <PaymentModal open={modal === 'pay'} session={active} onClose={() => setModal(null)}
        onChanged={async (closed) => { if (closed) { const closedId = active?.id; setActiveId(null); setActive(null); toast('Consumo encerrado'); if (s.hasModule('marketing')) setReviewFor(closedId); } else await loadActive(); loadSessions(); }} />
      <ReviewLinkModal sessionId={reviewFor} onClose={() => setReviewFor(null)} />
      <CancelItemModal open={modal === 'cancel'} item={cancelItem} onClose={() => setModal(null)} onDone={() => { toast('Item cancelado'); loadActive(); loadSessions(); }} />
      <TransferModal open={modal === 'transfer'} session={active} sessions={sessions} onClose={() => setModal(null)} onDone={() => { toast('Itens transferidos'); loadActive(); loadSessions(); }} />
      <OpenSessionModal open={modal === 'open'} onClose={() => setModal(null)} onOpened={(id) => { setActiveId(id); loadSessions(); }} />
      <FeeModal open={modal === 'fee'} session={active} onClose={() => setModal(null)} onDone={() => loadActive()} />
      <AttachCustomerModal open={modal === 'customer'} session={active} onClose={() => setModal(null)} onDone={() => { loadActive(); loadSessions(); }} />
      <RedeemModal open={modal === 'redeem'} session={active} onClose={() => setModal(null)} onDone={() => { toast('Pontos resgatados'); loadActive(); }} />
    </div>
  );
}

function SessionsStrip({ sessions, activeId, onPick, onOpen, onCounter, canOpen }) {
  return (
    <div className="border-b border-line p-3">
      <div className="flex gap-2">
        {canOpen && <button className="btn-primary flex-1" onClick={onOpen}><Plus size={16} /> Abrir comanda/mesa</button>}
        {canOpen && <button className="btn-ghost" onClick={onCounter} title="Venda rápida de balcão"><Store size={16} /> Balcão</button>}
      </div>
      <div className="mt-2 flex max-h-28 flex-wrap gap-1 overflow-y-auto" aria-label="Consumos abertos">
        {!sessions.length && <span className="text-sm text-muted">Nenhum consumo aberto.</span>}
        {sessions.map((x) => (
          <button key={x.id} onClick={() => onPick(x.id)} aria-pressed={x.id === activeId}
            className={`rounded-lg border px-2 py-1 text-xs font-semibold ${x.id === activeId ? 'border-copper bg-copper/20' : 'border-line hover:bg-raised'} ${x.suspended ? 'opacity-60' : ''}`}>
            {sessionLabel(x)} {x.status === 'em_fechamento' && '· conta'} {x.suspended && '· suspenso'}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActivePanel({ session: a, last, tz, onPay, onPrint, onCancelItem, onTransfer, onFee, onRequestClose, onCancelSession, onSuspend, onCustomer, onRedeem, onSend, can }) {
  if (!a) {
    return <div className="p-4"><Empty icon={Receipt} title="Nenhum destino selecionado">Selecione um consumo, leia uma comanda ou inicie uma venda de balcão.</Empty>
      {last && <LastLaunch last={last} tz={tz} />}</div>;
  }
  const t = a.totals;
  const items = a.items;
  return (
    <div className="flex flex-col p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-4xl leading-none tracking-wide">{sessionLabel(a)}</div>
          <div className="text-xs text-muted">Aberto {time(a.opened_at, tz)} por {a.opened_by_name || '—'} · {a.status === 'aberta' ? 'aberto' : a.status === 'em_fechamento' ? 'em fechamento' : a.status}</div>
        </div>
        {a.status === 'em_fechamento' && <Badge tone="warn">Conta pedida</Badge>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {a.customer_id ? (
          <span className="chip border-line bg-raised"><UserRound size={12} /> {a.customer_name}{a.customer_points ? ` · ${a.customer_points} pts` : ''}</span>
        ) : a.customer_name ? <span className="chip border-line bg-raised">{a.customer_name}</span> : null}
        {can('clientes.visualizar') && ['aberta', 'em_fechamento'].includes(a.status) && <button className="text-xs underline" onClick={onCustomer}>{a.customer_id ? 'trocar cliente' : 'identificar cliente (CPF)'}</button>}
        {a.customer_id && a.customer_points > 0 && can('pdv.receber') && t.balance > 0 && <button className="text-xs underline" onClick={onRedeem}><Gift size={12} className="inline" /> usar pontos</button>}
      </div>
      {a.pending_send > 0 && (
        <button className="btn-primary mt-2 w-full" onClick={onSend}><ChefHat size={16} /> Enviar à produção ({a.pending_send})</button>
      )}
      <ul className="mt-3 max-h-[40vh] divide-y divide-line overflow-y-auto" aria-label="Itens">
        {!items.length && <li className="py-4 text-sm text-muted">Sem itens lançados.</li>}
        {items.map((i) => (
          <li key={i.id} className={`flex items-start gap-2 py-2 text-sm ${i.status !== 'ativo' ? 'text-muted line-through' : ''}`}>
            <div className="flex-1">
              <div className="font-medium">{qtyFmt(i.qty, i.unit)} × {i.description}</div>
              {!!i.modifiers?.length && <div className="text-xs text-muted">{i.modifiers.map((m) => m.name).join(', ')}</div>}
              {i.notes && <div className="text-xs italic text-muted">Obs.: {i.notes}</div>}
              <div className="text-[10px] uppercase text-muted">{({ manual: 'manual', continua: 'leitura', dupla: 'dupla leitura', excecao: 'exceção', balcao: 'balcão', delivery: 'delivery' })[i.launch_mode]}{i.status === 'ativo' && i.kitchen_status !== 'nao_produz' ? ` · ${i.sent_at ? ({ novo: 'na fila', aceito: 'aceito', preparando: 'preparando', pronto: 'pronto', entregue: 'entregue', cancelado: 'cancelado' })[i.kitchen_status] : 'aguardando envio'}` : ''} · {time(i.created_at, tz)}{i.transferred_from ? ' · transferido' : ''}{i.status !== 'ativo' && i.cancel_reason ? ` · ${i.cancel_reason}` : ''}</div>
            </div>
            <div className="text-right">
              <div>{money(i.total_cents)}</div>
              {i.status === 'ativo' && a.status === 'aberta' && <button className="text-xs text-rust underline" onClick={() => onCancelItem(i)}>cancelar</button>}
            </div>
          </li>
        ))}
      </ul>
      <dl className="mt-3 space-y-0.5 border-t border-line pt-2 text-sm">
        <div className="flex justify-between"><dt>Consumo</dt><dd>{money(t.items)}</dd></div>
        <div className="flex justify-between"><dt>Taxa de serviço {bp(t.serviceFeeBp)} <button className="text-xs underline" onClick={onFee}>ajustar</button></dt><dd>{money(t.serviceFee)}</dd></div>
        {t.deliveryFee > 0 && <div className="flex justify-between"><dt>Taxa de entrega</dt><dd>{money(t.deliveryFee)}</dd></div>}
        <div className="flex justify-between"><dt>Pago</dt><dd>{money(t.paid)}</dd></div>
        <div className="flex justify-between font-display text-3xl"><dt>Saldo</dt><dd>{money(t.balance)}</dd></div>
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {can('pdv.receber') && <button className="btn-primary btn-xl col-span-2" onClick={onPay}><Receipt size={18} /> Receber</button>}
        <button className="btn-ghost" onClick={onPrint}><Printer size={16} /> Pré-conta</button>
        <button className="btn-ghost" onClick={onRequestClose}>{a.status === 'aberta' ? 'Pedir conta' : 'Voltar a lançar'}</button>
        {can('pdv.transferir_item') && <button className="btn-ghost" onClick={onTransfer}><ArrowRightLeft size={16} /> Transferir</button>}
        <button className="btn-ghost" onClick={onSuspend}>{a.suspended ? <><Play size={16} /> Retomar</> : <><Pause size={16} /> Suspender</>}</button>
        <button className="btn-ghost col-span-2 text-rust" onClick={onCancelSession}><Ban size={16} /> Cancelar consumo</button>
      </div>
      {last && <LastLaunch last={last} tz={tz} />}
    </div>
  );
}

function LastLaunch({ last, tz }) {
  return (
    <div className="mt-3 rounded-lg border border-ok/40 bg-ok/10 p-2 text-sm" aria-live="polite">
      <div className="text-xs font-semibold uppercase text-ok">Último lançamento {last.replay ? '(recuperado)' : ''} · {time(last.at, tz)}</div>
      <div>{qtyFmt(last.qty)} × {last.product} — {money(last.total_cents)} → <b>{last.destination}</b></div>
    </div>
  );
}

function OpenSessionModal({ open, onClose, onOpened }) {
  const [kind, setKind] = useState('comanda');
  const [cards, setCards] = useState([]);
  const [tables, setTables] = useState([]);
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState(null);
  const [err, setErr] = useState(null);
  const [pickerKey, setPickerKey] = useState(0);
  useEffect(() => {
    if (!open) return;
    setErr(null); setPick(''); setName(''); setCustomer(null); setPickerKey((k) => k + 1);
    api('/api/floor/cards').then((r) => setCards(r.cards)).catch(() => {});
    api('/api/floor/tables').then((r) => setTables(r.tables)).catch(() => {});
  }, [open]);
  const free = cards.filter((c) => c.status === 'ativo' && !c.session_id);
  const go = async () => {
    try {
      const body = { kind, customer_name: name || undefined, customer_id: customer?.id || undefined };
      if (kind === 'comanda') { const c = free.find((x) => String(x.number) === String(pick)); if (!c) throw new Error('Comanda livre não encontrada'); body.card_id = c.id; }
      if (kind === 'mesa') body.table_id = Number(pick);
      if (kind === 'retirada') body.label = name ? `Retirada ${name}` : 'Retirada';
      const r = await api('/api/pdv/sessions', { method: 'POST', body });
      onOpened(r.id); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Abrir consumo" footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={go}>Abrir</button></>}>
      <div className="grid grid-cols-3 gap-2">
        {[['comanda', 'Comanda'], ['mesa', 'Mesa'], ['retirada', 'Retirada']].map(([k, l]) => (
          <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setPick(''); }} className={`rounded-lg border p-3 font-semibold ${kind === k ? 'border-copper bg-copper/15' : 'border-line'}`}>{l}</button>
        ))}
      </div>
      {kind === 'comanda' && (
        <Field label={`Número da comanda (${free.length} livres)`} className="mt-3">
          <input className="input text-2xl" inputMode="numeric" list="free-cards" value={pick} onChange={(e) => setPick(e.target.value)} />
          <datalist id="free-cards">{free.slice(0, 200).map((c) => <option key={c.id} value={c.number} />)}</datalist>
        </Field>
      )}
      {kind === 'mesa' && (
        <div className="mt-3 grid grid-cols-5 gap-2">
          {tables.map((t) => (
            <button key={t.id} onClick={() => setPick(String(t.id))} aria-pressed={pick === String(t.id)}
              className={`rounded-lg border p-2 text-center ${pick === String(t.id) ? 'border-copper bg-copper/15' : 'border-line'}`}>
              <div className="font-display text-2xl">{t.number}</div><div className="text-[10px] uppercase text-muted">{t.status}{t.open_sessions ? ` · ${t.open_sessions}` : ''}</div>
            </button>
          ))}
        </div>
      )}
      <div className="mt-3"><CustomerPicker key={pickerKey} onChange={setCustomer} onName={setName} /></div>
      <Field label="Nome do cliente (opcional)" className="mt-3"><input className="input" value={name} onChange={(e) => setName(e.target.value)} readOnly={!!customer} data-customer-name /></Field>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function FeeModal({ open, session, onClose, onDone }) {
  const s = useSession();
  const [pct, setPct] = useState('10');
  const [reason, setReason] = useState('');
  const [token, setToken] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (open && session) { setPct(String(session.totals.serviceFeeBp / 100)); setReason(''); setToken(null); setErr(null); } }, [open, session]);
  const needs = !s.can('pdv.taxa_servico');
  const go = async () => {
    try {
      const v = Math.round(Number(String(pct).replace(',', '.')) * 100);
      if (!(v >= 0 && v <= 3000)) throw new Error('Percentual entre 0 e 30');
      await api(`/api/pdv/sessions/${session.id}/service-fee`, { method: 'POST', body: { bp: v, reason, authorization: token || undefined } });
      onDone(); onClose();
    } catch (e) { setErr(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Taxa de serviço" footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={reason.trim().length < 3 || (needs && !token)} onClick={go}>Aplicar</button></>}>
      <p className="text-sm text-muted">A taxa aparece discriminada na conta e pode ser ajustada ou retirada a pedido do cliente.</p>
      <Field label="Percentual (%)" className="mt-3"><input className="input" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>
      <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {needs && <div className="mt-3"><ManagerAuth action="taxa_servico" reason={reason} onToken={setToken} /></div>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function AttachCustomerModal({ open, session, onClose, onDone }) {
  const [customer, setCustomer] = useState(null);
  const [err, setErr] = useState(null);
  const [k, setK] = useState(0);
  useEffect(() => { if (open) { setCustomer(null); setErr(null); setK((x) => x + 1); } }, [open]);
  const go = async (id) => {
    try { await api('/api/customers/attach', { method: 'POST', body: { session_id: session.id, customer_id: id } }); onDone(); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Identificar cliente"
      footer={<>{session?.customer_id && <button className="btn-ghost mr-auto" onClick={() => go(null)}>Remover cliente</button>}<button className="btn-ghost" onClick={onClose}>Voltar</button>
        <button className="btn-primary" disabled={!customer} onClick={() => go(customer.id)}>Vincular</button></>}>
      <CustomerPicker key={k} onChange={setCustomer} autoFocus />
      <p className="mt-2 text-xs text-muted">O cliente identificado acumula pontos no encerramento (se o programa de fidelidade estiver ligado) e o consumo entra no histórico dele.</p>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

function RedeemModal({ open, session, onClose, onDone }) {
  const [pts, setPts] = useState('');
  const [err, setErr] = useState(null);
  const [cfg, setCfg] = useState(null);
  useEffect(() => { if (open) { setPts(''); setErr(null); api('/api/customers/summary').then((r) => setCfg(r.loyalty)).catch(() => {}); } }, [open]);
  const n = Number(pts) || 0;
  const value = cfg ? n * cfg.point_value_cents : 0;
  const go = async () => {
    try { await api(`/api/customers/${session.customer_id}/redeem`, { method: 'POST', body: { session_id: session.id, points: n, idempotency_key: newKey() } }); onDone(); onClose(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Usar pontos" footer={<><button className="btn-ghost" onClick={onClose}>Voltar</button><button className="btn-primary" disabled={!n} onClick={go}>Resgatar {money(value)}</button></>}>
      <p className="text-sm">{session?.customer_name} tem <b>{session?.customer_points}</b> pontos{cfg ? ` (cada ponto vale ${money(cfg.point_value_cents)}; mínimo ${cfg.min_redeem})` : ''}.</p>
      <Field label="Pontos a usar" className="mt-3"><input className="input text-2xl" inputMode="numeric" value={pts} onChange={(e) => setPts(e.target.value.replace(/\D/g, ''))} /></Field>
      <p className="mt-2 text-xs text-muted">O resgate entra como pagamento "vale". Se o pagamento for estornado, os pontos voltam ao cliente.</p>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

// Depois do fechamento: QR/link para o cliente avaliar a experiência (uma avaliação por consumo)
function ReviewLinkModal({ sessionId, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!sessionId) { setD(null); return; }
    api(`/api/marketing/review-link/${sessionId}`).then(async (r) => {
      const url = `${location.origin}${r.path}`;
      const QR = (await import('qrcode')).default;
      setD({ url, qr: await QR.toDataURL(url, { margin: 1, width: 220 }) });
    }).catch(() => onClose());
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!sessionId || !d) return null;
  const print = () => {
    const w = window.open('', '_blank', 'width=320,height=480'); if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Avalie</title><style>body{font-family:monospace;text-align:center;margin:12px}</style></head><body>
      <b>Como foi sua experiência?</b><br><img src="${d.qr}" width="200"><br><small>Aponte a câmera para avaliar</small><script>window.print()</script></body></html>`);
    w.document.close();
  };
  return (
    <Modal open onClose={onClose} title="Avaliação do cliente" footer={<><button className="btn-ghost" onClick={print}><Printer size={16} /> Imprimir QR</button><button className="btn-primary" onClick={onClose}>Concluir</button></>}>
      <div className="text-center">
        <img src={d.qr} alt="QR para avaliar" className="mx-auto rounded bg-white p-2" width={200} height={200} />
        <p className="mt-2 text-sm">Mostre ao cliente ou imprima: ele avalia de 1 a 5 estrelas pelo celular.</p>
        <p className="mt-1 break-all font-mono text-[11px] text-muted">{d.url}</p>
      </div>
    </Modal>
  );
}
