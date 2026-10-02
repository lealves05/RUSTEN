// Financeiro › Vendas da maquininha: importa o "Relatório de vendas" da InfinitePay (PDF) com as vendas feitas
// direto na maquininha, confere os números, compara com o que já foi lançado no RUSTEN e registra.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp, Info, Loader2, PackageMinus, Plus, Trash2, XCircle } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { money, dateBR, dateTime } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { parseInfinitePayReport, pageRows } from '../lib/posReportParse.js';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useLoad, useToast } from '../components/ui.jsx';

const MODES = {
  externa: ['Vendas feitas só na maquininha', 'Somam ao faturamento nos relatórios (não passaram por comanda do RUSTEN).'],
  conferencia: ['Já lançadas nas comandas', 'Ficam só para conferência: não somam de novo ao faturamento.'],
};
const METHOD = { debito: 'Débito', credito: 'Crédito', pix: 'Pix', dinheiro: 'Dinheiro', outro: 'Outro' };
const MAX = 5 * 1024 * 1024;

// lê o PDF no navegador (pdf.js carregado só nesta tela)
async function readPdf(file) {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: true }).promise;
  const rows = [];
  for (let n = 1; n <= Math.min(doc.numPages, 40); n++) rows.push(...pageRows((await (await doc.getPage(n)).getTextContent()).items));
  await doc.destroy();
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return { rows, b64: btoa(bin) };
}

export default function PosSales() {
  const s = useSession();
  const list = useLoad(() => api('/api/pos-sales'), []);
  const [importing, setImporting] = useState(false);
  const [detail, setDetail] = useState(null);
  if (!s.can('financeiro.visualizar')) return <Empty title="Sem acesso">Seu perfil não tem acesso a dados financeiros.</Empty>;
  return (
    <div>
      <PageHeader title="Vendas da maquininha" subtitle="Vendas feitas direto na maquininha InfinitePay, importadas do relatório de vendas (PDF)."
        actions={<button className="btn-primary" onClick={() => setImporting(true)} data-pos-import><FileUp size={16} /> Importar relatório</button>} />
      {importing && <ImportFlow onClose={() => setImporting(false)} onDone={(id) => { setImporting(false); list.reload(); setDetail(id); }} />}
      {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[['Vendido na maquininha', money(list.data.totals.gross_cents)], ['Líquido', money(list.data.totals.net_cents)], ['Taxas', money(list.data.totals.fee_cents)], ['Transações', list.data.totals.tx_count]].map(([l, v]) => (
              <div key={l} className="card p-3"><div className="text-xs uppercase text-muted">{l}</div><div className="font-display text-3xl">{v}</div></div>))}
          </div>
          <p className="text-xs text-muted">Somatório das importações ativas marcadas como "{MODES.externa[0]}". Os relatórios do RUSTEN mostram esses valores pelo período escolhido.</p>
          {!list.data.items.length ? (
            <Empty icon={FileUp} title="Nenhum relatório importado">No app ou portal da InfinitePay, gere o relatório de vendas do período (valores por dia) e importe o PDF aqui.</Empty>
          ) : (
            <div className="card overflow-x-auto"><table className="table-clean" data-pos-list>
              <thead><tr><th>Período</th><th>Arquivo</th><th>Tipo</th><th className="text-right">Bruto</th><th className="text-right">Taxas</th><th className="text-right">Líquido</th><th className="text-right">Transações</th><th>Situação</th><th /></tr></thead>
              <tbody>{list.data.items.map((x) => (
                <tr key={x.id} className={x.status === 'cancelado' ? 'opacity-60' : ''}>
                  <td className="whitespace-nowrap">{dateBR(x.period_from)} a {dateBR(x.period_to)}</td>
                  <td>{x.file_name}<div className="text-xs text-muted">{dateTime(x.created_at, s.tz)}{x.user_name ? ` · ${x.user_name}` : ''}</div></td>
                  <td><Badge tone={x.mode === 'externa' ? 'ok' : 'info'}>{x.mode === 'externa' ? 'fora do RUSTEN' : 'conferência'}</Badge></td>
                  <td className="text-right">{money(x.gross_cents)}</td><td className="text-right text-rust">{money(x.fee_cents)}</td><td className="text-right">{money(x.net_cents)}</td>
                  <td className="text-right">{x.tx_count}</td>
                  <td>{x.status === 'ativo' ? <Badge tone="ok">ativa</Badge> : <Badge tone="muted">cancelada</Badge>}{x.cancel_reason && <div className="text-xs text-muted">{x.cancel_reason}</div>}</td>
                  <td><button className="btn-ghost py-1 text-xs" onClick={() => setDetail(x.id)}>Detalhes</button></td>
                </tr>))}</tbody></table></div>
          )}
          <Help />
        </div>
      )}
      {detail && <Detail id={detail} onClose={() => setDetail(null)} onChanged={list.reload} />}
    </div>
  );
}

