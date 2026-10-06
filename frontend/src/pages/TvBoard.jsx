// Painel da TV: um painel por setor com demanda (ex.: Cozinha | Bar, dividindo a tela; um só setor ocupa a tela toda),
// com a fila em preparo, os prontos e a chamada chamativa (som e voz) quando o pedido fica pronto ou é chamado.
// Configuração por TV (guardada neste aparelho): fundo, som, voz, tipo de letra, tempo de destaque e o que exibir.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Maximize2, Settings2, Volume2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';
import { useBrandImage } from '../lib/brand.js';

export const BACKGROUNDS = {
  noite: { label: 'Noite', css: 'radial-gradient(circle at 20% 10%, #2a2a33 0%, #0b0b0f 60%)', ink: '#fff', accent: '#ffb347' },
  cobre: { label: 'Cobre', css: 'linear-gradient(135deg, #3b1d0e 0%, #8a4b22 55%, #c27a3c 100%)', ink: '#fff7ec', accent: '#ffe08a' },
  neon: { label: 'Neon', css: 'radial-gradient(circle at 80% 20%, #4b0082 0%, #0a0015 55%), #0a0015', ink: '#f6f0ff', accent: '#39ff14' },
  oceano: { label: 'Oceano', css: 'linear-gradient(160deg, #001f3f 0%, #0074d9 100%)', ink: '#ffffff', accent: '#7fdbff' },
  quadro: { label: 'Quadro-negro', css: 'repeating-linear-gradient(45deg, #1e2b22 0 14px, #1b2720 14px 28px)', ink: '#f5f5e8', accent: '#ffd23f' },
  claro: { label: 'Claro', css: 'linear-gradient(180deg, #fffaf2 0%, #f3e6d3 100%)', ink: '#1d1208', accent: '#b5541c' },
  marca: { label: 'Cor da marca', css: null, ink: '#ffffff', accent: '#ffe08a' },
  empresa: { label: 'Imagem da empresa', css: null, ink: '#ffffff', accent: '#ffcc33' },
  imagem: { label: 'Imagem (endereço)', css: null, ink: '#ffffff', accent: '#ffcc33' },
};
export const FONTS = {
  bebas: { label: 'Bebas (padrão)', family: '"Bebas Neue", Impact, sans-serif' },
  anton: { label: 'Anton (impacto)', family: 'Anton, Impact, sans-serif' },
  bungee: { label: 'Bungee (letreiro)', family: 'Bungee, Impact, sans-serif' },
  marker: { label: 'Pincel (quadro)', family: '"Permanent Marker", cursive' },
  righteous: { label: 'Righteous (retrô)', family: 'Righteous, sans-serif' },
  inter: { label: 'Inter (limpa)', family: 'Inter, system-ui, sans-serif' },
  mono: { label: 'Mono (digital)', family: '"JetBrains Mono", monospace' },
};
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Anton&family=Bungee&family=Permanent+Marker&family=Righteous&display=swap';
export const SOUNDS = { sino: 'Sino', campainha: 'Campainha de balcão', fanfarra: 'Fanfarra', arcade: 'Arcade', suave: 'Suave', nenhum: 'Sem som' };
export const DEFAULTS = { bg: 'noite', image: '', font: 'bebas', sound: 'fanfarra', volume: 0.8, voice: true, seconds: 10, fireworks: true, fireworksSound: true, showName: true, showItems: true, showQueue: true, title: 'Pedidos',
  showLogo: true, showClock: true, logoSize: 9, scale: 1, overlay: 0.35, ink: '', accent: '', readyLabel: 'Pronto para retirar', queueLabel: 'Em preparo', emptyLabel: 'Nenhum pedido no momento',
  ticker: '', voiceText: 'Seu pedido está pronto!', voiceRate: 0.95, cardStyle: 'solido' };
const KEY = 'rusten.tv';
// esta TV tem estilo próprio? (senão vale o padrão salvo pela empresa)
const local = () => { try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; } };
const load = () => ({ ...DEFAULTS, ...(local() || {}) });
const pickTv = (c) => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, c[k] ?? DEFAULTS[k]]));

