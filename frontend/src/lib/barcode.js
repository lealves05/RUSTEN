// Código de barras das compras: impressão (Code 128) do pedido de compra e leitura pela câmera.
// Leitor USB/Bluetooth funciona como teclado: basta o campo de texto com Enter.
const PATTERNS = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');

/** Larguras das barras/espaços (Code 128, conjunto B) para um texto ASCII imprimível. */
export function code128Widths(text) {
  const vals = [104, ...[...String(text)].map((ch) => {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error('Caractere não suportado no código de barras');
    return v;
  })];
  const check = vals.reduce((s, v, i) => s + v * (i === 0 ? 1 : i), 0) % 103;
  return [...vals, check, 106].map((v) => PATTERNS[v]).join('').split('').map(Number);
}

/** SVG do código (barras pretas, zona de silêncio de 10 módulos). */
export function code128Svg(text, { module = 2, height = 70 } = {}) {
  const w = code128Widths(text);
  const quiet = 10;
  let x = quiet; let rects = '';
  w.forEach((n, i) => { if (i % 2 === 0) rects += `<rect x="${x * module}" y="0" width="${n * module}" height="${height}"/>`; x += n; });
  const total = (x + quiet) * module;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${height}" viewBox="0 0 ${total} ${height}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}

/**
 * Lê um código de barras pela câmera. Usa o leitor nativo do navegador (BarcodeDetector) quando existe;
 * senão, a biblioteca ZXing (carregada só quando usada). Devolve { stop() } e chama onCode(texto) uma vez.
 */
export async function startScanner(video, onCode, onError) {
  let stopped = false; let stream = null; let controls = null; let timer = null;
  const stop = () => { stopped = true; clearTimeout(timer); controls?.stop?.(); stream?.getTracks().forEach((t) => t.stop()); };
  const done = (txt) => { if (stopped || !txt) return; stop(); onCode(String(txt).trim()); };
  try {
    if ('BarcodeDetector' in window) {
      const fmts = await window.BarcodeDetector.getSupportedFormats?.().catch(() => []) || [];
      const want = ['code_128', 'itf', 'ean_13', 'qr_code'].filter((f) => !fmts.length || fmts.includes(f));
      if (want.includes('code_128')) {
        const det = new window.BarcodeDetector({ formats: want });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
        video.srcObject = stream; await video.play();
        const tick = async () => {
          if (stopped) return;
          try { const r = await det.detect(video); if (r[0]?.rawValue) return done(r[0].rawValue); } catch { /* quadro ainda não pronto */ }
          timer = setTimeout(tick, 200);
        };
        tick();
        return { stop };
      }
    }
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.ITF, BarcodeFormat.QR_CODE]], [DecodeHintType.TRY_HARDER, true]]);
    const reader = new BrowserMultiFormatReader(hints);
    controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false }, video,
      (result) => { if (result) done(result.getText()); });
    if (stopped) controls.stop();
  } catch (e) {
    stop();
    onError?.(e?.name === 'NotAllowedError' ? new Error('Permita o uso da câmera para ler o código.') : new Error('Não foi possível abrir a câmera neste aparelho. Use o leitor ou digite o código.'));
  }
  return { stop };
}