function ImportFlow({ onClose, onDone }) {
  const toast = useToast();
  const input = useRef(null);
  const [st, setSt] = useState({ step: 'arquivo' });
  const [mode, setMode] = useState('externa');
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (file) => {
    if (!file) return;
    if (file.size > MAX) return setSt({ step: 'arquivo', error: 'Arquivo maior que 5 MB.' });
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return setSt({ step: 'arquivo', error: 'Envie o PDF do relatório de vendas.' });
    setSt({ step: 'lendo', file });
    try {
      const { rows, b64 } = await readPdf(file);
      const parsed = parseInfinitePayReport(rows);
      if (!parsed.ok) return setSt({ step: 'arquivo', error: parsed.errors.join(' ') });
      const pv = await api('/api/pos-sales/preview', { method: 'POST', body: { file_name: file.name, file_b64: b64, report: parsed.report } });
      // se o RUSTEN já tem cartão/Pix lançado nesses dias, sugere "conferência" para não somar duas vezes
      const already = pv.reconciliation.reduce((a, r) => a + r.rusten_card_pix_cents, 0);
      setMode(already >= parsed.report.gross_cents * 0.5 ? 'conferencia' : 'externa');
      setReplace(false);
      setSt({ step: 'conferir', file, b64, report: parsed.report, pv });
    } catch (e) { setSt({ step: 'arquivo', error: e.message || 'Não foi possível ler o PDF.' }); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api('/api/pos-sales', { method: 'POST', body: { file_name: st.file.name, file_b64: st.b64, mode, replace, report: st.report } });
      toast(r.replaced.length ? 'Relatório importado (o anterior foi substituído)' : 'Vendas da maquininha registradas');
      onDone(r.id);
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const r = st.report; const pv = st.pv;
  const blocked = pv && (pv.problems.length || pv.duplicate || (pv.overlaps.length && !replace));
  return (
    <Modal open wide onClose={onClose} title="Importar relatório de vendas da InfinitePay"
      footer={st.step === 'conferir' && <><button className="btn-ghost" onClick={() => setSt({ step: 'arquivo' })}>Escolher outro arquivo</button>
        <button className="btn-primary" disabled={busy || !!blocked} onClick={save} data-pos-confirm>{busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Registrar no sistema</button></>}>
      {st.step !== 'conferir' && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>No app ou portal da InfinitePay, abra <b>Relatórios › Vendas</b> e escolha o período.</li>
            <li>Gere o relatório com os <b>valores por dia</b> e baixe o PDF.</li>
            <li>Selecione o arquivo abaixo: o RUSTEN lê, confere os totais e mostra tudo antes de registrar.</li>
          </ol>
          <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} data-pos-file />
          <button className="btn-primary w-full justify-center py-6 text-lg" disabled={st.step === 'lendo'} onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
            {st.step === 'lendo' ? <><Loader2 className="animate-spin" /> Lendo {st.file?.name}…</> : <><FileUp /> Selecionar PDF (ou arraste aqui)</>}
          </button>
          {st.error && <div className="flex gap-2 rounded-lg border border-rust p-3 text-sm text-rust"><XCircle size={18} className="shrink-0" /> {st.error}</div>}
        </div>
      )}
      {st.step === 'conferir' && (
        <div className="space-y-4" data-pos-preview>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box l="Período" v={`${dateBR(r.period_from)} a ${dateBR(r.period_to)}`} small />
            <Box l="Receita bruta" v={money(r.gross_cents)} />
            <Box l="Taxas" v={money(r.fee_cents)} />
            <Box l="Receita líquida" v={money(r.net_cents)} />
          </div>
          <p className="text-xs text-muted">Conta: {r.account || '—'} · gerado em {dateBR(r.generated_on)} · {r.tx_count} transações · arquivo {st.file.name}</p>
          {pv.problems.length > 0 && <Alert tone="bad">Os números do relatório não fecham: {pv.problems.join('; ')}. Gere o relatório novamente.</Alert>}
          {pv.duplicate && <Alert tone="bad">Este mesmo arquivo já foi importado em {dateTime(pv.duplicate.created_at)}.</Alert>}
          {pv.overlaps.length > 0 && !pv.duplicate && (
            <Alert tone="warn">
              Já existe importação para parte destes dias: {pv.overlaps.map((o) => `${o.file_name} (${dateBR(o.period_from)} a ${dateBR(o.period_to)})`).join(', ')}.
              <label className="mt-2 flex items-center gap-2 font-semibold"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} data-pos-replace /> Substituir a importação anterior por esta</label>
            </Alert>
          )}
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <section className="min-w-0"><h3 className="mb-1 font-display text-xl">Por dia</h3><DaysTable rows={pv.reconciliation} /></section>
            <section className="min-w-0"><h3 className="mb-1 font-display text-xl">Por forma</h3>
              <table className="table-clean"><tbody>{r.methods.map((m) => <tr key={m.label}><td>{m.label}{/money/i.test(m.label) ? ' (dinheiro)' : ''}</td><td className="text-right">{money(m.gross_cents)}</td></tr>)}</tbody></table>
              {r.products.length > 0 && <><h3 className="mb-1 mt-3 font-display text-xl">Mais vendidos</h3>
                <p className="text-xs text-muted">{r.products.slice(0, 6).map((p) => `${p.name} (${p.qty})`).join(' · ')}</p></>}
            </section>
          </div>
          <Field label="Como registrar estas vendas?">
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(MODES).map(([k, [t, d]]) => (
                <label key={k} className={`card cursor-pointer p-3 ${mode === k ? 'border-copper ring-1 ring-copper' : ''}`}>
                  <input type="radio" name="pos-mode" className="mr-2" checked={mode === k} onChange={() => setMode(k)} data-pos-mode={k} /><b>{t}</b>
                  <div className="text-xs text-muted">{d}</div>
                </label>))}
            </div>
          </Field>
        </div>
      )}
    </Modal>
  );
}

