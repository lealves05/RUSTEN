// Catálogo de permissões, perfis iniciais e módulos do RUSTEN.

export const PERMISSIONS = {
  'pdv.lancar': 'Lançar itens',
  'pdv.lancamento_manual': 'Lançamento manual (busca, catálogo, código digitado)',
  'pdv.alterar_modo': 'Trocar modo de leitura no PDV',
  'pdv.excecao_dupla_leitura': 'Exceção manual na dupla leitura obrigatória',
  'pdv.autorizar': 'Autorizar operações de outros usuários (gerente)',
  'pdv.abrir_comanda': 'Abrir comanda/mesa/balcão',
  'pdv.alterar_quantidade': 'Alterar quantidade na leitura',
  'pdv.alterar_preco': 'Alterar preço do item',
  'pdv.desconto': 'Conceder desconto',
  'pdv.cancelar_item': 'Cancelar item',
  'pdv.cancelar_venda': 'Cancelar consumo inteiro',
  'pdv.transferir_item': 'Transferir itens e consumos',
  'pdv.reabrir_comanda': 'Reabrir consumo encerrado',
  'pdv.receber': 'Receber pagamentos',
  'pdv.taxa_servico': 'Ajustar/remover taxa de serviço',
  'caixa.abrir': 'Abrir caixa',
  'caixa.fechar': 'Fechar caixa',
  'caixa.sangria': 'Sangria e despesa de caixa',
  'caixa.suprimento': 'Suprimento',
  'caixa.reabrir': 'Reabrir caixa',
  'financeiro.visualizar': 'Ver dados financeiros',
  'financeiro.estornar': 'Estornar pagamentos',
  'salao.visualizar': 'Ver salão e mesas',
  'salao.gerenciar': 'Cadastrar mesas e mudar situação',
  'cardapio.visualizar': 'Ver cardápio',
  'cardapio.gerenciar': 'Cadastrar produtos, preços e códigos',
  'comandas.gerenciar': 'Gerar, bloquear e substituir cartões de comanda',
  'estoque.ajustar': 'Ajustar estoque',
  'relatorios.visualizar': 'Ver relatórios',
  'relatorios.cmv': 'Ver CMV e margem',
  'usuarios.gerenciar': 'Gerenciar usuários e perfis',
  'configuracoes.gerenciar': 'Alterar configurações',
  'assinatura.gerenciar': 'Gerenciar assinatura',
  'auditoria.visualizar': 'Ver auditoria',
  'dados.pessoais': 'Ver dados pessoais de clientes',
};

const ALL = Object.keys(PERMISSIONS);
const without = (...ex) => ALL.filter((p) => !ex.includes(p));

export const DEFAULT_ROLES = [
  { key: 'owner', name: 'Proprietário', level: 100, permissions: ALL },
  { key: 'admin', name: 'Administrador', level: 90, permissions: without('assinatura.gerenciar') },
  { key: 'gerente', name: 'Gerente', level: 70, permissions: without('assinatura.gerenciar', 'usuarios.gerenciar', 'configuracoes.gerenciar') },
  { key: 'caixa', name: 'Caixa', level: 40, permissions: ['pdv.lancar', 'pdv.lancamento_manual', 'pdv.abrir_comanda', 'pdv.receber',
    'caixa.abrir', 'caixa.fechar', 'caixa.sangria', 'caixa.suprimento', 'salao.visualizar', 'cardapio.visualizar'] },
  { key: 'garcom', name: 'Garçom', level: 30, permissions: ['pdv.lancar', 'pdv.lancamento_manual', 'pdv.abrir_comanda',
    'salao.visualizar', 'cardapio.visualizar'] },
  { key: 'cozinha', name: 'Cozinha', level: 20, permissions: ['cardapio.visualizar'] },
  { key: 'bar', name: 'Bar', level: 20, permissions: ['cardapio.visualizar', 'pdv.lancar'] },
  { key: 'estoque', name: 'Estoque', level: 30, permissions: ['estoque.ajustar', 'cardapio.visualizar', 'relatorios.cmv'] },
  { key: 'financeiro', name: 'Financeiro', level: 50, permissions: ['financeiro.visualizar', 'financeiro.estornar',
    'relatorios.visualizar', 'relatorios.cmv', 'caixa.reabrir', 'auditoria.visualizar'] },
  { key: 'entregador', name: 'Entregador', level: 10, permissions: [] },
  { key: 'consulta', name: 'Consulta', level: 5, permissions: ['salao.visualizar', 'cardapio.visualizar', 'relatorios.visualizar'] },
];

// Módulos controláveis pela central (plano/empresa). Histórico continua acessível a perfis autorizados.
export const MODULES = {
  pdv: 'PDV e comandas',
  salao: 'Salão, mesas e reservas',
  cozinha: 'Cozinha, bar e KDS',
  delivery: 'Delivery e cardápio digital',
  cardapio: 'Cardápio',
  estoque: 'Estoque, compras e fichas técnicas',
  clientes: 'Clientes e fidelidade',
  financeiro: 'Caixa e financeiro',
  relatorios: 'Relatórios',
  marketing: 'Marketing',
  agente: 'Agente WhatsApp',
  fiscal: 'Fiscal',
  infinitepay: 'Importação e conciliação InfinitePay',
};

// Configuração padrão do motor de leitura (empresa → unidade → terminal)
export const DEFAULT_PDV = {
  scanner_enabled: true,
  mode: 'manual', // manual | continua | dupla
  double_read_mandatory: false, // política: exige dupla leitura; só exceção autorizada sai dela
  allow_manual: true,
  allow_manual_exception: true,
  exception_requires_manager: true,
  allow_mode_change: true,
  product_timeout_s: 15,
  open_free_card_on_scan: false,
  feedback_sound: true,
  qty_per_scan: 1,
  max_qty_per_scan: 20,
  terminator: 'Enter',
  kitchen_send: 'imediato', // imediato | lote
  require_open_cash: true,
  service_fee_bp: 1000,
  card_prefix: 'CMD-',
};
