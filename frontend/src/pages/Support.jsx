// Suporte: contatos vindos da central (quando configurados) e ajuda rápida. Nenhum link fictício.
import { useSession } from '../lib/session.jsx';
import { Badge, PageHeader } from '../components/ui.jsx';

const FAQ = [
  ['Como uso a dupla leitura?', 'Em PDV, escolha "Dupla leitura". Leia a comanda (a barra mostra "AGUARDANDO PRODUTO") e em seguida o produto. Cada item exige um novo par. Esc cancela o par incompleto.'],
  ['E se o leitor quebrar?', 'Troque para Manual (se seu perfil permitir) ou digite o código no campo de leitura. Com dupla leitura obrigatória, use a exceção autorizada pelo gerente.'],
  ['Lancei um item e a internet caiu. Lanço de novo?', 'Não. Use "Conferir operação": ela consulta pela mesma identificação e nunca duplica.'],
  ['O cartão da comanda foi perdido.', 'Em Salão › Cartões de comanda, use "substituir (perdida)": o consumo passa para um cartão livre com todo o histórico.'],
  ['Consumo lançado é o mesmo que recebido?', 'Não. Lançar registra consumo; só pagamentos confirmados entram no caixa. Fechar a comanda exige saldo zero.'],
  ['Qual horário conta para o dia?', 'Cada unidade define até que horas a madrugada conta no dia anterior (Configurações › Unidades).'],
];

export default function Support() {
  const s = useSession();
  const sup = s.me.access?.support;
  return (
    <div className="max-w-3xl">
      <PageHeader title="Suporte" subtitle="Ajuda rápida e contato" />
      <div className="card p-4">
        {sup ? (
          <ul className="space-y-1 text-sm">
            {sup.whatsapp && <li>WhatsApp: <a className="underline" href={`https://wa.me/${String(sup.whatsapp).replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{sup.whatsapp}</a></li>}
            {sup.email && <li>E-mail: <a className="underline" href={`mailto:${sup.email}`}>{sup.email}</a></li>}
            {sup.hours && <li>Horário: {sup.hours}</li>}
            {sup.message && <li>{sup.message}</li>}
          </ul>
        ) : <p className="text-sm"><Badge tone="muted">Pendente</Badge> Os contatos do suporte são configurados pela administração da plataforma e aparecerão aqui.</p>}
      </div>
      <h2 className="mt-6 font-display text-2xl">Perguntas frequentes</h2>
      <div className="mt-2 space-y-2">
        {FAQ.map(([q, a]) => <details key={q} className="card p-3"><summary className="cursor-pointer font-semibold">{q}</summary><p className="mt-2 text-sm">{a}</p></details>)}
      </div>
      <p className="mt-4 text-xs text-muted">Atalhos: Ctrl+K busca · Alt+P PDV · Alt+S Salão · Alt+C Caixa · Alt+I Início · Esc cancela o par na dupla leitura.</p>
    </div>
  );
}
