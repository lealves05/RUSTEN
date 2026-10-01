// Vídeo-aulas narradas do RUSTEN (arquivos em /public/treinamento/<file>.mp4, -capa.jpg e .jpg).
// `routes`: telas em que a aula é sugerida como ajuda.
export const MODULES = [
  { key: 'inicio', label: 'Primeiros passos' },
  { key: 'pdv', label: 'PDV e comandas' },
  { key: 'leitor', label: 'Leitor de código' },
  { key: 'salao', label: 'Salão' },
  { key: 'caixa', label: 'Caixa' },
  { key: 'cadastros', label: 'Cardápio' },
  { key: 'config', label: 'Configurações' },
  { key: 'clientes', label: 'Clientes e fidelidade' },
  { key: 'cozinha', label: 'Cozinha' },
  { key: 'estoque', label: 'Estoque' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'relatorios', label: 'Relatórios' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'agente', label: 'Agente WhatsApp' },
];

export const LESSONS = [
  { n: 1, file: '01-conhecendo-o-rusten', mod: 'inicio', s: 44, title: 'Conhecendo o RUSTEN', routes: ['/'],
    desc: 'A tela inicial, o menu e os atalhos do dia a dia.', learn: ['O que mostram os indicadores do Início', 'Onde fica cada área do menu', 'Busca rápida e situação do caixa'] },
  { n: 2, file: '02-terminal-e-abrir-caixa', mod: 'caixa', s: 33, title: 'Identificar o terminal e abrir o caixa', routes: ['/financeiro/caixa'],
    desc: 'O primeiro passo do dia em cada computador do balcão.', learn: ['Por que identificar o terminal', 'Informar o troco inicial', 'O que muda com o caixa aberto'] },
  { n: 3, file: '03-abrir-comanda-e-lancar', mod: 'pdv', s: 46, title: 'Abrir comanda e lançar itens', routes: ['/pdv'],
    desc: 'O jeito mais simples de usar o PDV: tocando nos produtos.', learn: ['Abrir uma comanda ou mesa', 'Lançar itens com quantidade', 'Conferir o último lançamento'] },
  { n: 4, file: '04-opcoes-e-observacoes', mod: 'pdv', s: 40, title: 'Produtos com opções e observações', routes: ['/pdv'],
    desc: 'Ponto da carne, adicionais e recados para a cozinha.', learn: ['Opções obrigatórias e adicionais', 'Observação que vai para o preparo', 'Destino fixo enquanto escolhe'] },
  { n: 5, file: '05-leitura-continua', mod: 'leitor', s: 37, title: 'Leitor de código: leitura contínua', routes: ['/pdv'],
    desc: 'Leia a comanda uma vez e depois só os produtos.', learn: ['Ativar a leitura contínua', 'Ler a comanda e os produtos', 'Trocar de comanda com segurança'] },
  { n: 6, file: '06-dupla-leitura', mod: 'leitor', s: 44, title: 'Dupla leitura: comanda e produto', routes: ['/pdv'],
    desc: 'Cada item exige ler a comanda e depois o produto.', learn: ['Como funciona o par comanda e produto', 'O tempo para ler o produto', 'O que acontece se ler fora de ordem'] },
  { n: 7, file: '07-mesas-e-salao', mod: 'salao', s: 36, title: 'Mesas e salão', routes: ['/salao'],
    desc: 'O mapa das mesas, a situação de cada uma e como abrir uma mesa.', learn: ['Ler o mapa do salão', 'Abrir uma mesa no PDV', 'Marcar reservada ou em limpeza'] },
  { n: 8, file: '08-receber-e-encerrar', mod: 'pdv', s: 39, title: 'Receber, dar troco e encerrar', routes: ['/pdv'],
    desc: 'Pagamento em dinheiro, Pix e cartão, inclusive dividido.', learn: ['Receber em dinheiro com troco', 'Pagamento misto', 'Encerrar o consumo com saldo zero'] },
  { n: 9, file: '09-cancelar-e-transferir', mod: 'pdv', s: 34, title: 'Cancelar e transferir itens', routes: ['/pdv'],
    desc: 'Corrigir lançamentos com motivo, sem perder o histórico.', learn: ['Cancelar um item com motivo', 'Transferir itens entre comandas', 'Tudo fica registrado na auditoria'] },
  { n: 10, file: '10-sangria-e-fechamento', mod: 'caixa', s: 47, title: 'Sangria e fechamento do caixa', routes: ['/financeiro/caixa'],
    desc: 'Retiradas durante o dia e a conferência cega no final.', learn: ['Registrar sangria com motivo', 'Contar cédulas e moedas', 'Justificar diferenças'] },
  { n: 11, file: '11-cardapio-e-codigos', mod: 'cadastros', s: 43, title: 'Cardápio: produtos e códigos de barras', routes: ['/cardapio'],
    desc: 'Cadastrar um produto com preço, setor e código de leitura.', learn: ['Cadastrar produto e preço', 'Setor de produção', 'Códigos de barras para o leitor'] },
  { n: 12, file: '12-configurar-pdv-e-equipe', mod: 'config', s: 38, title: 'Configurar o PDV e a equipe', routes: ['/configuracoes'],
    desc: 'Modo do leitor, regras de segurança, usuários e perfis.', learn: ['Modo padrão e dupla leitura obrigatória', 'Taxa de serviço', 'Usuários e perfis de acesso'] },
  { n: 13, file: '13-comanda-pelo-cpf', mod: 'clientes', s: 62, title: 'Abrir a comanda pelo CPF', routes: [],
    desc: 'O nome do cliente é preenchido sozinho a partir do CPF.', learn: ['Buscar o cliente pelo CPF', 'Cadastro rápido quando não existe', 'Identificar o cliente depois'] },
  { n: 14, file: '14-cozinha-kds', mod: 'cozinha', s: 54, title: 'Cozinha: a fila de produção', routes: ['/cozinha'],
    desc: 'Aceitar, preparar e entregar, com alerta de atraso e de cancelamento.', learn: ['Filas por setor', 'Avançar as etapas do item', 'Atrasos e cancelamentos'] },
  { n: 15, file: '15-estoque-e-fichas', mod: 'estoque', s: 65, title: 'Estoque e fichas técnicas', routes: ['/estoque'],
    desc: 'Insumos, ficha técnica com custo e margem, compras e inventário.', learn: ['Cadastrar insumos com saldo e custo', 'Montar a ficha técnica', 'Baixa automática nas vendas'] },
  { n: 16, file: '16-delivery-e-cardapio-digital', mod: 'delivery', s: 53, title: 'Delivery e cardápio digital', routes: ['/delivery'],
    desc: 'O cliente pede pelo link; você confirma, prepara, entrega e recebe.', learn: ['Ligar o cardápio digital', 'Como o cliente faz o pedido', 'Confirmar, entregar e receber'] },
  { n: 17, file: '17-clientes-e-fidelidade', mod: 'clientes', s: 54, title: 'Clientes e fidelidade', routes: ['/clientes'],
    desc: 'Cadastro, histórico de consumo, pontos e consentimentos.', learn: ['Regras do programa de pontos', 'Histórico e extrato do cliente', 'Consentimento para mensagens'] },
  { n: 18, file: '18-relatorios', mod: 'relatorios', s: 47, title: 'Relatórios', routes: ['/relatorios'],
    desc: 'Faturamento, produtos, equipe, controle e financeiro.', learn: ['Escolher o período', 'Curva ABC, CMV e margem', 'Exportar e imprimir'] },
  { n: 19, file: '19-marketing-e-avaliacoes', mod: 'marketing', s: 46, title: 'Marketing e avaliações', routes: ['/marketing'],
    desc: 'Satisfação dos clientes e campanhas só para quem consentiu.', learn: ['Avaliação pós-consumo por QR', 'Retorno às notas baixas', 'Campanhas segmentadas'] },
  { n: 20, file: '20-agente-whatsapp', mod: 'agente', s: 59, title: 'Agente de atendimento no WhatsApp', routes: ['/agente'],
    desc: 'Cardápio, preços, pedidos e reservas no WhatsApp, com passagem para a equipe.', learn: ['Testar no simulador', 'Pedido com resumo e confirmação', 'Caixa de entrada e integração oficial'] },
  { n: 21, file: '21-lancar-nota-no-estoque', mod: 'estoque', s: 61, title: 'Lançar a nota no estoque (foto, XML ou manual)', routes: [],
    desc: 'Foto da nota ou XML da NF-e: o sistema lê, você confere e tudo entra no estoque.', learn: ['Fotografar ou importar o XML', 'Conferir e converter embalagens', 'O sistema aprende cada fornecedor'] },
  { n: 22, file: '22-painel-da-tv', mod: 'cozinha', s: 102, title: 'Painel da TV: chamada dos pedidos', routes: ['/painel-tv'],
    desc: 'A fila em preparo e a chamada com fogos de artifício, som e voz quando o pedido fica pronto.', learn: ['Abrir o painel numa TV', 'Tudo pronto e Chamar na TV', 'Fogos, fundo, som e tipo de letra'] },
  { n: 23, file: '23-correcao-de-estoque', mod: 'estoque', s: 73, title: 'Correção de estoque com auditoria', routes: ['/estoque'],
    desc: 'Corrigir o saldo de um item com motivo, justificativa, limites e aprovação por outra pessoa.', learn: ['Informar o saldo real', 'Aplicação direta ou aprovação', 'Histórico e CSV para auditoria'] },
  { n: 24, file: '24-fiado-e-credito', mod: 'clientes', s: 69, title: 'Fiado e crédito do cliente', routes: ['/clientes', '/salao'],
    desc: 'Pendurar no fiado pelo CPF, receber o fiado, lançar crédito antecipado e ver tudo na comanda.', learn: ['Fiado com limite pelo CPF', 'Aviso de fiado ao receber', 'Crédito antecipado e extrato'] },
];

export const videoUrl = (l) => `/treinamento/${l.file}.mp4`;
export const posterUrl = (l) => `/treinamento/${l.file}-capa.jpg`;
export const thumbUrl = (l) => `/treinamento/${l.file}.jpg`;
export const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** Aula sugerida para a tela atual (a de rota mais específica). */
export const lessonFor = (pathname) => LESSONS.filter((l) => l.routes.some((r) => (r === '/' ? pathname === '/' : pathname.startsWith(r))))
  .sort((a, b) => Math.max(...b.routes.map((r) => r.length)) - Math.max(...a.routes.map((r) => r.length)))[0] || null;
