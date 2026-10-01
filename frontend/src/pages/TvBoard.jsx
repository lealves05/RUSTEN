// Painel da TV: fila de pedidos em preparo e chamada chamativa (com som e voz) quando o pedido fica pronto para retirada.
// Configuração por TV (guardada neste aparelho): fundo, som, voz, tipo de letra, tempo de destaque e o que exibir.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Maximize2, Settings2, Volume2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useSession } from '../lib/session.jsx';

export const BACKGROUNDS = {
  noite: { label: 'Noite', css: 'radial-gradient(circle at 20% 10%, #2a2a33 0%, #0b0b0f 60%)', ink: '#fff', accent: '#ffb347' },
  cobre: { label: 'Cobre', css: 'linear-gradient(135deg, #3b1d0e 0%, #8a4b22 55%, #c27a3c 100%)', ink: '#fff7ec', accent: '#ffe08a' },
  neon: { label: 'Neon', css: 'radial-gradient(circle at 80% 20%, #4b0082 0%, #0a0015 55%), #0a0015', ink: '#f6f0ff', accent: '#39ff14' },
  oceano: { label: 'Oceano', css: 'linear-gradient(160deg, #001f3f 0%, #0074d9 100%)', ink: '#ffffff', accent: '#7fdbff' },
  quadro: { label: 'Quadro-negro', css: 'repeating-linear-gradient(45deg, #1e2b22 0 14px, #1b2720 14px 28px)', ink: '#f5f5e8', accent: '#ffd23f' },
  claro: { label: 'Claro', css: 'linear-gradient(180deg, #fffaf2 0%, #f3e6d3 100%)', ink: '#1d1208', accent: '#b5541c' },
  imagem: { label: 'Imagem (URL)', css: null, ink: '#ffffff', accent: '#ffcc33' },
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
const DEFAULTS = { bg: 'noite', image: '', font: 'bebas', sound: 'fanfarra', volume: 0.8, voice: true, seconds: 10, showName: true, showItems: true, showQueue: true, title: 'Pedidos' };
const KEY = 'rusten.tv';
const load = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } };

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
const label = (o) => (o.kind === 'mesa' ? 'Mesa' : o.kind === 'delivery' || o.kind === 'retirada' ? 'Pedido' : 'Comanda');
export function speak(o, cfg) {
  if (!cfg.voice || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(`${label(o)} ${o.code.replace('#', '')}${cfg.showName && o.name ? `, ${o.name}` : ''}. Seu pedido está pronto!`);
    u.lang = 'pt-BR'; u.rate = 0.95; u.volume = Math.min(1, cfg.volume + 0.2);
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

  useEffect(() => {
    if (document.querySelector(`link[href="${FONT_CSS}"]`)) return;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_CSS; document.head.appendChild(l);
  }, []);

  const announce = useCallback((o) => {
    setSpot(o);
    playSound(cfg.sound, cfg.volume);
    setTimeout(() => speak(o, cfg), cfg.sound === 'nenhum' ? 0 : 1100);
  }, [cfg]);

  const load2 = useCallback(async () => {
    try {
      const r = await api('/api/kitchen/board');
      setData(r); setErr(null);
      const marks = new Map(r.orders.filter((o) => o.status === 'pronto').map((o) => [o.id, `${o.ready_at}|${o.called_at || ''}`]));
      if (known.current) {
        for (const o of r.orders) {
          if (o.status === 'pronto' && known.current.get(o.id) !== marks.get(o.id)) queue.current.push(o);
        }
      }
      known.current = marks;
    } catch (e) { setErr(e); }
  }, []);
  useEffect(() => { load2(); const t = setInterval(load2, 4000); window.addEventListener('online', load2); return () => { clearInterval(t); window.removeEventListener('online', load2); }; }, [load2]);

  // um destaque por vez, com a duração configurada
  const spotRef = useRef(null);
  useEffect(() => {
    if (!started) return undefined;
    const t = setInterval(() => {
      if (spotRef.current && Date.now() - spotRef.current.__at < cfg.seconds * 1000) return;
      const next = queue.current.shift();
      if (next) { const o = { ...next, __at: Date.now() }; spotRef.current = o; setSpot(o); announce(o); }
      else if (spotRef.current) { spotRef.current = null; setSpot(null); }
    }, 500);
    return () => clearInterval(t);
  }, [started, cfg.seconds, announce]);

  const bg = BACKGROUNDS[cfg.bg] || BACKGROUNDS.noite;
  const background = cfg.bg === 'imagem' && cfg.image ? `center/cover no-repeat url("${cfg.image.replace(/"/g, '')}"), #000` : (bg.css || BACKGROUNDS.noite.css);
  const font = (FONTS[cfg.font] || FONTS.bebas).family;
  const preparing = (data?.orders || []).filter((o) => o.status === 'preparando');
  const ready = (data?.orders || []).filter((o) => o.status === 'pronto').sort((a, b) => new Date(b.called_at || b.ready_at) - new Date(a.called_at || a.ready_at));
  const start = () => { setStarted(true); playSound('suave', cfg.volume * 0.5); document.documentElement.requestFullscreen?.().catch(() => {}); };

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background, color: bg.ink, fontFamily: font }} data-tv>
      <style>{`
        @keyframes tvPop { 0% { transform: scale(.2) rotate(-8deg); opacity: 0 } 60% { transform: scale(1.12) rotate(2deg); opacity: 1 } 100% { transform: scale(1) rotate(0) } }
        @keyframes tvPulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
        @keyframes tvShine { 0% { background-position: 0% 50% } 100% { background-position: 200% 50% } }
        @keyframes tvRay { to { transform: rotate(360deg) } }
        @keyframes tvFall { 0% { transform: translateY(-10vh) rotate(0) } 100% { transform: translateY(110vh) rotate(720deg) } }
        @keyframes tvBlink { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      `}</style>
      {/* cabeçalho */}
      <div className="flex items-center justify-between px-[3vw] pt-[2vh]">
        <div className="text-[4.2vw] leading-none tracking-wide">{cfg.title}</div>
        <div className="flex items-center gap-3 text-[1.6vw] opacity-80">
          <Clock />
          <button onClick={() => setShowCfg(true)} className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label="Configurar painel"><Settings2 size={22} /></button>
          <button onClick={() => document.documentElement.requestFullscreen?.()} className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label="Tela cheia"><Maximize2 size={22} /></button>
          <Link to="/cozinha" className="rounded-full p-2 opacity-40 hover:opacity-100" aria-label="Voltar"><ArrowLeft size={22} /></Link>
        </div>
      </div>
      <div className={`grid h-[86vh] gap-[2vw] px-[3vw] pt-[2vh] ${cfg.showQueue ? 'grid-cols-[1fr_1.5fr]' : 'grid-cols-1'}`}>
        {cfg.showQueue && (
          <section className="flex min-h-0 flex-col rounded-[2vw] p-[1.5vw]" style={{ background: 'rgba(0,0,0,.28)' }}>
            <h2 className="text-[2.6vw] leading-none opacity-80">Em preparo</h2>
            <div className="mt-[1.5vh] grid flex-1 auto-rows-min grid-cols-3 gap-[1vw] overflow-hidden">
              {preparing.map((o) => (
                <div key={o.id} className="rounded-[1vw] px-[0.8vw] py-[0.8vh] text-center" style={{ background: 'rgba(255,255,255,.08)' }} data-tv-preparing={o.code}>
                  <div className="text-[1vw] uppercase opacity-60">{label(o)}</div>
                  <div className="text-[3.6vw] leading-none">{o.code}</div>
                  {cfg.showName && o.name && <div className="truncate text-[1.2vw] opacity-80">{o.name}</div>}
                  {o.partial && <div className="text-[0.9vw] opacity-70" style={{ color: bg.accent }}>parte pronta</div>}
                </div>
              ))}
              {!preparing.length && <div className="col-span-3 text-[1.6vw] opacity-50">Nenhum pedido em preparo.</div>}
            </div>
          </section>
        )}
        <section className="flex min-h-0 flex-col rounded-[2vw] p-[1.5vw]" style={{ background: 'rgba(0,0,0,.18)', boxShadow: `inset 0 0 0 .3vw ${bg.accent}55` }}>
          <h2 className="text-[2.8vw] leading-none" style={{ color: bg.accent }}>Pronto para retirar</h2>
          <div className="mt-[1.5vh] grid flex-1 auto-rows-min grid-cols-3 gap-[1.2vw] overflow-hidden">
            {ready.map((o, i) => (
              <div key={o.id} className="rounded-[1.2vw] px-[1vw] py-[1vh] text-center" data-tv-ready={o.code}
                style={{ background: i === 0 ? bg.accent : 'rgba(255,255,255,.12)', color: i === 0 ? '#111' : bg.ink, animation: i === 0 ? 'tvPulse 1.6s ease-in-out infinite' : undefined }}>
                <div className="text-[1.2vw] uppercase opacity-70">{label(o)}{o.table ? ` · mesa ${o.table}` : ''}</div>
                <div className="text-[5.5vw] leading-none">{o.code}</div>
                {cfg.showName && o.name && <div className="truncate text-[1.6vw]">{o.name}</div>}
              </div>
            ))}
            {!ready.length && <div className="col-span-3 text-[1.8vw] opacity-50">Aguardando pedidos prontos…</div>}
          </div>
        </section>
      </div>
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
      {showCfg && <TvSettings cfg={cfg} save={save} onClose={() => setShowCfg(false)} onTest={() => { const o = ready[0] || preparing[0] || { id: 0, code: '12', kind: 'comanda', name: 'Ana', items: [{ d: 'Hambúrguer da casa', q: 1 }] }; queue.current.unshift(o); spotRef.current = null; setShowCfg(false); }} />}
    </div>
  );
}

