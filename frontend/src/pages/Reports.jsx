// Relatórios gerenciais: vendas, produtos (curva ABC e CMV), equipe, mesas, controle, operação e financeiro.
import { useState } from 'react';
import { Download, Info, Printer } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { money, dateBR } from '../lib/format.js';
import { ErrorBox, Loading, PageHeader, useLoad, useToast } from '../components/ui.jsx';

const iso = (d) => d.toISOString().slice(0, 10);
const PRESETS = [['hoje', 'Hoje', 0], ['7d', '7 dias', 6], ['30d', '30 dias', 29], ['mes', 'Este mês', null]];
const METHOD = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito', vale: 'Vale/pontos', outro: 'Outro', fiado: 'Fiado (a receber)', saldo_cliente: 'Crédito do cliente' };
const CHANNEL = { comanda: 'Comanda', mesa: 'Mesa', balcao: 'Balcão', retirada: 'Retirada', delivery: 'Delivery' };
const MODE = { manual: 'Manual', continua: 'Leitura contínua', dupla: 'Dupla leitura', excecao: 'Exceção autorizada', balcao: 'Balcão', delivery: 'Delivery' };
const EVENTS = { 'consumo.reaberto': 'Reaberturas', 'consumo.cancelado': 'Consumos cancelados', 'pdv.itens_transferidos': 'Transferências de itens', 'pdv.mesa_trocada': 'Trocas de mesa',
  'autorizacao.concedida': 'Autorizações concedidas', 'autorizacao.negada': 'Autorizações negadas', 'leitura.desconhecida': 'Códigos desconhecidos lidos',
  'pdv.excecao_manual': 'Exceções manuais', 'pagamento.estornado': 'Estornos', 'pdv.taxa_servico': 'Ajustes de taxa de serviço' };
const TABS = [['geral', 'Visão geral'], ['produtos', 'Produtos'], ['equipe', 'Equipe e mesas'], ['controle', 'Controle'], ['operacao', 'Operação'], ['financeiro', 'Financeiro']];

export default function Reports() {
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 6 * 86400000)));
  const [to, setTo] = useState(iso(today));
  const [tab, setTab] = useState('geral');
  const toast = useToast();
  const r = useLoad(() => api(`/api/reports/overview?from=${from}&to=${to}`), [from, to]);
  const preset = (days) => {
    if (days == null) { setFrom(iso(new Date(today.getFullYear(), today.getMonth(), 1))); setTo(iso(today)); return; }
    setFrom(iso(new Date(today.getTime() - days * 86400000))); setTo(iso(today));
  };
  const exp = (section) => download(`/api/reports/export?section=${section}&from=${from}&to=${to}`, `rusten-${section}-${from}-${to}.csv`).catch((e) => toast(e.message, 'bad'));
  const d = r.data;
  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Período pelo dia comercial (respeita o horário de virada do dia)."
        actions={<button className="btn-ghost no-print" onClick={() => window.print()}><Printer size={16} /> Imprimir</button>} />
      <div className="no-print mb-4 flex flex-wrap items-end gap-2">
        {PRESETS.map(([k, l, days]) => <button key={k} className="btn-ghost py-1.5" onClick={() => preset(days)}>{l}</button>)}
        <label className="text-sm">De <input type="date" className="input inline w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">até <input type="date" className="input inline w-auto" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="no-print mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-semibold uppercase tracking-wide ${tab === k ? 'border-copper text-copper' : 'border-transparent text-muted hover:text-ink'}`}>{l}</button>)}
      </div>
      <p className="mb-3 hidden text-sm print:block">Período: {dateBR(from)} a {dateBR(to)}</p>
      {r.loading && !d ? <Loading /> : r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : (
        <div className={r.loading ? 'opacity-60' : ''}>
          {tab === 'geral' && <Overview d={d} />}
          {tab === 'produtos' && <Products d={d} exp={exp} />}
          {tab === 'equipe' && <Team d={d} exp={exp} />}
          {tab === 'controle' && <Control d={d} />}
          {tab === 'operacao' && <Operation d={d} />}
          {tab === 'financeiro' && <Financial d={d} exp={exp} />}
          <Bases />
        </div>
      )}
    </div>
  );
}

const Kpi = ({ label, value, hint }) => <div className="card p-3"><div className="text-xs uppercase text-muted">{label}</div><div className="font-display text-3xl leading-tight">{value ?? '—'}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>;
const hidden = <span className="text-xs text-muted">sem permissão</span>;
const m = (v) => (v == null ? hidden : money(v));

