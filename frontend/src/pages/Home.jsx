import { Link } from 'react-router-dom';
import { Armchair, Banknote, ChefHat, Receipt, ScanBarcode, TriangleAlert, Wallet } from 'lucide-react';
import { api } from '../lib/api.js';
import { money, dateBR, qtyFmt } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, ErrorBox, Loading, PageHeader, useLoad } from '../components/ui.jsx';

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
      {d.demo_products > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <Badge tone="warn">Demonstração</Badge> O cardápio tem {d.demo_products} produtos de demonstração. Remova em Configurações › Empresa quando cadastrar o seu.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {money_ && <Kpi icon={Receipt} label="Consumo lançado" value={money(d.consumed_cents)} hint="Itens ativos do dia — não é dinheiro recebido" />}
        {money_ && <Kpi icon={Wallet} label="Recebido" value={money(d.received_cents)} hint="Pagamentos confirmados no dia" />}
        <Kpi icon={Receipt} label="Consumos abertos" value={d.open_sessions} hint="Comandas, mesas e balcão" />
        <Kpi icon={Armchair} label="Mesas ocupadas" value={`${d.busy_tables}/${d.total_tables}`} />
        <Kpi icon={ChefHat} label="Itens em preparo" value={d.preparing} hint="A tela de cozinha chega na próxima fase" />
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
