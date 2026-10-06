import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Armchair, Banknote, CheckCircle2, ChefHat, Circle, Receipt, ScanBarcode, TriangleAlert, Wallet, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, dateBR, qtyFmt } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, ErrorBox, Loading, PageHeader, useLoad } from '../components/ui.jsx';
import { prefs } from '../lib/prefs.js';

function Kpi({ icon: Icon, label, value, hint, tone }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-sm text-muted"><Icon size={16} aria-hidden /> {label}</div>
      <div className={`mt-1 font-display text-4xl tracking-wide ${tone || ''}`}>{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default function Home() {
  const s = useSession();
  const { data: d, loading, error, reload } = useLoad(() => api('/api/home/dashboard'));
  const money_ = s.can('financeiro.visualizar');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const max = Math.max(1, ...(d.by_hour || []).map((h) => h.cents));
  return (
    <div>
      <PageHeader title={`Salve, ${s.me.user.name.split(' ')[0]}`} subtitle={`Dia comercial ${dateBR(d.business_date)} · ${s.me.company.name}`}
        actions={s.can('pdv.lancar') && <Link to="/pdv" className="btn-primary btn-xl"><ScanBarcode size={20} /> Abrir PDV</Link>} />
      <FirstSteps d={d} s={s} />
      {d.demo_products > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <Badge tone="warn">Demonstração</Badge> O cardápio tem {d.demo_products} produtos de demonstração. Remova em Configurações › Empresa quando cadastrar o seu.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {money_ && <Kpi icon={Receipt} label="Vendido (lançado)" value={money(d.consumed_cents)} hint="Itens lançados hoje — ainda não é dinheiro recebido" />}
        {money_ && <Kpi icon={Wallet} label="Recebido" value={money(d.received_cents)} hint="Pagamentos confirmados no dia" />}
        <Kpi icon={Receipt} label="Contas abertas" value={d.open_sessions} hint="Mesas, comandas e balcão ainda não encerrados" />
        <Kpi icon={Armchair} label="Mesas ocupadas" value={`${d.busy_tables}/${d.total_tables}`} />
        <Kpi icon={ChefHat} label="Itens em preparo" value={d.preparing} hint="Na fila ou sendo preparados (tela Cozinha)" />
        <Kpi icon={Banknote} label="Caixas abertos" value={d.open_cash} />
        {money_ && <Kpi icon={TriangleAlert} label="Divergências de caixa" value={d.cash_differences} tone={d.cash_differences ? 'text-rust' : ''} hint="Fechamentos do dia com diferença" />}
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {money_ && (
          <section className="card p-4">
            <h2 className="font-display text-2xl tracking-wide">Recebido por hora</h2>
            {!d.by_hour?.length ? <p className="py-6 text-sm text-muted">Nenhum recebimento hoje.</p> : (
              <div className="mt-3 flex h-40 items-end gap-1" role="img" aria-label="Recebimentos por hora">
                {d.by_hour.map((h) => (
                  <div key={h.hour} className="flex flex-1 flex-col items-center gap-1" title={`${h.hour}h: ${money(h.cents)}`}>
                    <div className="w-full rounded-t bg-copper" style={{ height: `${(h.cents / max) * 100}%` }} />
                    <span className="text-[10px] text-muted">{h.hour}h</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        <section className="card p-4">
          <h2 className="font-display text-2xl tracking-wide">Mais pedidos hoje</h2>
          {!d.top.length ? <p className="py-6 text-sm text-muted">Nenhum item lançado hoje.</p> : (
            <table className="table-clean mt-2"><tbody>
              {d.top.map((t) => <tr key={t.description}><td>{t.description}</td><td className="text-right">{qtyFmt(t.qty)}</td>{money_ && <td className="text-right">{money(t.cents)}</td>}</tr>)}
            </tbody></table>
          )}
        </section>
      </div>
    </div>
  );
}

/* Primeiros passos: guia o dono no começo; some quando tudo foi feito ou quando ele dispensa */
function FirstSteps({ d, s }) {
  const cid = s.me.company.id;
  const doneKey = `rusten.onboarding.done.${cid}`;
  const hideKey = `rusten.onboarding.hidden.${cid}`;
  const [hidden, setHidden] = useState(() => prefs.get(hideKey, '') === '1');
  const [extra, setExtra] = useState({});
  useEffect(() => {
    if (hidden) return;
    if (s.can('cardapio.visualizar')) api('/api/menu/products?active=all').then((p) => setExtra((x) => ({ ...x, ownProducts: p.some((y) => !y.demo) }))).catch(() => {});
    if (s.hasModule('delivery') && s.can('delivery.gerenciar')) api('/api/delivery/settings').then((c) => setExtra((x) => ({ ...x, menuOn: !!c.enabled }))).catch(() => {});
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps
  if (hidden) return null;
  const sticky = new Set(prefs.get(doneKey, '').split(',').filter(Boolean)); // passo feito uma vez continua feito
  const steps = [
    s.can('caixa.abrir') && { k: 'caixa', label: 'Abrir o caixa', hint: 'Informe o troco da gaveta para começar a receber.', to: '/financeiro/caixa', done: d.open_cash > 0 },
    s.can('cardapio.visualizar') && { k: 'produtos', label: 'Cadastrar os seus produtos', hint: 'Preço, categoria e onde são preparados. O cardápio de exemplo pode ser removido depois.', to: '/cardapio', done: !!extra.ownProducts },
    s.can('pdv.lancar') && { k: 'pedido', label: 'Fazer um pedido de teste', hint: 'Toque numa mesa livre no Salão e lance alguns itens.', to: '/salao', done: d.open_sessions > 0 || d.top.length > 0 },
    s.hasModule('cozinha') && s.can('cozinha.operar') && { k: 'cozinha', label: 'Abrir a tela da cozinha', hint: 'No tablet ou TV da cozinha, em tela cheia.', to: '/cozinha/tela', done: sticky.has('cozinha') },
    s.hasModule('delivery') && s.can('delivery.gerenciar') && { k: 'delivery', label: 'Ligar o cardápio digital', hint: 'Link para o cliente pedir pelo celular (entrega ou retirada).', to: '/delivery', done: !!extra.menuOn },
  ].filter(Boolean).map((x) => ({ ...x, done: x.done || sticky.has(x.k) }));
  const newly = steps.filter((x) => x.done && !sticky.has(x.k));
  if (newly.length) prefs.set(doneKey, [...sticky, ...newly.map((x) => x.k)].join(','));
  const n = steps.filter((x) => x.done).length;
  if (!steps.length || n === steps.length) return null;
  return (
    <section className="card mb-4 p-4" data-first-steps aria-labelledby="fs-title">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 id="fs-title" className="font-display text-2xl tracking-wide">Primeiros passos</h2>
          <p className="text-sm text-muted">{n} de {steps.length} feitos — leva poucos minutos.</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={n} aria-label="Progresso">
            <div className="h-full bg-copper transition-all" style={{ width: `${(n / steps.length) * 100}%` }} />
          </div>
        </div>
        <button className="flex h-11 w-11 items-center justify-center rounded hover:bg-raised" onClick={() => { prefs.set(hideKey, '1'); setHidden(true); }} aria-label="Ocultar primeiros passos" title="Ocultar"><X size={18} /></button>
      </div>
      <ol className="mt-3 grid gap-2 md:grid-cols-2">
        {steps.map((x) => (
          <li key={x.k}>
            <Link to={x.to} onClick={() => { if (x.k === 'cozinha') prefs.set(doneKey, [...sticky, 'cozinha'].join(',')); }}
              className={`flex min-h-[56px] items-start gap-3 rounded-lg border p-3 ${x.done ? 'border-ok/40 bg-ok/5' : 'border-line hover:border-copper'}`} data-step={x.k}>
              {x.done ? <CheckCircle2 className="mt-0.5 shrink-0 text-ok" size={20} /> : <Circle className="mt-0.5 shrink-0 text-muted" size={20} />}
              <span><span className={`font-semibold ${x.done ? 'line-through decoration-ok/60' : ''}`}>{x.label}</span><span className="block text-xs text-muted">{x.hint}</span></span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