function Bars({ rows, label, value, fmt = money }) {
  const max = Math.max(1, ...rows.map((x) => Number(value(x)) || 0));
  if (!rows.length) return <p className="text-sm text-muted">Sem dados no período.</p>;
  return (
    <div className="space-y-1">
      {rows.map((x, i) => (
        <div key={i} className="grid grid-cols-[90px_1fr_110px] items-center gap-2 text-sm">
          <span className="truncate text-muted">{label(x)}</span>
          <div className="h-5 rounded bg-raised"><div className="h-5 rounded bg-copper" style={{ width: `${(Number(value(x)) / max) * 100}%` }} /></div>
          <span className="text-right font-mono text-xs">{fmt(value(x))}</span>
        </div>
      ))}
    </div>
  );
}

function Overview({ d }) {
  const s = d.summary;
  const fin = d.permissions.financial;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="Faturamento" value={m(s.revenue_cents)} hint={fin ? `consumo ${money(s.items_cents)} + serviço ${money(s.service_fee_cents)} + entrega ${money(s.delivery_fee_cents)}` : null} />
        <Kpi label="Recebido" value={m(s.received_cents)} />
        <Kpi label="Ticket médio" value={m(s.ticket_cents)} hint={`${s.sessions} consumo(s) encerrado(s)`} />
        <Kpi label="Em aberto agora" value={m(s.open_balance_cents)} hint={`${s.open_sessions} consumo(s) aberto(s)`} />
        {d.permissions.cmv && <><Kpi label="CMV" value={money(s.cmv_cents)} /><Kpi label="Margem bruta" value={s.margin_pct != null ? `${s.margin_pct.toLocaleString('pt-BR')}%` : '—'} /></>}
      </div>
      {fin && <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4"><h3 className="mb-2 font-display text-xl">Vendas por dia</h3><Bars rows={d.by_day} label={(x) => dateBR(x.day)} value={(x) => x.items_cents} /></section>
        <section className="card p-4"><h3 className="mb-2 font-display text-xl">Vendas por hora</h3><Bars rows={d.by_hour} label={(x) => `${String(x.hour).padStart(2, '0')}h`} value={(x) => x.items_cents} /></section>
        <section className="card p-4"><h3 className="mb-2 font-display text-xl">Por canal</h3><Bars rows={d.by_channel} label={(x) => CHANNEL[x.channel] || x.channel} value={(x) => x.items_cents} /></section>
        <section className="card p-4"><h3 className="mb-2 font-display text-xl">Por categoria</h3><Bars rows={d.by_category} label={(x) => x.name} value={(x) => x.items_cents} /></section>
      </div>}
    </div>
  );
}

function Products({ d, exp }) {
  const cmv = d.permissions.cmv;
  return (
    <section className="card overflow-x-auto">
      <div className="flex items-center justify-between p-3"><h3 className="font-display text-xl">Produtos vendidos</h3><button className="btn-ghost no-print py-1" onClick={() => exp('produtos')}><Download size={14} /> CSV</button></div>
      <table className="table-clean">
        <thead><tr><th>Curva</th><th>Produto</th><th>Categoria</th><th className="text-right">Qtd</th><th className="text-right">Vendido</th>{cmv && <><th className="text-right">CMV</th><th className="text-right">Margem</th></>}</tr></thead>
        <tbody>{d.by_product.map((p) => (
          <tr key={p.product_id}><td><span className={`chip ${p.abc === 'A' ? 'border-ok text-ok' : p.abc === 'B' ? 'border-warn text-warn' : 'border-line text-muted'}`}>{p.abc}</span></td>
            <td className="font-semibold">{p.name}</td><td className="text-muted">{p.category || '—'}</td><td className="text-right">{Number(p.qty).toLocaleString('pt-BR')}</td><td className="text-right">{m(p.items_cents)}</td>
            {cmv && <><td className="text-right">{money(p.cost_cents)}</td><td className="text-right">{p.items_cents ? `${Math.round(((p.items_cents - p.cost_cents) / p.items_cents) * 100)}%` : '—'}</td></>}</tr>
        ))}</tbody>
      </table>
      {!d.by_product.length && <p className="p-3 text-sm text-muted">Sem vendas no período.</p>}
    </section>
  );
}