let audio;
// Sons sintetizados (não dependem de arquivos): cada um é uma sequência de notas
export function playSound(kind, volume = 0.8) {
  if (kind === 'nenhum') return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime + 0.02;
    const note = (f, start, dur, type = 'sine', gain = 0.25) => {
      const o = audio.createOscillator(); const g = audio.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0 + start);
      g.gain.setValueAtTime(0.0001, t0 + start);
      g.gain.exponentialRampToValueAtTime(gain * volume, t0 + start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g); g.connect(audio.destination); o.start(t0 + start); o.stop(t0 + start + dur + 0.05);
    };
    const seq = {
      sino: () => { note(1318.5, 0, 1.6, 'sine', 0.35); note(1975.5, 0, 1.2, 'sine', 0.12); note(1046.5, 0.45, 1.8, 'sine', 0.3); },
      campainha: () => { for (const s of [0, 0.32]) { note(2637, s, 0.6, 'triangle', 0.3); note(3520, s, 0.4, 'sine', 0.12); } },
      fanfarra: () => { [[523.3, 0], [659.3, 0.16], [784, 0.32], [1046.5, 0.5]].forEach(([f, s]) => note(f, s, s === 0.5 ? 0.9 : 0.18, 'sawtooth', 0.14)); note(1046.5, 0.5, 0.9, 'square', 0.06); },
      arcade: () => { [880, 1175, 1568, 2093, 1568, 2093].forEach((f, i) => note(f, i * 0.09, 0.12, 'square', 0.1)); },
      suave: () => { note(659.3, 0, 0.9, 'sine', 0.25); note(880, 0.25, 1.2, 'sine', 0.2); },
    };
    (seq[kind] || seq.sino)();
  } catch { /* sem áudio: o destaque visual continua */ }
}
// Estouros dos fogos: ruído filtrado com queda rápida (boom) e estalinhos (crackle)
export function playFireworks(volume = 0.8) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const len = audio.sampleRate * 1.2; const buf = audio.createBuffer(1, len, audio.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const boom = (at, gain, freq) => {
      const src = audio.createBufferSource(); src.buffer = buf;
      const f = audio.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      const g = audio.createGain(); const t = audio.currentTime + at;
      g.gain.setValueAtTime(gain * volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      src.connect(f); f.connect(g); g.connect(audio.destination); src.start(t); src.stop(t + 1.2);
    };
    const crackle = (at) => {
      for (let i = 0; i < 14; i++) {
        const src = audio.createBufferSource(); src.buffer = buf;
        const f = audio.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3000;
        const g = audio.createGain(); const t = audio.currentTime + at + Math.random() * 0.7;
        g.gain.setValueAtTime(0.18 * volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        src.connect(f); f.connect(g); g.connect(audio.destination); src.start(t, Math.random()); src.stop(t + 0.05);
      }
    };
    [[0, 0.9, 900], [0.45, 0.7, 700], [0.9, 0.8, 1100], [1.6, 0.6, 800]].forEach(([at, g, f]) => { boom(at, g, f); crackle(at + 0.15); });
  } catch { /* sem áudio */ }
}
const label = (o) => (o.kind === 'mesa' ? 'Mesa' : o.kind === 'delivery' || o.kind === 'retirada' ? 'Pedido' : 'Comanda');
export function speak(o, cfg) {
  if (!cfg.voice || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(`${label(o)} ${o.code.replace('#', '')}${cfg.showName && o.name ? `, ${o.name}` : ''}. ${cfg.voiceText || DEFAULTS.voiceText}${o.__multi && o.sector ? ` Retirada: ${o.sector}.` : ''}`);
    u.lang = 'pt-BR'; u.rate = cfg.voiceRate || 0.95; u.volume = Math.min(1, cfg.volume + 0.2);
    const v = window.speechSynthesis.getVoices().find((x) => /pt[-_]BR/i.test(x.lang) && /female|mulher|maria|luciana|francisca/i.test(x.name))
      || window.speechSynthesis.getVoices().find((x) => /pt[-_]BR/i.test(x.lang));
    if (v) u.voice = v;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  } catch { /* sem voz */ }
}

export default function TvBoard() {
  const s = useSession();
  const [cfg, setCfg] = useState(load);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [started, setStarted] = useState(false);
  const [showCfg, setShowCfg] = useState(false);
  const [spot, setSpot] = useState(null); // pedido em destaque
  const queue = useRef([]);
  const known = useRef(null); // id → marca (pronto/chamado) já anunciada
  const save = (patch) => setCfg((c) => { const n = { ...c, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* sem armazenamento */ } return n; });
  const [company, setCompany] = useState(null); // padrão das TVs da empresa
  useEffect(() => {
    api('/api/brand/tv').then((t) => { setCompany(t || {}); if (t && !local()) setCfg({ ...DEFAULTS, ...t }); }).catch(() => setCompany({}));
  }, []);
  const logo = useBrandImage('logo', cfg.showLogo ? s.me?.brand?.logo_v : null);
  const tvImg = useBrandImage('tv_fundo', cfg.bg === 'empresa' ? s.me?.brand?.tv_fundo_v : null);
  const sysImg = useBrandImage('fundo', cfg.bg === 'empresa' && !s.me?.brand?.tv_fundo_v ? s.me?.brand?.fundo_v : null);
  const brandAccent = s.me?.company?.settings?.appearance?.accent || '#ce8a48';

  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_CSS}"]`)) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_CSS; document.head.appendChild(l);
  }, []);

  const announce = useCallback((o) => {
    setSpot(o);
    playSound(cfg.sound, cfg.volume);
    if (cfg.fireworks && cfg.fireworksSound) setTimeout(() => playFireworks(cfg.volume), 350);
    setTimeout(() => speak(o, cfg), cfg.sound === 'nenhum' ? 400 : 1300);
  }, [cfg]);

  // Atualização: consulta a cada 2 s e na hora quando a Cozinha avisa (mesmo navegador) ou a tela volta a ficar visível.
  // Cada pedido aparece no painel do seu setor (chave comanda+setor). Entra no destaque quando ganha item pronto
  // (ready_at novo) ou quando alguém toca "Chamar na TV" naquele setor (called_at novo).
  const enqueue = (o) => { queue.current = queue.current.filter((x) => x.key !== o.key); queue.current.push(o); };
  const busy = useRef(false);
  const load2 = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api('/api/kitchen/board');
      // compatibilidade: API antiga sem setores vira um painel só
      if (!r.areas) r.areas = r.orders?.length ? [{ id: 0, name: '', orders: r.orders.map((o) => ({ ...o, key: String(o.id) })) }] : [];
      setData(r); setErr(null);
      const multi = r.areas.length > 1;
      const all = r.areas.flatMap((a) => a.orders.map((o) => ({ ...o, sector: o.sector || a.name, __multi: multi })));
      const marks = new Map(all.map((o) => [o.key, { ready: o.ready_count > 0 ? o.ready_at : null, called: o.called_at || null }]));
      if (known.current) {
        for (const o of all) {
          const prev = known.current.get(o.key) || {};
          const m = marks.get(o.key);
          const nowReady = m.ready && m.ready !== prev.ready;
          const called = m.called && m.called !== prev.called;
          if (nowReady || called) enqueue({ ...o, __called: called && !nowReady });
        }
      }
      known.current = marks;
    } catch (e) { setErr(e); } finally { busy.current = false; }
  }, []);
  useEffect(() => {
    load2();
    const t = setInterval(load2, 2000);
    const vis = () => { if (document.visibilityState === 'visible') load2(); };
    let ch;
    try { ch = new BroadcastChannel('rusten-kds'); ch.onmessage = () => load2(); } catch { /* navegador sem BroadcastChannel: fica a consulta periódica */ }
    window.addEventListener('online', load2); document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); ch?.close(); window.removeEventListener('online', load2); document.removeEventListener('visibilitychange', vis); };
  }, [load2]);

  // um destaque por vez, com a duração configurada
  const spotRef = useRef(null);
  useEffect(() => {
    if (!started) return undefined;
    const t = setInterval(() => {
      if (spotRef.current && Date.now() - spotRef.current.__at < cfg.seconds * 1000) return;
      const next = queue.current.shift();
      if (next) { const o = { ...next, __at: Date.now() }; spotRef.current = o; announce(o); }
      else if (spotRef.current) { spotRef.current = null; setSpot(null); }
    }, 300);
    return () => clearInterval(t);
  }, [started, cfg.seconds, announce]);

  const base = BACKGROUNDS[cfg.bg] || BACKGROUNDS.noite;
  const bg = { ...base, ink: cfg.ink || base.ink, accent: cfg.accent || base.accent };
  const veil = `linear-gradient(rgba(0,0,0,${cfg.overlay}), rgba(0,0,0,${cfg.overlay}))`;
  const imgUrl = cfg.bg === 'imagem' ? cfg.image : cfg.bg === 'empresa' ? (tvImg || sysImg) : null;
  const background = imgUrl ? `${veil}, center/cover no-repeat url("${String(imgUrl).replace(/"/g, '')}"), #000`
    : cfg.bg === 'marca' ? `radial-gradient(circle at 20% 0%, ${brandAccent} 0%, #140c06 75%)` : (base.css || BACKGROUNDS.noite.css);
  const font = (FONTS[cfg.font] || FONTS.bebas).family;
  const areas = (data?.areas || []).filter((a) => a.orders.length);
  const start = () => { setStarted(true); playSound('suave', cfg.volume * 0.5); document.documentElement.requestFullscreen?.().catch(() => {}); };
  const sample = () => areas.flatMap((a) => a.orders.map((o) => ({ ...o, sector: o.sector || a.name, __multi: areas.length > 1 })))
    .sort((a, b) => (b.status === 'pronto') - (a.status === 'pronto'))[0];

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden" style={{ background, color: bg.ink, fontFamily: font }} data-tv data-tv-areas={areas.length}>
      <style>{`
        @keyframes tvPop { 0% { transform: scale(.2) rotate(-8deg); opacity: 0 } 60% { transform: scale(1.12) rotate(2deg); opacity: 1 } 100% { transform: scale(1) rotate(0) } }
        @keyframes tvPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
        @keyframes tvShine { 0% { background-position: 0% 50% } 100% { background-position: 200% 50% } }
        @keyframes tvRay { to { transform: rotate(360deg) } }
        @keyframes tvFall { 0% { transform: translateY(-10vh) rotate(0) } 100% { transform: translateY(110vh) rotate(720deg) } }
        @keyframes tvBlink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
        @keyframes tvFlash { 0% { opacity: .9 } 100% { opacity: 0 } }
        @keyframes tvHalo { 0%,100% { transform: scale(.85); opacity: .6 } 50% { transform: scale(1.15); opacity: 1 } }
        @keyframes tvShake { 0%,100% { transform: translate(0,0) } 15% { transform: translate(-1.2vw,.6vw) } 30% { transform: translate(1vw,-.8vw) } 45% { transform: translate(-.6vw,.4vw) } 60% { transform: translate(.4vw,-.2vw) } }
        @keyframes tvIn { from { opacity: 0; transform: scale(.96) } to { opacity: 1; transform: scale(1) } }
        @keyframes tvTicker { from { transform: translateX(100vw) } to { transform: translateX(-100%) } }
      `}</style>
      {/* cabeçalho */}
      <div className="flex items-center justify-between px-[3vw] pt-[2vh]">
        <div className="flex min-w-0 items-center gap-[1.5vw]">
          {cfg.showLogo && logo && <img src={logo} alt="" style={{ maxHeight: `${cfg.logoSize}vh`, maxWidth: '28vw', width: 'auto', height: 'auto' }} className="block shrink-0 object-contain" data-tv-logo />}
          <div className="truncate leading-none tracking-wide" style={{ fontSize: `${4.2 * cfg.scale}vw` }}>{cfg.title}{areas.length === 1 && areas[0].name ? <span className="opacity-60"> · {areas[0].name}</span> : null}</div>
        </div>
        <div className="flex items-center gap-3 text-[1.6vw] opacity-80">
          {cfg.showClock && <span style={{ fontSize: `${1.6 * cfg.scale}vw` }}><Clock /></span>}
          <button onClick={() => setShowCfg(true)} className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label="Configurar painel"><Settings2 size={22} /></button>
          <button onClick={() => document.documentElement.requestFullscreen?.()} className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label="Tela cheia"><Maximize2 size={22} /></button>
          <Link to="/cozinha" className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label="Voltar"><ArrowLeft size={22} /></Link>
        </div>
      </div>
      {/* um painel por setor com demanda: dois setores dividem a tela ao meio; um só ocupa a tela toda */}
      <div className="flex min-h-0 flex-1 gap-[1.5vw] px-[2vw] pb-[2vh] pt-[2vh]">
        {areas.length ? areas.map((a) => <Area key={a.id} a={a} n={areas.length} cfg={cfg} bg={bg} />) : (
          <div className="grid flex-1 place-items-center rounded-[2vw] text-[3vw] opacity-50" style={{ background: 'rgba(0,0,0,.18)' }} data-tv-empty>{cfg.emptyLabel}</div>
        )}
      </div>
      {cfg.ticker && (
        <div className="overflow-hidden whitespace-nowrap py-[1vh]" style={{ background: 'rgba(0,0,0,.35)', color: bg.accent, fontSize: `${2 * cfg.scale}vw` }} data-tv-ticker>
          <span className="inline-block" style={{ animation: `tvTicker ${Math.max(12, cfg.ticker.length / 4)}s linear infinite` }}>{cfg.ticker}</span>
        </div>
      )}
      {err && <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm text-white" style={{ fontFamily: 'Inter, sans-serif' }}>Sem conexão — tentando de novo…</div>}

      {/* destaque extravagante */}
      {spot && <Spotlight o={spot} cfg={cfg} bg={bg} />}

      {!started && (
        <button className="absolute inset-0 grid place-items-center bg-black/70 text-white" onClick={start} data-tv-start>
          <span className="text-center">
            <Volume2 className="mx-auto" size={64} />
            <span className="mt-4 block text-[4vw] leading-none">Toque para iniciar o painel</span>
            <span className="mt-2 block text-[1.4vw] opacity-80" style={{ fontFamily: 'Inter, sans-serif' }}>O navegador só libera som e tela cheia depois de um toque. {s.me?.company?.name}</span>
          </span>
        </button>
      )}
      {showCfg && <TvSettings cfg={cfg} save={save} company={company} logo={!!s.me?.brand?.logo_v} hasImg={!!(s.me?.brand?.tv_fundo_v || s.me?.brand?.fundo_v)}
        canDefault={s.can('configuracoes.gerenciar')}
        onSaveDefault={async () => { const t = pickTv(cfg); await api('/api/brand/tv', { method: 'PUT', body: t }); setCompany(t); }}
        onUseDefault={() => { try { localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } setCfg({ ...DEFAULTS, ...(company || {}) }); }}
        onClose={() => setShowCfg(false)} onTest={() => { const o = sample() || { id: 0, key: 'teste', code: '12', kind: 'comanda', name: 'Ana', sector: 'Bar', __multi: true, items: [{ d: 'Caipirinha', q: 1 }] }; queue.current.unshift({ ...o, __test: true }); spotRef.current = null; setShowCfg(false); }} />}
    </div>
  );
}

