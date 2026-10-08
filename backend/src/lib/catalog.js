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
  'clientes.visualizar': 'Ver clientes',
  'clientes.gerenciar': 'Cadastrar e editar clientes, pontos e consentimentos',
  'cozinha.operar': 'Operar a fila de produção (KDS)',
  'delivery.gerenciar': 'Gerenciar pedidos de delivery e retirada',
  'delivery.entregar': 'Registrar saída e entrega de pedidos',
  'estoque.visualizar': 'Ver estoque e fichas técnicas',
  'compras.gerenciar': 'Registrar compras e recebimentos',
  'marketing.gerenciar': 'Campanhas e avaliações',
  'agente.gerenciar': 'Configurar o agente de atendimento',
  'agente.atender': 'Atender conversas da caixa de entrada',
};

const ALL = Object.keys(PERMISSIONS);
const without = (...ex) => ALL.filter((p) => !ex.includes(p));

export const DEFAULT_ROLES = [
  { key: 'owner', name: 'Proprietário', level: 100, permissions: ALL },
  { key: 'admin', name: 'Administrador', level: 90, permissions: without('assinatura.gerenciar') },
  { key: 'gerente', name: 'Gerente', level: 70, permissions: without('assinatura.gerenciar', 'usuarios.gerenciar', 'configuracoes.gerenciar') },
  { key: 'caixa', name: 'Caixa', level: 40, permissions: ['pdv.lancar', 'pdv.lancamento_manual', 'pdv.abrir_comanda', 'pdv.receber',
    'caixa.abrir', 'caixa.fechar', 'caixa.sangria', 'caixa.suprimento', 'salao.visualizar', 'cardapio.visualizar',
    'clientes.visualizar', 'clientes.gerenciar'] },
  { key: 'garcom', name: 'Garçom', level: 30, permissions: ['pdv.lancar', 'pdv.lancamento_manual', 'pdv.abrir_comanda',
    'salao.visualizar', 'cardapio.visualizar', 'clientes.visualizar', 'clientes.gerenciar'] },
  { key: 'cozinha', name: 'Cozinha', level: 20, permissions: ['cardapio.visualizar', 'cozinha.operar'] },
  { key: 'bar', name: 'Bar', level: 20, permissions: ['cardapio.visualizar', 'pdv.lancar', 'cozinha.operar'] },
  { key: 'estoque', name: 'Estoque', level: 30, permissions: ['estoque.ajustar', 'estoque.visualizar', 'compras.gerenciar', 'cardapio.visualizar', 'relatorios.cmv'] },
  { key: 'financeiro', name: 'Financeiro', level: 50, permissions: ['financeiro.visualizar', 'financeiro.estornar',
    'relatorios.visualizar', 'relatorios.cmv', 'caixa.reabrir', 'auditoria.visualizar', 'estoque.visualizar', 'clientes.visualizar'] },
  { key: 'entregador', name: 'Entregador', level: 10, permissions: ['delivery.entregar'] },
  { key: 'consulta', name: 'Consulta', level: 5, permissions: ['salao.visualizar', 'cardapio.visualizar', 'relatorios.visualizar'] },
];

// Módulos controláveis pela central (plano/empresa). Histórico continua acessível a perfis autorizados.
export const MODULES = {
  pdv: 'PDV, comandas e caixa',
  salao: 'Salão e mesas',
  cozinha: 'Cozinha, bar e KDS',
  delivery: 'Delivery e cardápio digital',
  cardapio: 'Cardápio',
  estoque: 'Estoque, compras e fichas técnicas',
  clientes: 'Clientes e fidelidade',
  relatorios: 'Relatórios',
  marketing: 'Marketing',
  agente: 'Agente WhatsApp',
  infinitepay: 'Maquininha InfinitePay: cobrança, importação e conciliação de vendas',
  // recursos que existiam dentro de outros módulos e agora podem entrar ou sair dos planos separadamente
  reservas: 'Reservas de mesas',
  conta_cliente: 'Conta do cliente (crédito antecipado e acerto de fiado)',
  avaliacoes: 'Avaliações dos clientes',
  notas_entrada: 'Leitura de notas fiscais de compra (NF-e)',
  importacao_planilhas: 'Importação e exportação por planilha (cardápio e clientes)',
  painel_tv: 'Painel da TV (pedidos prontos)',
};
// "financeiro" e "fiscal" saíram do catálogo: o caixa faz parte do PDV e não há emissão fiscal no RUSTEN ainda
// (vender um módulo que não liga nada confundiria o plano).

/**
 * Rotas que pertencem a um módulo diferente do módulo do prefixo (vale a regra mais específica).
 * Ex.: /api/menu é "Cardápio", mas /api/menu/import é "Importação por planilha".
 */
export const MODULE_ROUTES = {
  importacao_planilhas: ['POST /menu/import', '/menu/export', 'POST /customers/import', '/customers/export'],
  infinitepay: ['/menu/import/infinitepay'],
  avaliacoes: ['/marketing/reviews', '/marketing/review-link'],
  notas_entrada: ['/stock/notes'],
  painel_tv: ['/brand/tv'],
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