function Clock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 15000); return () => clearInterval(i); }, []);
  return <span>{t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>;
}

const CONFETTI = Array.from({ length: 40 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 10) * 0.25, dur: 2.6 + (i % 5) * 0.5, hue: (i * 47) % 360, size: 0.8 + (i % 4) * 0.4 }));
function Spotlight({ o, cfg, bg }) {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-hidden" style={{ background: 'rgba(0,0,0,.82)' }} data-tv-spot={o.code}>
      <div className="absolute left-1/2 top-1/2 h-[220vmax] w-[220vmax] -translate-x-1/2 -translate-y-1/2 opacity-40"
        style={{ background: `repeating-conic-gradient(${bg.accent} 0 10deg, transparent 10deg 20deg)`, animation: 'tvRay 14s linear infinite' }} />
      {CONFETTI.map((c, i) => <span key={i} className="absolute top-0 block rounded-sm" style={{ left: `${c.left}%`, width: `${c.size}vw`, height: `${c.size * 1.6}vw`, background: `hsl(${c.hue} 90% 60%)`, animation: `tvFall ${c.dur}s ${c.delay}s linear infinite` }} />)}
      <div className="relative text-center" style={{ animation: 'tvPop .7s cubic-bezier(.2,1.6,.4,1) both' }}>
        <div className="text-[4vw] uppercase leading-none" style={{ color: bg.accent, animation: 'tvBlink 1s step-end infinite' }}>Pedido pronto!</div>
        <div className="mt-[1vh] text-[4vw] uppercase leading-none text-white">{label(o)}</div>
        <div className="text-[24vw] leading-[0.85]" style={{ backgroundImage: `linear-gradient(90deg, #fff, ${bg.accent}, #fff, ${bg.accent})`, backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', animation: 'tvShine 2s linear infinite', filter: 'drop-shadow(0 .6vw 1.2vw rgba(0,0,0,.6))' }}>{o.code}</div>
        {o.table && <div className="text-[3vw] text-white">Mesa {o.table}</div>}
        {cfg.showName && o.name && <div className="text-[6vw] leading-none text-white">{o.name}</div>}
        {cfg.showItems && !!o.items?.length && (
          <div className="mx-auto mt-[2vh] max-w-[70vw] text-[2.2vw] leading-tight text-white/90" style={{ fontFamily: 'Inter, sans-serif' }}>
            {o.items.filter((x) => x.ready !== false).slice(0, 6).map((x) => `${x.q}× ${x.d}`).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
}

function TvSettings({ cfg, save, onClose, onTest }) {
  const row = 'grid grid-cols-[160px_1fr] items-center gap-3';
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-4" style={{ fontFamily: 'Inter, system-ui, sans-serif' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 text-neutral-900 shadow-2xl" role="dialog" aria-label="Configurar painel da TV">
        <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Configurar painel da TV</h2><button onClick={onClose} aria-label="Fechar"><X /></button></div>
        <p className="mt-1 text-sm text-neutral-500">Vale para esta TV. Cada tela pode ter o seu estilo.</p>
        <div className="mt-4 space-y-3 text-sm">
          <label className={row}><span>Título</span><input className="rounded-lg border px-3 py-2" value={cfg.title} maxLength={30} onChange={(e) => save({ title: e.target.value })} /></label>
          <div className={row}><span>Fundo</span>
            <div className="grid grid-cols-4 gap-2">{Object.entries(BACKGROUNDS).map(([k, b]) => (
              <button key={k} onClick={() => save({ bg: k })} aria-pressed={cfg.bg === k} title={b.label}
                className={`h-12 rounded-lg border-2 text-[10px] font-semibold ${cfg.bg === k ? 'border-orange-500' : 'border-transparent'}`}
                style={{ background: b.css || 'repeating-linear-gradient(45deg,#ddd 0 6px,#bbb 6px 12px)', color: b.ink }}>{b.label}</button>))}</div></div>
          {cfg.bg === 'imagem' && <label className={row}><span>Endereço da imagem</span><input className="rounded-lg border px-3 py-2" placeholder="https://…/fundo.jpg" value={cfg.image} onChange={(e) => save({ image: e.target.value })} /></label>}
          <label className={row}><span>Tipo de letra</span>
            <select className="rounded-lg border px-3 py-2" value={cfg.font} onChange={(e) => save({ font: e.target.value })} style={{ fontFamily: FONTS[cfg.font]?.family }}>
              {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k} style={{ fontFamily: f.family }}>{f.label}</option>)}</select></label>
          <label className={row}><span>Som da chamada</span>
            <select className="rounded-lg border px-3 py-2" value={cfg.sound} onChange={(e) => { save({ sound: e.target.value }); playSound(e.target.value, cfg.volume); }}>
              {Object.entries(SOUNDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className={row}><span>Volume</span><input type="range" min="0.1" max="1" step="0.1" value={cfg.volume} onChange={(e) => save({ volume: Number(e.target.value) })} /></label>
          <label className={row}><span>Destaque por</span>
            <select className="rounded-lg border px-3 py-2" value={cfg.seconds} onChange={(e) => save({ seconds: Number(e.target.value) })}>{[6, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n} segundos</option>)}</select></label>
          {[['voice', 'Anunciar por voz ("Comanda 12, seu pedido está pronto")'], ['showName', 'Mostrar o primeiro nome do cliente'], ['showItems', 'Mostrar os itens no destaque'], ['showQueue', 'Mostrar a coluna "Em preparo"']].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!cfg[k]} onChange={(e) => save({ [k]: e.target.checked })} /> {l}</label>))}
        </div>
        <div className="mt-5 flex justify-between gap-2">
          <button className="rounded-lg border px-4 py-2 font-semibold" onClick={() => save(DEFAULTS)}>Restaurar padrão</button>
          <div className="flex gap-2"><button className="rounded-lg border px-4 py-2 font-semibold" onClick={onTest}>Testar chamada</button>
            <button className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white" onClick={onClose}>Pronto</button></div>
        </div>
      </div>
    </div>
  );
}