// Painel de um setor: "Pronto para retirar" em destaque e a fila "Em preparo". Tamanhos acompanham quantos setores dividem a tela.
function Area({ a, n, cfg, bg }) {
  const preparing = a.orders.filter((o) => o.status === 'preparando' || o.pending > 0);
  const ready = a.orders.filter((o) => o.status === 'pronto').sort((x, y) => new Date(y.called_at || y.ready_at) - new Date(x.called_at || x.ready_at));
  const k = (n === 1 ? 1 : n === 2 ? 0.72 : 0.56) * (cfg.scale || 1); // escala das letras
  const v = (x) => `${(x * k).toFixed(2)}vw`;
  const split = n > 1; // dividido: prontos em cima, fila embaixo
  const readyCols = n === 1 ? 3 : 2;
  const queueCols = n === 1 ? 3 : n === 2 ? 3 : 2;
  const Ready = (
    <section className="flex min-h-0 flex-col rounded-[1.6vw] p-[1.2vw]" style={{ flex: split ? '3 1 0' : '1.5 1 0', background: 'rgba(0,0,0,.18)', boxShadow: `inset 0 0 0 .3vw ${bg.accent}55` }}>
      <h2 className="leading-none" style={{ color: bg.accent, fontSize: v(2.8) }}>{cfg.readyLabel}</h2>
      <div className="mt-[1.2vh] grid flex-1 auto-rows-min gap-[1vw] overflow-hidden" style={{ gridTemplateColumns: `repeat(${readyCols}, minmax(0,1fr))` }}>
        {ready.map((o, i) => (
          <div key={o.key} className="rounded-[1.2vw] px-[1vw] py-[1vh] text-center" data-tv-ready={o.code}
            style={{ ...card(cfg, bg, i === 0), animation: i === 0 ? 'tvPulse 1.6s ease-in-out infinite' : undefined }}>
            <div className="uppercase opacity-70" style={{ fontSize: v(1.2) }}>{label(o)}{o.table ? ` · mesa ${o.table}` : ''}</div>
            <div className="leading-none" style={{ fontSize: v(5.5) }}>{o.code}</div>
            {cfg.showName && o.name && <div className="truncate" style={{ fontSize: v(1.6) }}>{o.name}</div>}
            {o.pending > 0 && <div className="opacity-70" style={{ fontSize: v(1) }}>+{o.pending} em preparo</div>}
          </div>
        ))}
        {!ready.length && <div className="opacity-50" style={{ gridColumn: '1 / -1', fontSize: v(1.8) }}>Aguardando pedidos prontos…</div>}
      </div>
    </section>
  );
  const Queue = cfg.showQueue && (
    <section className="flex min-h-0 flex-col rounded-[1.6vw] p-[1.2vw]" style={{ flex: split ? '2 1 0' : '1 1 0', background: 'rgba(0,0,0,.28)' }}>
      <h2 className="leading-none opacity-80" style={{ fontSize: v(2.6) }}>{cfg.queueLabel} <span className="opacity-60">({preparing.length})</span></h2>
      <div className="mt-[1.2vh] grid flex-1 auto-rows-min gap-[0.8vw] overflow-hidden" style={{ gridTemplateColumns: `repeat(${queueCols}, minmax(0,1fr))` }}>
        {preparing.map((o) => (
          <div key={o.key} className="rounded-[1vw] px-[0.8vw] py-[0.8vh] text-center" style={card(cfg, bg, false, true)} data-tv-preparing={o.code}>
            <div className="uppercase opacity-60" style={{ fontSize: v(1) }}>{label(o)}</div>
            <div className="leading-none" style={{ fontSize: v(3.6) }}>{o.code}</div>
            {cfg.showName && o.name && <div className="truncate opacity-80" style={{ fontSize: v(1.2) }}>{o.name}</div>}
            {o.ready_count > 0 && <div className="opacity-70" style={{ fontSize: v(0.9), color: bg.accent }}>parte pronta</div>}
          </div>
        ))}
        {!preparing.length && <div className="opacity-50" style={{ gridColumn: '1 / -1', fontSize: v(1.6) }}>Nada na fila.</div>}
      </div>
    </section>
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-[1vh]" style={{ flex: '1 1 0', animation: 'tvIn .5s ease-out both' }} data-tv-area={a.name}>
      {split && (
        <div className="flex items-baseline justify-between px-[0.5vw]">
          <div className="uppercase leading-none tracking-wide" style={{ fontSize: v(3.4), color: bg.accent }}>{a.name}</div>
          <div className="opacity-70" style={{ fontSize: v(1.4) }}>{ready.length} pronto(s) · {preparing.length} em preparo</div>
        </div>
      )}
      <div className={`flex min-h-0 flex-1 gap-[1.2vw] ${split ? 'flex-col' : 'flex-row-reverse'}`}>
        {Ready}
        {Queue}
      </div>
    </div>
  );
}

