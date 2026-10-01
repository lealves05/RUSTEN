// Reservas do dia: registradas pela equipe ou pedidas pelo agente (pendentes de confirmação).
import { useEffect, useState } from 'react';
import { CalendarDays, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { time } from '../lib/format.js';
import { useSession } from '../lib/session.jsx';
import { Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useLoad, useToast } from '../components/ui.jsx';

const ST = { pendente: ['warn', 'Pendente'], confirmada: ['ok', 'Confirmada'], cancelada: ['muted', 'Cancelada'], chegou: ['info', 'Chegou'], nao_compareceu: ['bad', 'Não veio'] };
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function Reservations() {
  const s = useSession();
  const toast = useToast();
  const [day, setDay] = useState(todayIso());
  const r = useLoad(() => api(`/api/reservations?day=${day}`), [day]);
  const tables = useLoad(() => api('/api/floor/tables').then((x) => x.tables), []);
  const [creating, setCreating] = useState(false);
  const set = async (x, status, extra = {}) => { try { await api(`/api/reservations/${x.id}/status`, { method: 'POST', body: { status, ...extra } }); r.reload(); } catch (e) { toast(e.message, 'bad'); } };
  return (
    <div>
      <PageHeader title="Reservas" subtitle="Pedidos do agente chegam como pendentes: confirme e escolha a mesa."
        actions={<>{s.can('salao.gerenciar') && <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={16} /> Nova reserva</button>}
          <input type="date" className="input w-auto" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Dia" /></>} />
      {r.loading && !r.data ? <Loading /> : r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : !r.data.length ? <Empty icon={CalendarDays} title="Sem reservas neste dia" /> : (
        <div className="card overflow-x-auto"><table className="table-clean">
          <thead><tr><th>Hora</th><th>Nome</th><th>Pessoas</th><th>Mesa</th><th>Origem</th><th>Situação</th><th /></tr></thead>
          <tbody>{r.data.map((x) => (
            <tr key={x.id}><td className="font-display text-xl">{time(x.starts_at, s.tz)}</td><td className="font-semibold">{x.customer_name}<div className="text-xs font-normal text-muted">{x.phone}{x.notes ? ` · ${x.notes}` : ''}</div></td>
              <td>{x.people}</td>
              <td>{s.can('salao.gerenciar') && ['pendente', 'confirmada'].includes(x.status) ? (
                <select className="input w-auto py-1" value={x.table_id || ''} onChange={(e) => set(x, x.status === 'pendente' ? 'confirmada' : x.status, { table_id: e.target.value ? Number(e.target.value) : null })} aria-label="Mesa">
                  <option value="">—</option>{(tables.data || []).map((t) => <option key={t.id} value={t.id}>Mesa {t.number}</option>)}</select>) : x.table_number ? `Mesa ${x.table_number}` : '—'}</td>
              <td className="text-xs">{x.source}</td><td><Badge tone={ST[x.status][0]}>{ST[x.status][1]}</Badge></td>
              <td className="whitespace-nowrap text-right">{s.can('salao.gerenciar') && <>
                {x.status === 'pendente' && <button className="text-xs underline" onClick={() => set(x, 'confirmada')}>confirmar</button>}
                {x.status === 'confirmada' && <><button className="text-xs underline" onClick={() => set(x, 'chegou')}>chegou</button> · <button className="text-xs underline" onClick={() => set(x, 'nao_compareceu')}>não veio</button></>}
                {['pendente', 'confirmada'].includes(x.status) && <> · <button className="text-xs underline text-rust" onClick={() => set(x, 'cancelada')}>cancelar</button></>}</>}</td></tr>
          ))}</tbody></table></div>
      )}
      <NewReservation open={creating} day={day} tables={tables.data || []} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); r.reload(); toast('Reserva registrada'); }} />
    </div>
  );
}

function NewReservation({ open, day, tables, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [err, setErr] = useState(null);
  useEffect(() => { if (open) { setErr(null); setF({ customer_name: '', phone: '', people: '2', date: day, time: '20:00', table_id: '', notes: '' }); } }, [open, day]);
  if (!open) return null;
  const save = async () => {
    try {
      const local = new Date(`${f.date}T${f.time}:00`);
      await api('/api/reservations', { method: 'POST', body: { customer_name: f.customer_name, phone: f.phone || undefined, people: Number(f.people), starts_at: local.toISOString(),
        table_id: f.table_id ? Number(f.table_id) : null, notes: f.notes || undefined } });
      onSaved();
    } catch (e) { setErr(e); }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="Nova reserva" footer={<><button className="btn-ghost" onClick={onClose}>Cancelar</button><button className="btn-primary" onClick={save}>Salvar</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome" className="col-span-2"><input className="input" value={f.customer_name} onChange={set('customer_name')} /></Field>
        <Field label="Telefone"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Pessoas"><input className="input" inputMode="numeric" value={f.people} onChange={set('people')} /></Field>
        <Field label="Dia"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Hora"><input className="input" type="time" value={f.time} onChange={set('time')} /></Field>
        <Field label="Mesa"><select className="input" value={f.table_id} onChange={set('table_id')}><option value="">A definir</option>{tables.map((t) => <option key={t.id} value={t.id}>Mesa {t.number} ({t.capacity} lug.)</option>)}</select></Field>
        <Field label="Observações"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