const Box = ({ l, v, small }) => <div className="card p-3"><div className="text-xs uppercase text-muted">{l}</div><div className={small ? 'font-semibold' : 'font-display text-2xl'}>{v}</div></div>;
const Alert = ({ tone, children }) => (
  <div className={`flex gap-2 rounded-lg border p-3 text-sm ${tone === 'bad' ? 'border-rust text-rust' : 'border-warn'}`}><AlertTriangle size={18} className="shrink-0" /><div>{children}</div></div>
);

// comparação por dia: o que a maquininha vendeu × o que o RUSTEN já tem de cartão/Pix nas comandas
function DaysTable({ rows }) {
  return (
    <div className="overflow-x-auto"><table className="table-clean">
      <thead><tr><th>Dia</th><th className="text-right">Maquininha</th><th className="text-right" title="Transações">Qtd</th><th className="whitespace-nowrap text-right" title="Cartão e Pix já lançados nas comandas do RUSTEN no mesmo dia comercial">No RUSTEN*</th></tr></thead>
      <tbody>{rows.map((d) => (
        <tr key={d.day}><td>{dateBR(d.day)}</td><td className="text-right">{money(d.report_gross_cents)}</td><td className="text-right">{d.report_tx}</td>
          <td className={`text-right ${d.rusten_card_pix_cents ? 'font-semibold text-warn' : 'text-muted'}`}>{money(d.rusten_card_pix_cents)}</td></tr>))}</tbody>
    </table>
    <p className="mt-1 text-xs text-muted">* Cartão e Pix já lançados nas comandas do RUSTEN no mesmo dia. Se for parecido com a maquininha, as vendas já estão no sistema: use "Já lançadas nas comandas".</p></div>
  );
}