function Team({ d, exp }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card overflow-x-auto"><div className="flex items-center justify-between p-3"><h3 className="font-display text-xl">Por garçom/operador</h3><button className="btn-ghost no-print py-1" onClick={() => exp('garcons')}><Download size={14} /> CSV</button></div>
        <table className="table-clean"><tbody>{d.by_user.map((u, i) => <tr key={i}><td>{u.name || 'Pedido online'}</td><td className="text-right">{u.items} itens</td><td className="text-right">{m(u.items_cents)}</td></tr>)}</tbody></table></section>
      <section className="card overflow-x-auto"><div className="flex items-center justify-between p-3"><h3 className="font-display text-xl">Mesas (giro e permanência)</h3><button className="btn-ghost no-print py-1" onClick={() => exp('mesas')}><Download size={14} /> CSV</button></div>
        <table className="table-clean"><thead><tr><th>Mesa</th><th className="text-right">Giros</th><th className="text-right">Permanência</th><th className="text-right">Vendido</th></tr></thead>
          <tbody>{d.by_table.map((t) => <tr key={t.number}><td>Mesa {t.number}</td><td className="text-right">{t.sessions}</td><td className="text-right">{t.avg_minutes ?? '—'} min</td><td className="text-right">{m(t.items_cents)}</td></tr>)}</tbody></table></section>
      <section className="card overflow-x-auto"><h3 className="p-3 font-display text-xl">Por terminal</h3>
        <table className="table-clean"><tbody>{d.by_terminal.map((u, i) => <tr key={i}><td>{u.name}</td><td className="text-right">{u.items} itens</td><td className="text-right">{m(u.items_cents)}</td></tr>)}</tbody></table></section>
    </div>
  );
}

function Control({ d }) {
  const c = d.control;
  const totalModes = Object.values(c.launch_modes).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4"><h3 className="font-display text-xl">Cancelamentos e descontos</h3>
        <table className="table-clean mt-2"><tbody>
          <tr><td>Itens cancelados</td><td className="text-right">{c.canceled_items}</td><td className="text-right">{m(c.canceled_cents)}</td></tr>
          <tr><td>Itens com desconto</td><td className="text-right">{c.discounted_items}</td><td className="text-right">{m(c.discounts_cents)}</td></tr>
        </tbody></table></section>
      <section className="card p-4"><h3 className="font-display text-xl">Forma de lançamento</h3>
        <table className="table-clean mt-2"><tbody>{Object.entries(c.launch_modes).map(([k, n]) => <tr key={k}><td>{MODE[k] || k}</td><td className="text-right">{n}</td><td className="text-right text-muted">{Math.round((n / totalModes) * 100)}%</td></tr>)}</tbody></table></section>
      <section className="card p-4 lg:col-span-2"><h3 className="font-display text-xl">Ocorrências auditadas</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{Object.entries(EVENTS).map(([k, l]) => <Kpi key={k} label={l} value={c.events[k] || 0} />)}</div></section>
    </div>
  );
}

function Operation({ d }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4"><h3 className="font-display text-xl">Tempo de produção</h3>
        {!d.kitchen.length ? <p className="text-sm text-muted">Sem itens produzidos pelo KDS no período.</p> : (
          <table className="table-clean mt-2"><thead><tr><th>Setor</th><th className="text-right">Itens</th><th className="text-right">Média</th><th className="text-right">Atrasados</th></tr></thead>
            <tbody>{d.kitchen.map((k) => <tr key={k.sector}><td>{k.sector}</td><td className="text-right">{k.items}</td><td className="text-right">{k.avg_minutes?.toLocaleString('pt-BR')} min</td><td className="text-right">{k.late}</td></tr>)}</tbody></table>)}</section>
      <section className="card p-4"><h3 className="font-display text-xl">Delivery</h3>
        <table className="table-clean mt-2"><tbody><tr><td>Pedidos</td><td className="text-right">{d.delivery.orders}</td></tr><tr><td>Cancelados</td><td className="text-right">{d.delivery.canceled}</td></tr>
          <tr><td>Tempo médio até a entrega</td><td className="text-right">{d.delivery.avg_minutes_to_deliver ?? '—'} min</td></tr></tbody></table></section>
      {d.stock && <section className="card p-4"><h3 className="font-display text-xl">Estoque</h3>
        <table className="table-clean mt-2"><tbody><tr><td>Perdas registradas</td><td className="text-right">{money(d.stock.losses_cents)}</td></tr>
          <tr><td>Divergência de inventário</td><td className="text-right">{money(d.stock.inventory_diff_cents)}</td></tr></tbody></table></section>}
      <section className="card p-4"><h3 className="font-display text-xl">Clientes e fidelidade</h3>
        <table className="table-clean mt-2"><tbody>
          <tr><td>Clientes identificados</td><td className="text-right">{d.customers.identified}</td></tr>
          <tr><td>Clientes que voltaram</td><td className="text-right">{d.customers.returning}</td></tr>
          <tr><td>Pontos ganhos / resgatados</td><td className="text-right">{d.customers.loyalty.earned} / {d.customers.loyalty.redeemed}</td></tr>
          <tr><td>Avaliações (média)</td><td className="text-right">{d.customers.reviews.n} {d.customers.reviews.average ? `(${d.customers.reviews.average.toLocaleString('pt-BR')} ★)` : ''}</td></tr>
        </tbody></table></section>
    </div>
  );
}

