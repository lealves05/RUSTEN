// Suporte e treinamento: vídeo-aulas narradas, dúvidas frequentes e contato com a equipe da plataforma.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, LifeBuoy, PlayCircle, Search } from 'lucide-react';
import { useSession } from '../lib/session.jsx';
import { Badge, PageHeader } from '../components/ui.jsx';
import { LESSONS, MODULES, fmtDur, posterUrl, thumbUrl, videoUrl } from '../lib/training.js';

const FAQ = [
  ['Como uso a dupla leitura?', 'Em PDV, escolha "Dupla leitura". Leia a comanda (a barra mostra "AGUARDANDO PRODUTO") e em seguida o produto. Cada item exige um novo par. Esc cancela o par incompleto.'],
  ['E se o leitor quebrar?', 'Troque para Manual (se seu perfil permitir) ou digite o código no campo de leitura. Com dupla leitura obrigatória, use a exceção autorizada pelo gerente.'],
  ['Lancei um item e a internet caiu. Lanço de novo?', 'Não. Use "Conferir operação": ela consulta pela mesma identificação e nunca duplica.'],
  ['O cartão da comanda foi perdido.', 'Em Salão › Cartões de comanda, use "substituir (perdida)": o consumo passa para um cartão livre com todo o histórico.'],
  ['Consumo lançado é o mesmo que recebido?', 'Não. Lançar registra consumo; só pagamentos confirmados entram no caixa. Fechar a comanda exige saldo zero.'],
  ['Qual horário conta para o dia?', 'Cada unidade define até que horas a madrugada conta no dia anterior (Configurações › Unidades).'],
];
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const total = LESSONS.reduce((a, l) => a + l.s, 0);

function useWatched(userId) {
  const key = `rusten.aulas.${userId || 'anon'}`;
  const [seen, setSeen] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } });
  const mark = (n) => setSeen((s) => {
    if (s[n]) return s;
    const next = { ...s, [n]: 1 };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* sem armazenamento */ }
    return next;
  });
  return [seen, mark];
}