// estilo dos cartões: sólido (padrão), vidro (translúcido) ou contorno
function card(cfg, bg, first, queue = false) {
  if (cfg.cardStyle === 'contorno') return { background: first ? `${bg.accent}22` : 'transparent', border: `.25vw solid ${first ? bg.accent : `${bg.ink}55`}`, color: bg.ink };
  if (cfg.cardStyle === 'vidro') return { background: first ? `${bg.accent}cc` : 'rgba(255,255,255,.14)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,.25)', color: first ? '#111' : bg.ink };
  return { background: first ? bg.accent : queue ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.12)', color: first ? '#111' : bg.ink };
}

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 15000); return () => clearInterval(i); }, []);
  return <span>{t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>;
}

const CONFETTI = Array.from({ length: 46 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 10) * 0.22, dur: 2.4 + (i % 5) * 0.5, hue: (i * 47) % 360, size: 0.8 + (i % 4) * 0.4 }));
function Spotlight({ o, cfg, bg }) {
  const items = (o.items || []).filter((x) => (o.__called || o.__test ? true : x.ready !== false));
  const glow = `0 0 1.2vw #fff, 0 0 3vw ${bg.accent}, 0 0 6vw ${bg.accent}, 0 0 10vw #ff3d00`;
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-hidden" style={{ background: 'rgba(0,0,0,.94)', animation: 'tvShake .6s ease-out both' }} data-tv-spot={o.code}>
      <div className="absolute left-1/2 top-1/2 h-[220vmax] w-[220vmax] -translate-x-1/2 -translate-y-1/2 opacity-30"
        style={{ background: `repeating-conic-gradient(${bg.accent} 0 10deg, transparent 10deg 20deg)`, animation: 'tvRay 12s linear infinite' }} />
      {cfg.fireworks !== false && <Fireworks accent={bg.accent} />}
      <div className="pointer-events-none absolute inset-0" style={{ background: '#fff', animation: 'tvFlash 1.2s ease-out both' }} />
      {CONFETTI.map((c, i) => <span key={i} className="absolute top-0 block rounded-sm" style={{ left: `${c.left}%`, width: `${c.size}vw`, height: `${c.size * 1.6}vw`, background: `hsl(${c.hue} 90% 60%)`, animation: `tvFall ${c.dur}s ${c.delay}s linear infinite` }} />)}
      <div className="relative text-center" style={{ animation: 'tvPop .8s cubic-bezier(.2,1.6,.4,1) both' }}>
        {o.sector && <div className="mx-auto mb-[1vh] inline-block rounded-full px-[2vw] py-[0.6vh] text-[2.6vw] uppercase leading-none" style={{ background: bg.accent, color: '#111' }} data-tv-spot-sector>{o.sector}</div>}
        <div className="text-[4.2vw] uppercase leading-none" style={{ color: bg.accent, animation: 'tvBlink .8s step-end infinite', textShadow: '0 0 2vw rgba(0,0,0,.8)' }}>
          {o.__called && o.status !== 'pronto' ? 'Atenção!' : 'Pedido pronto!'}
        </div>
        <div className="mt-[1vh] text-[4.4vw] uppercase leading-none text-white">{label(o)}</div>
        <div className="relative inline-block">
          <span className="absolute inset-[-4vw] rounded-full" style={{ background: `radial-gradient(circle, ${bg.accent}66 0%, transparent 65%)`, animation: 'tvHalo 1.4s ease-in-out infinite' }} />
          <div className="relative text-[26vw] leading-[0.85]" style={{ color: '#fff', textShadow: glow, animation: 'tvPulse 1.1s ease-in-out infinite' }}>{o.code}</div>
        </div>
        {o.table && <div className="text-[3vw] text-white">Mesa {o.table}</div>}
        {cfg.showName && o.name && <div className="text-[6vw] leading-none text-white" style={{ textShadow: `0 0 2vw ${bg.accent}` }}>{o.name}</div>}
        {cfg.showItems && !!items.length && (
          <div className="mx-auto mt-[2vh] max-w-[70vw] rounded-[1vw] bg-black/40 px-[2vw] py-[1vh] text-[2.2vw] leading-tight text-white/95" style={{ fontFamily: 'Inter, sans-serif' }}>
            {items.slice(0, 6).map((x) => `${x.q}× ${x.d}`).join(' · ')}
            {o.pending > 0 && !o.__called && <div className="text-[1.5vw] opacity-80">O restante do pedido ainda está em preparo.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

/* Fogos de artifício em canvas: foguetes sobem, explodem em várias cores (anel, esfera, chuva) e deixam rastro. */
function Fireworks({ accent }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return undefined;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fit = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
    fit(); window.addEventListener('resize', fit);
    const W = () => cv.width; const H = () => cv.height;
    const palette = [accent, '#ff3d3d', '#ffd23f', '#3dff8b', '#3dc6ff', '#c13dff', '#ffffff', '#ff8a00'];
    const rockets = []; const parts = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const launch = (x) => rockets.push({ x: x ?? rnd(0.12, 0.88) * W(), y: H(), vx: rnd(-1, 1) * dpr, vy: -rnd(11, 15) * dpr * (H() / (900 * dpr)) ** 0.5, ty: rnd(0.12, 0.42) * H(), color: palette[(Math.random() * palette.length) | 0] });
    const burst = (r) => {
      const kind = Math.random(); const n = kind < 0.3 ? 70 : 120; const c2 = palette[(Math.random() * palette.length) | 0];
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + rnd(-0.05, 0.05);
        const sp = (kind < 0.3 ? 6 : rnd(1.5, 7.5)) * dpr;
        parts.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: rnd(0.008, 0.018), color: i % 3 ? r.color : c2, size: rnd(1.6, 3.2) * dpr, willow: kind > 0.8 });
      }
      for (let i = 0; i < 18; i++) parts.push({ x: r.x, y: r.y, vx: rnd(-2, 2) * dpr, vy: rnd(-2, 2) * dpr, life: 1, decay: 0.05, color: '#fff', size: 4 * dpr });
    };
    let raf; let t = 0; const t0 = performance.now();
    for (let i = 0; i < 4; i++) setTimeout(() => launch((0.15 + i * 0.23) * W()), i * 120);
    const frame = () => {
      t++;
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 0, W(), H());
      ctx.globalCompositeOperation = 'lighter';
      const elapsed = performance.now() - t0;
      if (t % (elapsed < 3000 ? 9 : 22) === 0) launch();
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.x += r.vx; r.y += r.vy; r.vy += 0.12 * dpr;
        ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(r.x, r.y, 2.4 * dpr, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,120,.6)'; ctx.fillRect(r.x - dpr, r.y, 2 * dpr, 10 * dpr);
        if (r.y <= r.ty || r.vy >= 0) { burst(r); rockets.splice(i, 1); }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.975; p.vy = p.vy * 0.975 + (p.willow ? 0.05 : 0.08) * dpr; p.life -= p.decay;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.willow ? 0.8 : 1), 0, 7); ctx.fill();
        if (Math.random() < 0.08) { ctx.fillStyle = '#fff'; ctx.fillRect(p.x, p.y, dpr, dpr); }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', fit); };
  }, [accent]);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full" data-tv-fireworks />;
}