function Financial({ d, exp }) {
  if (!d.permissions.financial) return <div className="card p-4 text-sm text-muted">Seu perfil não tem acesso a dados financeiros.</div>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card overflow-x-auto"><div className="flex items-center justify-between p-3"><h3 className="font-display text-xl">Recebimentos por forma</h3><button className="btn-ghost no-print py-1" onClick={() => exp('pagamentos')}><Download size={14} /> CSV</button></div>
        <table className="table-clean"><tbody>{d.payments.map((p) => <tr key={p.method}><td>{METHOD[p.method]}</td><td className="text-right">{p.n}</td><td className="text-right">{money(p.total)}</td></tr>)}</tbody></table></section>
      <section className="card p-4"><h3 className="font-display text-xl">Caixa</h3>
        <table className="table-clean mt-2"><tbody><tr><td>Caixas fechados</td><td className="text-right">{d.cash.sessions}</td></tr><tr><td>Com diferença</td><td className="text-right">{d.cash.with_difference}</td></tr>
          <tr><td>Diferença total</td><td className="text-right">{money(d.cash.difference_cents)}</td></tr>
          {d.movements.map((x) => <tr key={x.kind}><td className="capitalize">{x.kind}s</td><td className="text-right" colSpan={1}>{money(x.total)}</td></tr>)}
          <tr><td>Taxa de serviço (conta separada)</td><td className="text-right">{money(d.summary.service_fee_cents)}</td></tr></tbody></table></section>
      {d.dre && <section className="card p-4 lg:col-span-2"><h3 className="font-display text-xl">DRE gerencial (simplificada)</h3>
        <table className="table-clean mt-2"><tbody>
          <tr><td>Receita de consumo</td><td className="text-right">{money(d.dre.receita_bruta - d.dre.taxa_servico - d.dre.taxa_entrega)}</td></tr>
          <tr><td>(−) CMV</td><td className="text-right text-rust">{money(-d.dre.cmv)}</td></tr>
          <tr className="font-semibold"><td>= Lucro bruto</td><td className="text-right">{money(d.dre.lucro_bruto)}</td></tr>
          <tr><td>(−) Despesas pagas pelo caixa</td><td className="text-right text-rust">{money(-d.dre.despesas_caixa)}</td></tr>
          <tr className="font-display text-xl"><td>= Resultado operacional</td><td className="text-right">{money(d.dre.resultado)}</td></tr>
        </tbody></table>
        <p className="mt-2 text-xs text-muted">Taxa de serviço ({money(d.dre.taxa_servico)}) e taxa de entrega ({money(d.dre.taxa_entrega)}) ficam fora da receita de consumo. Despesas fixas (aluguel, folha) não são registradas no RUSTEN.</p></section>}
    </div>
  );
}

function Bases() {
  return (
    <details className="card no-print mt-6 p-4 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Info size={16} /> Como os indicadores são calculados</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li><b>Faturamento</b>: consumo (itens ativos) + taxa de serviço + taxa de entrega dos consumos encerrados no período.</li>
        <li><b>Recebido</b>: pagamentos confirmados no período, pela data comercial do pagamento. Estornados não contam.</li>
        <li><b>Ticket médio</b>: faturamento ÷ número de consumos encerrados.</li>
        <li><b>CMV</b>: custo dos insumos baixados na venda (custo médio do momento). Itens sem baixa registrada usam o custo do produto (teórico da ficha técnica ou cadastrado) × quantidade.</li>
        <li><b>Curva ABC</b>: A = produtos que somam até 80% do vendido; B até 95%; C o restante.</li>
        <li><b>Giro de mesa</b>: consumos encerrados por mesa; <b>permanência</b>: média entre abertura e fechamento.</li>
        <li><b>Tempo de produção</b>: do envio à produção até "pronto"; atrasado = acima do tempo-alvo do setor.</li>
        <li>Valores financeiros só aparecem para quem tem "Ver dados financeiros"; CMV e margem só para "Ver CMV e margem" — inclusive nas exportações.</li>
      </ul>
    </details>
  );
}