function Detail({ id, onClose, onChanged }) {
  const s = useSession();
  const toast = useToast();
  const d = useLoad(() => api(`/api/pos-sales/${id}`), [id]);
  const [reason, setReason] = useState('');
  const [canceling, setCanceling] = useState(false);
  const x = d.data;
  const cancel = async () => {
    try { await api(`/api/pos-sales/${id}/cancel`, { method: 'POST', body: { reason } }); toast('Importação cancelada'); onChanged(); d.reload(); setCanceling(false); }
    catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <Modal open wide onClose={onClose} title={x ? `Relatório ${dateBR(x.period_from)} a ${dateBR(x.period_to)}` : 'Relatório'}
      footer={x && <>
        <button className="btn-ghost" onClick={() => download(`/api/pos-sales/${id}/file`, x.file_name).catch((e) => toast(e.message, 'bad'))}><Download size={16} /> PDF original</button>
        {x.status === 'ativo' && s.can('financeiro.estornar') && <button className="btn-ghost text-rust" onClick={() => setCanceling(true)} data-pos-cancel>Cancelar importação</button>}
      </>}>
      {d.loading && !x ? <Loading /> : d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : (
        <div className="space-y-4" data-pos-detail>
          <div className="flex flex-wrap gap-2">
            <Badge tone={x.mode === 'externa' ? 'ok' : 'info'}>{MODES[x.mode][0]}</Badge>
            {x.status === 'ativo' ? <Badge tone="ok">ativa</Badge> : <Badge tone="muted">cancelada{x.cancel_reason ? `: ${x.cancel_reason}` : ''}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box l="Receita bruta" v={money(x.gross_cents)} /><Box l="Taxas" v={money(x.fee_cents)} /><Box l="Receita líquida" v={money(x.net_cents)} /><Box l="Transações" v={x.tx_count} />
          </div>
          <p className="text-xs text-muted">Conta {x.account_label || '—'} · importado em {dateTime(x.created_at, s.tz)} por {x.user_name || '—'} · arquivo {x.file_name} (SHA-256 {x.file_sha256.slice(0, 12)}…)</p>
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <section className="min-w-0"><h3 className="mb-1 font-display text-xl">Por dia</h3><DaysTable rows={x.reconciliation} /></section>
            <section className="min-w-0"><h3 className="mb-1 font-display text-xl">Por forma</h3>
              <table className="table-clean"><tbody>{x.methods.map((m) => <tr key={m.label}><td>{METHOD[m.method]}{m.label !== METHOD[m.method] ? <span className="text-xs text-muted"> ({m.label})</span> : null}</td><td className="text-right">{money(m.gross_cents)}</td></tr>)}</tbody></table>
              {x.categories.length > 0 && <><h3 className="mb-1 mt-3 font-display text-xl">Categorias</h3>
                <table className="table-clean"><tbody>{x.categories.map((c) => <tr key={c.name}><td>{c.name}</td><td className="text-right">{c.qty}</td></tr>)}</tbody></table></>}
            </section>
          </div>
          <StockOut key={`${id}-${x.status}`} id={id} />
          {x.notes.length > 0 && <p className="flex gap-2 text-xs text-muted"><Info size={14} className="shrink-0" /> {x.notes.join(' ')}</p>}
          {canceling && (
            <div className="card space-y-2 border-rust p-3">
              <Field label="Motivo do cancelamento" hint="Os valores saem dos relatórios; a importação continua no histórico."><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-pos-reason /></Field>
              <div className="flex gap-2"><button className="btn-ghost" onClick={() => setCanceling(false)}>Voltar</button><button className="btn-primary" disabled={reason.trim().length < 5} onClick={cancel} data-pos-cancel-confirm>Confirmar cancelamento</button></div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Help() {
  return (
    <details className="card p-4 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><Info size={16} /> Como funciona</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li>O relatório precisa ter os <b>valores por dia</b>. O RUSTEN confere se a soma dos dias e das formas bate com os totais antes de registrar.</li>
        <li><b>Vendas feitas só na maquininha</b> somam ao faturamento dos relatórios (bruto, taxas e líquido), na data do relatório.</li>
        <li><b>Já lançadas nas comandas</b>: use quando as vendas também foram registradas no Receber do RUSTEN; ficam só para conferência.</li>
        <li>A coluna <b>No RUSTEN</b> mostra o cartão e o Pix lançados nas comandas no mesmo dia, para você decidir.</li>
        <li>O mesmo arquivo não entra duas vezes, e um dia não pode estar em duas importações ativas. Para corrigir, cancele (com motivo) ou importe um relatório novo marcando "Substituir".</li>
        <li><b>Saída no estoque</b>: nos detalhes da importação, ligue cada produto da maquininha a um produto do cardápio e toque em <b>Lançar saída no estoque</b>. O estoque sai pela ficha técnica ou pelo produto acabado, uma única vez; o RUSTEN lembra o vínculo para os próximos relatórios.</li>
        <li>O relatório da InfinitePay traz só os produtos mais vendidos: acrescente à mão o que faltar antes de lançar. Cancelar a importação estorna a saída.</li>
      </ul>
    </details>
  );
}

const qtyBR = (n) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const STATUS = { pendente: ['warn', 'a lançar'], ignorado: ['muted', 'ignorado'], baixado: ['ok', 'lançado'], estornado: ['muted', 'estornado'] };

// Produtos vendidos na maquininha → saída no estoque (pela ficha técnica ou produto acabado do cardápio)
function StockOut({ id }) {
  const toast = useToast();
  const d = useLoad(() => api(`/api/pos-sales/${id}/items`), [id]);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!d.data) return;
    // sugestão pelo nome já vem marcada (confira antes de lançar)
    setRows(d.data.rows.map((r) => ({ ...r, ignored: r.status === 'ignorado', product_id: r.product_id ?? r.suggestion?.product_id ?? null, suggested: !r.product_id && !!r.suggestion })));
    setDirty(d.data.rows.some((r) => !r.product_id && r.suggestion));
  }, [d.data]);
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  const v = d.data;
  if (!v.rows.length && !rows.length && v.status !== 'ativo') return null;
  const editable = v.status === 'ativo' && v.mode === 'externa' && v.can_edit;
  const open = (r) => r.status === 'pendente' || r.status === 'ignorado' || !r.status;
  const set = (i, patch) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch, suggested: patch.product_id !== undefined ? false : r.suggested } : r))); setDirty(true); };
  const payload = () => ({ rows: rows.map((r) => ({ ...(r.id ? { id: r.id } : { report_name: r.report_name || undefined }), qty: Number(r.qty), product_id: r.product_id ? Number(r.product_id) : null, ignored: !!r.ignored })) });
  const save = async () => {
    setBusy(true);
    try { await api(`/api/pos-sales/${id}/items`, { method: 'PUT', body: payload() }); d.reload(); setDirty(false); toast('Conferência salva'); }
    catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const post = async () => {
    setBusy(true);
    try {
      await api(`/api/pos-sales/${id}/items`, { method: 'PUT', body: payload() });
      const r = await api(`/api/pos-sales/${id}/items/post`, { method: 'POST' });
      toast(`Saída lançada no estoque: ${r.posted} produto(s)${r.without_stock.length ? ` — sem controle de estoque: ${r.without_stock.join(', ')}` : ''}`);
      setDirty(false); d.reload();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const pending = rows.filter((r) => open(r) && !r.ignored);
  const product = (pid) => v.products.find((p) => Number(p.id) === Number(pid));
  // prévia calculada no servidor para o produto salvo (a quantidade é ajustada na hora)
  const srvRow = (r) => (r.id ? v.rows.find((o) => o.id === r.id) : null);
  const srvStock = (r) => { const o = srvRow(r); return o && Number(o.product_id) === Number(r.product_id) && o.stock?.length ? o.stock : null; };
  return (
    <section className="space-y-2" data-pos-stock>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-xl"><PackageMinus size={18} className="mr-1 inline" />Produtos vendidos → saída no estoque</h3>
        {v.rows.length > 0 && v.rows.every((r) => r.status !== 'pendente') && v.rows.some((r) => r.status === 'baixado') && <Badge tone="ok">estoque lançado</Badge>}
      </div>
      {v.mode !== 'externa' && <Alert tone="warn">Importação de conferência: estas vendas já baixaram o estoque pelas comandas, então não há saída a lançar.</Alert>}
      {v.mode === 'externa' && v.summary.missing_qty > 0 && (
        <Alert tone="warn">O relatório da InfinitePay mostra só os produtos mais vendidos: {qtyBR(v.summary.report_qty)} de {qtyBR(v.summary.categories_qty)} itens vendidos.
          Acrescente os {qtyBR(v.summary.missing_qty)} que faltam em <b>Acrescentar produto</b> antes de lançar, para o estoque ficar certo.</Alert>
      )}
      {!rows.length ? <p className="text-sm text-muted">O relatório não trouxe produtos. Acrescente os produtos vendidos para lançar a saída.</p> : (
        <div className="overflow-x-auto"><table className="table-clean" data-pos-stock-table>
          <thead><tr><th>Na maquininha</th><th className="w-24 text-right">Qtd</th><th>Produto do RUSTEN</th><th>Sai do estoque</th><th>Situação</th><th /></tr></thead>
          <tbody>{rows.map((r, i) => {
            const p = product(r.product_id);
            const can = editable && open(r);
            return (
              <tr key={r.id || `n${i}`} className={r.ignored ? 'opacity-60' : ''} data-pos-row={r.report_name}>
                <td className="font-semibold">{r.source === 'manual' || !r.id ? <span>{r.report_name || 'Acrescentado'} <span className="text-xs font-normal text-muted">(à mão)</span></span> : r.report_name}</td>
                <td className="text-right">{can ? <input className="input w-20 py-1 text-right" type="number" min="0.001" step="1" value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} data-pos-qty /> : qtyBR(r.qty)}</td>
                <td className="min-w-[200px]">
                  {can ? (
                    <select className={`input py-1 ${r.suggested ? 'border-warn' : ''}`} value={r.product_id || ''} disabled={r.ignored} onChange={(e) => set(i, { product_id: e.target.value ? Number(e.target.value) : null })} data-pos-product>
                      <option value="">— escolha o produto —</option>
                      {v.products.map((x) => <option key={x.id} value={x.id}>{x.name}{x.stock_mode === 'nenhum' ? ' (sem estoque)' : ''}</option>)}
                    </select>
                  ) : (p?.name || r.product_name || '—')}
                  {can && r.suggested && <div className="text-xs text-warn">sugerido pelo nome — confira</div>}
                </td>
                <td className="text-xs">
                  {r.moved?.length ? r.moved.map((m) => `${qtyBR(m.qty)} ${m.unit} ${m.name}`).join(' · ')
                    : srvStock(r) ? srvStock(r).map((m) => `${qtyBR(m.qty * (Number(r.qty) / Number(srvRow(r).qty)))} ${m.unit} ${m.name}`).join(' · ')
                      : p && p.stock_mode === 'nenhum' ? <span className="text-muted">produto sem controle de estoque</span>
                        : p ? <span className="text-muted">{dirty ? 'salve para ver' : '—'}</span> : <span className="text-muted">—</span>}
                </td>
                <td>{r.ignored && open(r) ? <Badge tone="muted">ignorado</Badge> : <Badge tone={STATUS[r.status || 'pendente'][0]}>{STATUS[r.status || 'pendente'][1]}</Badge>}</td>
                <td className="whitespace-nowrap">{can && (r.id && r.source !== 'manual'
                  ? <label className="text-xs"><input type="checkbox" checked={!!r.ignored} onChange={(e) => set(i, { ignored: e.target.checked })} data-pos-ignore /> ignorar</label>
                  : <button className="btn-ghost p-1" title="Remover" onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setDirty(true); }}><Trash2 size={14} /></button>)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => { setRows((rs) => [...rs, { report_name: '', qty: 1, product_id: null, source: 'manual', status: 'pendente' }]); setDirty(true); }} data-pos-add><Plus size={16} /> Acrescentar produto</button>
          <button className="btn-ghost" disabled={busy || !dirty} onClick={save} data-pos-save>Salvar conferência</button>
          <button className="btn-primary ml-auto" disabled={busy || !pending.length || pending.some((r) => !r.product_id)} onClick={post} data-pos-post>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <PackageMinus size={16} />} Lançar saída no estoque ({pending.length})
          </button>
        </div>
      )}
      {editable && pending.some((r) => !r.product_id) && <p className="text-xs text-rust">Escolha o produto de cada linha ou marque "ignorar" para lançar.</p>}
      {!v.can_edit && v.mode === 'externa' && v.status === 'ativo' && <p className="text-xs text-muted">Lançar a saída exige a permissão "Ajustar estoque".</p>}
    </section>
  );
}
