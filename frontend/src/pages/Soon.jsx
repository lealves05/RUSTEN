// Módulos das próximas fases: aviso honesto, sem telas simuladas.
import { useParams } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { Empty, PageHeader } from '../components/ui.jsx';

const INFO = {
  cozinha: ['Cozinha, bar e KDS', 'Filas por setor, fluxo novo → aceito → preparando → pronto → entregue, alertas de atraso e impressão setorial. Os itens lançados hoje já guardam o setor e o estado de preparo.'],
  delivery: ['Delivery e cardápio digital', 'Página pública com cardápio, carrinho, entrega/retirada e acompanhamento de pedidos.'],
  estoque: ['Estoque, compras e fichas técnicas', 'Insumos, receitas versionadas, baixa por venda, compras, inventário e CMV.'],
  clientes: ['Clientes e fidelidade', 'Cadastro com consentimentos, histórico de consumo, pontos, crédito e avaliações.'],
  relatorios: ['Relatórios', 'Vendas por período/produto/garçom/mesa, CMV, uso da dupla leitura, exceções e taxa de serviço.'],
  marketing: ['Marketing', 'Campanhas com segmentação e consentimento, modelos e avaliações pós-consumo.'],
  agente: ['Agente WhatsApp', 'Atendimento pela API oficial: cardápio, pedidos, reservas e caixa de entrada da equipe.'],
};

export default function Soon() {
  const { mod } = useParams();
  const [title, desc] = INFO[mod] || ['Módulo', ''];
  return (
    <div>
      <PageHeader title={title} />
      <Empty icon={Wrench} title="Em construção nas próximas fases">{desc} Este módulo ainda não está disponível — nada nesta área é operacional.</Empty>
    </div>
  );
}
