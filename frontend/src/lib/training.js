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
];

export const videoUrl = (l) => `/treinamento/${l.file}.mp4`;
export const posterUrl = (l) => `/treinamento/${l.file}-capa.jpg`;
export const thumbUrl = (l) => `/treinamento/${l.file}.jpg`;
export const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** Aula sugerida para a tela atual (a de rota mais específica). */
export const lessonFor = (pathname) => LESSONS.filter((l) => l.routes.some((r) => (r === '/' ? pathname === '/' : pathname.startsWith(r))))
  .sort((a, b) => Math.max(...b.routes.map((r) => r.length)) - Math.max(...a.routes.map((r) => r.length)))[0] || null;
