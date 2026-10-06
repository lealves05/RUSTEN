import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { Modal, Toggle } from './ui.jsx';
import { reviewAuto } from '../lib/prefs.js';

// Depois do fechamento: QR/link para o cliente avaliar a experiência (uma avaliação por consumo)
export default function ReviewLinkModal({ sessionId, onClose }) {
  const [d, setD] = useState(null);
  const [auto, setAuto] = useState(() => reviewAuto.get());
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
      <b>Como foi sua experiência?</b><br><img src="${d.qr}" width="200"><br><small>Aponte a câmera para avaliar</small></body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 250); // impressão disparada daqui: a CSP não permite script embutido na janela
  };
  return (
    <Modal open onClose={onClose} title="Avaliação do cliente" footer={<><button className="btn-ghost" onClick={print}><Printer size={16} /> Imprimir QR</button><button className="btn-primary" onClick={onClose}>Concluir</button></>}>
      <div className="text-center">
        <img src={d.qr} alt="QR para avaliar" className="mx-auto rounded bg-white p-2" width={200} height={200} />
        <p className="mt-2 text-sm">Mostre ao cliente ou imprima: ele avalia de 1 a 5 estrelas pelo celular.</p>
        <p className="mt-1 break-all font-mono text-[11px] text-muted">{d.url}</p>
      </div>
      <div className="mt-3 border-t border-line pt-2" data-no-dirty>
        <Toggle checked={auto} onChange={(v) => { setAuto(v); reviewAuto.set(v); }} label="Mostrar automaticamente ao encerrar"
          hint="Vale para este aparelho. Desligado, o aviso de conta encerrada traz um botão para mostrar o QR quando quiser." />
      </div>
    </Modal>
  );
}
