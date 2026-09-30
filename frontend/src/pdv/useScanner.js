// Leitura de códigos por leitor em modo teclado (USB/Bluetooth) e feedback sonoro.
import { useEffect, useRef } from 'react';

const isEditable = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

/* Captura leituras só quando o foco NÃO está num campo de texto (senhas e observações ficam de fora).
   Leitores digitam muito rápido e terminam com Enter/Tab; digitação humana lenta é descartada. */
export function useScanner(onScan, { enabled = true, terminator = 'Enter', maxGapMs = 80 } = {}) {
  const buf = useRef('');
  const last = useRef(0);
  const cb = useRef(onScan);
  cb.current = onScan;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return; // janela aberta tem prioridade
      const now = performance.now();
      if (now - last.current > maxGapMs) buf.current = '';
      last.current = now;
      if (e.key === terminator || (terminator === 'Enter' && e.key === 'Enter')) {
        const code = buf.current;
        buf.current = '';
        if (code.length >= 3) { e.preventDefault(); cb.current(code); }
        return;
      }
      if (e.key.length === 1) buf.current += e.key;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, terminator, maxGapMs]);
}

let ctx;
export function beep(kind = 'ok') {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = kind === 'ok' ? 1320 : kind === 'warn' ? 660 : 220;
    o.type = kind === 'bad' ? 'square' : 'sine';
    g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + (kind === 'ok' ? 0.08 : 0.25));
  } catch { /* sem áudio: a mensagem visual continua */ }
}