const H = ({ children }) => <h3 className="mt-5 border-b pb-1 text-xs font-bold uppercase tracking-wider text-neutral-500">{children}</h3>;
function Color({ k, auto, cfg, save }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={cfg[k] || auto} onChange={(e) => save({ [k]: e.target.value })} className="h-9 w-12 cursor-pointer rounded border" aria-label={k === 'ink' ? 'Cor do texto' : 'Cor de destaque'} />
      {cfg[k] ? <button className="text-xs underline" onClick={() => save({ [k]: '' })}>usar a do fundo</button> : <span className="text-xs text-neutral-500">a do fundo</span>}
    </div>
  );
}

function TvSettings({ cfg, save, onClose, onTest, company, canDefault, onSaveDefault, onUseDefault, logo, hasImg }) {
  const [msg, setMsg] = useState('');
  const row = 'grid grid-cols-[150px_1fr] items-center gap-3';
  const base = BACKGROUNDS[cfg.bg] || BACKGROUNDS.noite;
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-4" style={{ fontFamily: 'Inter, system-ui, sans-serif' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white text-neutral-900 shadow-2xl" role="dialog" aria-label="Configurar painel da TV">
        <div className="flex items-center justify-between border-b px-6 py-4"><h2 className="text-xl font-bold">Personalizar o Painel da TV</h2><button onClick={onClose} aria-label="Fechar"><X /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 text-sm" data-tv-settings>
          <p className="mt-3 text-neutral-500">As mudanças aparecem na hora e ficam guardadas nesta TV.{canDefault ? ' Você pode salvar este estilo como padrão de todas as TVs.' : ''}</p>

          <H>Cabeçalho</H>
          <div className="mt-3 space-y-3">
            <label className={row}><span>Título</span><input className="rounded-lg border px-3 py-2" value={cfg.title} maxLength={30} onChange={(e) => save({ title: e.target.value })} /></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.showLogo} onChange={(e) => save({ showLogo: e.target.checked })} /> Mostrar o logotipo do estabelecimento {!logo && <span className="text-xs text-neutral-500">(envie em Configurações › Empresa e aparência)</span>}</label>
            {cfg.showLogo && <label className={row}><span>Tamanho do logotipo</span><input type="range" min="4" max="20" step="1" value={cfg.logoSize} onChange={(e) => save({ logoSize: Number(e.target.value) })} /></label>}
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.showClock} onChange={(e) => save({ showClock: e.target.checked })} /> Mostrar o relógio</label>
          </div>

          <H>Fundo e cores</H>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{Object.entries(BACKGROUNDS).map(([k, b]) => (
              <button key={k} onClick={() => save({ bg: k })} aria-pressed={cfg.bg === k} title={b.label}
                className={`h-12 rounded-lg border-2 text-[10px] font-semibold ${cfg.bg === k ? 'border-orange-500' : 'border-transparent'}`}
                style={{ background: b.css || (k === 'marca' ? 'radial-gradient(circle at 20% 0%, #ce8a48 0%, #140c06 75%)' : 'repeating-linear-gradient(45deg,#ddd 0 6px,#bbb 6px 12px)'), color: b.css || k === 'marca' ? b.ink : '#111' }}>{b.label}</button>))}</div>
            {cfg.bg === 'empresa' && !hasImg && <p className="text-xs text-orange-700">Envie a imagem em Configurações › Empresa e aparência › Fundo do Painel da TV.</p>}
            {cfg.bg === 'imagem' && <label className={row}><span>Endereço da imagem</span><input className="rounded-lg border px-3 py-2" placeholder="https://…/fundo.jpg" value={cfg.image} onChange={(e) => save({ image: e.target.value })} /></label>}
            {(cfg.bg === 'imagem' || cfg.bg === 'empresa') && <label className={row}><span>Escurecer a imagem</span><input type="range" min="0" max="0.85" step="0.05" value={cfg.overlay} onChange={(e) => save({ overlay: Number(e.target.value) })} /></label>}
            <div className={row}><span>Cor do texto</span><Color k="ink" auto={base.ink} cfg={cfg} save={save} /></div>
            <div className={row}><span>Cor de destaque</span><Color k="accent" auto={base.accent} cfg={cfg} save={save} /></div>
            <label className={row}><span>Cartões</span>
              <select className="rounded-lg border px-3 py-2" value={cfg.cardStyle} onChange={(e) => save({ cardStyle: e.target.value })}>
                <option value="solido">Sólidos</option><option value="vidro">Vidro (translúcidos)</option><option value="contorno">Só contorno</option></select></label>
          </div>

          <H>Letras e textos</H>
          <div className="mt-3 space-y-3">
            <label className={row}><span>Tipo de letra</span>
              <select className="rounded-lg border px-3 py-2" value={cfg.font} onChange={(e) => save({ font: e.target.value })} style={{ fontFamily: FONTS[cfg.font]?.family }}>
                {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k} style={{ fontFamily: f.family }}>{f.label}</option>)}</select></label>
            <label className={row}><span>Tamanho das letras ({Math.round(cfg.scale * 100)}%)</span><input type="range" min="0.7" max="1.6" step="0.05" value={cfg.scale} onChange={(e) => save({ scale: Number(e.target.value) })} /></label>
            <label className={row}><span>Título dos prontos</span><input className="rounded-lg border px-3 py-2" maxLength={40} value={cfg.readyLabel} onChange={(e) => save({ readyLabel: e.target.value })} /></label>
            <label className={row}><span>Título da fila</span><input className="rounded-lg border px-3 py-2" maxLength={40} value={cfg.queueLabel} onChange={(e) => save({ queueLabel: e.target.value })} /></label>
            <label className={row}><span>Sem pedidos</span><input className="rounded-lg border px-3 py-2" maxLength={60} value={cfg.emptyLabel} onChange={(e) => save({ emptyLabel: e.target.value })} /></label>
            <label className={row}><span>Mensagem no rodapé</span><input className="rounded-lg border px-3 py-2" maxLength={200} placeholder="ex.: Happy hour até 20h · Chopp em dobro às quintas" value={cfg.ticker} onChange={(e) => save({ ticker: e.target.value })} /></label>
            {[['showName', 'Mostrar o primeiro nome do cliente'], ['showItems', 'Mostrar os itens no destaque'], ['showQueue', 'Mostrar a coluna da fila (em preparo)']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!cfg[k]} onChange={(e) => save({ [k]: e.target.checked })} /> {l}</label>))}
          </div>

          <H>Chamada (som, voz e efeitos)</H>
          <div className="mt-3 space-y-3">
            <label className={row}><span>Som da chamada</span>
              <select className="rounded-lg border px-3 py-2" value={cfg.sound} onChange={(e) => { save({ sound: e.target.value }); playSound(e.target.value, cfg.volume); }}>
                {Object.entries(SOUNDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className={row}><span>Volume</span><input type="range" min="0.1" max="1" step="0.1" value={cfg.volume} onChange={(e) => save({ volume: Number(e.target.value) })} /></label>
            <label className={row}><span>Destaque por</span>
              <select className="rounded-lg border px-3 py-2" value={cfg.seconds} onChange={(e) => save({ seconds: Number(e.target.value) })}>{[6, 8, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n} segundos</option>)}</select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.voice} onChange={(e) => save({ voice: e.target.checked })} /> Anunciar por voz</label>
            {cfg.voice && <>
              <label className={row}><span>Frase da voz</span><input className="rounded-lg border px-3 py-2" maxLength={120} value={cfg.voiceText} onChange={(e) => save({ voiceText: e.target.value })} /></label>
              <p className="-mt-2 pl-[162px] text-xs text-neutral-500">A TV fala: "Comanda 12, Ana. {cfg.voiceText}"</p>
              <label className={row}><span>Velocidade da voz</span><input type="range" min="0.6" max="1.4" step="0.05" value={cfg.voiceRate} onChange={(e) => save({ voiceRate: Number(e.target.value) })} /></label>
            </>}
            {[['fireworks', 'Fogos de artifício no destaque'], ['fireworksSound', 'Estouro dos fogos no som']].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!cfg[k]} onChange={(e) => save({ [k]: e.target.checked })} /> {l}</label>))}
          </div>
          {msg && <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-green-800">{msg}</p>}
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <button className="rounded-lg border px-3 py-2 font-semibold" onClick={() => save(DEFAULTS)}>Restaurar original</button>
            {company && Object.keys(company).length > 0 && <button className="rounded-lg border px-3 py-2 font-semibold" onClick={() => { onUseDefault(); setMsg('Esta TV voltou ao padrão da empresa.'); }}>Usar o padrão da empresa</button>}
            {canDefault && <button className="rounded-lg border px-3 py-2 font-semibold" data-tv-save-default onClick={async () => { try { await onSaveDefault(); setMsg('Salvo como padrão de todas as TVs.'); } catch (e) { setMsg(e.message); } }}>Salvar como padrão das TVs</button>}
          </div>
          <div className="flex gap-2"><button className="rounded-lg border px-4 py-2 font-semibold" onClick={onTest}>Testar chamada</button>
            <button className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white" onClick={onClose}>Pronto</button></div>
        </div>
      </div>
    </div>
  );
}