export default function Support() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState('');
  const [seen, mark] = useWatched(s.me?.user?.id);
  const player = useRef(null);
  const cur = LESSONS.find((l) => l.n === Number(params.get('aula'))) || LESSONS[0];
  const idx = LESSONS.indexOf(cur);
  const ch = s.me?.access?.supportChannel || {};
  const support = s.me?.access?.support;
  const done = LESSONS.filter((l) => seen[l.n]).length;

  const open = (l, play = true) => {
    setParams((p) => { const q = new URLSearchParams(p); q.set('aula', String(l.n)); return q; }, { replace: true });
    if (play) setTimeout(() => { player.current?.play?.().catch(() => {}); player.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }, 60);
  };
  useEffect(() => { player.current?.load?.(); }, [cur.n]);
  const groups = useMemo(() => {
    const t = norm(term.trim());
    const hit = (l) => !t || norm(`${l.title} ${l.desc} ${l.learn.join(' ')}`).includes(t);
    return MODULES.map((m) => ({ ...m, items: LESSONS.filter((l) => l.mod === m.key && hit(l)) })).filter((g) => g.items.length);
  }, [term]);
  const wa = String(ch.whatsapp || '').replace(/\D/g, '');

  return (
    <div className="space-y-6">
      <PageHeader title="Suporte e treinamento" subtitle={`${LESSONS.length} vídeo-aulas narradas, gravadas no próprio RUSTEN (${Math.round(total / 60)} min no total).`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Aula atual" className="min-w-0 space-y-3">
          <video ref={player} key={cur.n} controls playsInline preload="metadata" poster={posterUrl(cur)}
            className="aspect-[16/10] w-full rounded-xl bg-black shadow-lg" onEnded={() => { mark(cur.n); if (LESSONS[idx + 1]) open(LESSONS[idx + 1], false); }}>
            <source src={videoUrl(cur)} type="video/mp4" />
            Seu navegador não reproduz vídeos.
          </video>
          <div className="card p-4">
            <div className="flex flex-wrap items-center gap-2"><Badge tone="info">Aula {cur.n}</Badge><span className="text-sm text-muted"><Clock size={14} className="inline" /> {fmtDur(cur.s)}</span>
              {seen[cur.n] && <Badge tone="ok">assistida</Badge>}</div>
            <h2 className="mt-2 font-display text-3xl">{cur.title}</h2>
            <p className="text-muted">{cur.desc}</p>
            <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-3">{cur.learn.map((x) => <li key={x} className="flex gap-1.5"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-copper" />{x}</li>)}</ul>
            <div className="mt-3 flex gap-2">
              <button className="btn-ghost" disabled={idx === 0} onClick={() => open(LESSONS[idx - 1])}>Aula anterior</button>
              <button className="btn-primary" disabled={idx === LESSONS.length - 1} onClick={() => open(LESSONS[idx + 1])}>Próxima aula</button>
            </div>
          </div>
        </section>
        <aside className="space-y-3">
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between text-sm"><span className="font-semibold">Seu progresso</span><span className="text-muted">{done} de {LESSONS.length}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-raised"><div className="h-full bg-copper" style={{ width: `${(done / LESSONS.length) * 100}%` }} /></div>
            <label className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-bg px-3"><Search size={16} className="text-muted" />
              <input className="w-full bg-transparent py-2 text-sm outline-none" placeholder="Buscar aula" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Buscar aula" /></label>
          </div>
          <div className="card max-h-[70vh] overflow-y-auto p-2">
            {groups.map((g) => (
              <div key={g.key} className="mb-2">
                <div className="px-2 pt-1 text-xs font-bold uppercase tracking-wide text-muted">{g.label}</div>
                {g.items.map((l) => (
                  <button key={l.n} onClick={() => open(l)} aria-current={l.n === cur.n ? 'true' : undefined}
                    className={`mt-1 flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-raised ${l.n === cur.n ? 'bg-copper/15 ring-1 ring-copper/40' : ''}`}>
                    <span className="relative shrink-0"><img src={thumbUrl(l)} alt="" loading="lazy" className="h-14 w-24 rounded object-cover" />
                      <PlayCircle size={20} className="absolute inset-0 m-auto text-white drop-shadow" /></span>
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{l.n}. {l.title}</span>
                      <span className="text-xs text-muted">{fmtDur(l.s)}{seen[l.n] ? ' · ✓ assistida' : ''}</span></span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <p className="p-3 text-sm text-muted">Nenhuma aula encontrada.</p>}
          </div>
        </aside>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-2xl">Perguntas frequentes</h2>
          <div className="mt-2 space-y-2">{FAQ.map(([q, a]) => <details key={q} className="card p-3"><summary className="cursor-pointer font-semibold">{q}</summary><p className="mt-2 text-sm">{a}</p></details>)}</div>
        </div>
        <div>
          <h2 className="font-display text-2xl">Fale com o suporte</h2>
          <div className="card mt-2 space-y-2 p-4 text-sm">
            {wa || ch.email ? (
              <div className="flex flex-wrap gap-2">
                {wa && <a className="btn-primary" href={`https://wa.me/${wa.length >= 12 ? wa : `55${wa}`}`} target="_blank" rel="noreferrer noopener"><LifeBuoy size={16} /> WhatsApp</a>}
                {ch.email && <a className="btn-ghost" href={`mailto:${ch.email}`}>{ch.email}</a>}
              </div>
            ) : support ? <p>{support}</p> : <p><Badge tone="muted">Pendente</Badge> Os contatos do suporte são configurados pela administração da plataforma e aparecerão aqui.</p>}
            {ch.hours && <p className="text-muted">Horário: {ch.hours}</p>}
            {ch.message && <p className="text-muted">{ch.message}</p>}
          </div>
          <p className="mt-3 text-xs text-muted">Atalhos: Ctrl+K busca · Alt+P PDV · Alt+S Salão · Alt+C Caixa · Alt+I Início · Esc cancela o par na dupla leitura.</p>
        </div>
      </div>
    </div>
  );
}
