# RUSTEN — Prompt completo de implementação

> Plataforma SaaS de gestão e PDV para bares, restaurantes, lanchonetes, cafeterias, pubs e estabelecimentos de alimentação.
> Referência funcional: manual ORBI fornecido, versão de 30/09/2026. Este documento especifica o produto desejado; não comprova funcionalidades implementadas ou código auditado.
> Usar este Markdown como instrução integral para desenvolvimento em uma ferramenta de programação assistida por IA.

## 1. Objetivo e instruções iniciais

Desenvolva o **RUSTEN**, uma plataforma completa para alimentação, preservando as funcionalidades comuns do ORBI e adaptando os fluxos específicos do segmento. O diferencial central será o PDV com motor de leitura de códigos, incluindo dupla leitura **COMANDA → PRODUTO**, que poderá ser habilitada ou desabilitada, e lançamento manual por busca, código digitado ou catálogo visual.

A área **MASTER** deve manter a organização, os recursos e as regras funcionais descritas no manual do ORBI, incluindo administração de empresas, sistemas, assinaturas, pagamentos, planos, testes, permissões, módulos, bloqueios, liberações, suporte e auditoria.

Antes de alterar qualquer arquivo:

1. Analise o repositório disponível, arquitetura, banco, autenticação, permissões, integrações, testes e documentação.
2. Identifique o que existe, o que precisa ser adaptado e o que precisa ser criado. Não considere o manual evidência de implementação.
3. Preserve dados, rotas funcionais e contratos de integração reutilizáveis.
4. Se estiver em um repositório compartilhado, crie RUSTEN como produto separado sem renomear ou modificar o ORBI e o TORVEN inadvertidamente.
5. Se não houver código-base, implemente a partir desta especificação, documentando as decisões técnicas.
6. Não elimine tabelas ou históricos de agenda e serviços existentes. Remova essas funções da experiência RUSTEN e faça migrações explícitas quando necessárias.
7. Use migrações versionadas, backup e plano de reversão. Não copie credenciais de exemplos ou de conversas para o código.
8. Entregue fluxos persistentes e funcionais, incluindo estados vazios, carregamento, erros e permissões. Não apresente botões simulados como integrações operacionais.

## 2. Identidade e experiência visual

- Nome do sistema: **RUSTEN**.
- Descrição: **Gestão para bares e restaurantes**.
- Identidade: old school, motocicletas custom, rock clássico, oficina e balcão de bar.
- Paleta sugerida: grafite `#202020`, preto `#121212`, creme `#F3E9D2`, cobre `#B87333` e vermelho queimado `#9B3434`.
- Use referências retrô em títulos, ilustrações e marca; mantenha tabelas e formulários limpos e legíveis.
- Tipografia de personalidade nos títulos e fonte de alta legibilidade nos dados.
- Temas claro, escuro e automático; densidade confortável ou compacta.
- Interface responsiva para desktop, tablet e celular, com PDV adequado a touchscreen, teclado e leitor.
- Botões de operação grandes, foco visível e status indicados por texto e ícone, sem depender apenas de cores ou sons.
- Permitir menu superior ou lateral, busca global, notificações e personalização de aparência por empresa.
- Formatação inicial: português do Brasil, moeda BRL, datas brasileiras e fuso configurável, inicialmente `America/Sao_Paulo`.
- Permitir jornada comercial que atravesse a meia-noite sem atribuir incorretamente vendas a outro turno.

## 3. Aproveitamento da base ORBI

| Recurso de origem | Tratamento no RUSTEN |
|---|---|
| Clientes, usuários e fornecedores | Preservar e adaptar os campos |
| Profissionais | Funcionários, garçons, operadores e entregadores |
| Serviços e categorias | Produtos de venda, cardápio e categorias |
| Agenda de profissionais | Retirar da navegação RUSTEN |
| Agendamento online | Substituir por cardápio, pedidos e reservas |
| Lista de espera | Fila de espera de mesas |
| Comandas e caixa | Expandir para PDV, mesas, consumo e recebimento |
| Produtos e estoque | Expandir com insumos, fichas técnicas, lotes e produção |
| Pacotes de sessões | Substituir por combos e promoções |
| Clube de assinatura de clientes | Opcional, separado da assinatura SaaS e desligado por padrão |
| Comissões | Adaptar para vendas, funcionários e distribuição configurável de taxa de serviço |
| Financeiro, DRE, créditos e devedores | Preservar |
| Fidelidade e vale-presente | Preservar como módulos opcionais |
| Marketing e avaliações | Preservar com gatilhos de alimentação |
| Agente WhatsApp | Adaptar para cardápio, pedidos, reservas e atendimento |
| Multiunidade, perfis, auditoria e segurança | Preservar e ampliar |
| MASTER e cobrança SaaS | Manter equivalência funcional com o ORBI |
| Fiscal sem emissão operacional | Evoluir com integração real e status explícito |

## 4. Menus e módulos

Menu da empresa:

**INÍCIO · PDV · SALÃO · COZINHA · DELIVERY · CARDÁPIO · ESTOQUE · CLIENTES · FINANCEIRO · RELATÓRIOS · MARKETING · AGENTE · CONFIGURAÇÕES · SUPORTE**

Itens opcionais devem desaparecer quando desabilitados, com bloqueio equivalente no servidor. Histórico existente continua acessível a perfis autorizados, mesmo após desativação de um módulo.

No topo: busca global, seletor de unidade, caixa/turno, operador, indicador de conexão, notificações e menu da conta. Exibir **Administração** apenas para identidades MASTER autorizadas.

Painel inicial: vendas, recebido, comandas abertas, mesas ocupadas, pedidos em preparo, entregas, estoque crítico, contas vencendo, divergências de caixa e situação da assinatura. Não confundir consumo lançado com dinheiro recebido.

## 5. Cadastro e configuração inicial

Fluxo `/cadastro`:

1. Empresa: segmento, nome, CPF/CNPJ, contato e endereço.
2. Responsável: nome, e-mail, senha e aceite dos termos aplicáveis.
3. Plano: mensal, anual ou teste permitido pelo MASTER.
4. Configuração inicial: unidade, horários, mesas, comandas, cardápio, formas de pagamento e modo de PDV.
5. Dados demonstrativos opcionais, identificados como demonstração e removíveis sem afetar transações reais.

Segmentos: bar, restaurante, lanchonete, cafeteria, pub, food truck, hamburgueria, pizzaria, padaria e outros. Adaptar sugestões e vocabulário sem criar versões incompatíveis do produto.

Configurações: dados da empresa, aparência, funcionamento, unidades, terminais, setores de produção, impressoras, módulos, motivos, usuários, perfis, financeiro, fiscal, assinatura e integrações.

Reservas devem usar capacidade, duração e disponibilidade de mesas. Não reutilizar inadvertidamente regras de agenda de profissionais.

## 6. PDV — requisitos gerais

Permitir:

- Venda rápida de balcão sem comanda física.
- Venda vinculada a mesa, comanda, cliente ou pedido de retirada.
- Seleção de produtos por busca, categoria, favoritos, código digitado ou leitor.
- Exibição permanente da comanda/mesa ativa, itens, quantidades, adicionais e total.
- Quantidade, unidade, preço e desconto conforme permissões.
- Observações e modificadores obrigatórios/opcionais.
- Múltiplas formas de pagamento, pagamento parcial, troco e saldo pendente.
- Suspender e retomar venda, consultar consumo e imprimir pré-conta identificada como não fiscal.
- Operação com atalhos documentados e sem conflitos com campos de texto.
- Confirmação do último lançamento com produto, quantidade, preço e destino.

Lançar um item registra consumo; não significa receber pagamento, fechar a comanda ou emitir documento fiscal. Os fluxos devem ser separados e rastreáveis.

## 7. Motor de leitura e lançamento manual

### 7.1 Configuração por empresa, unidade e terminal

Criar **Configurações → PDV → Leitura e lançamento**:

| Configuração | Comportamento |
|---|---|
| Habilitar leitor | Ativa o processamento de leituras no PDV |
| Modo de operação | Manual, leitura contínua ou dupla leitura obrigatória |
| Permitir lançamento manual | Libera pesquisa, catálogo e digitação de código |
| Permitir exceção manual na dupla leitura | Somente para usuário autorizado; pode exigir gerente |
| Permitir operador trocar modo | Controlado por permissão |
| Tempo de espera do produto | Configurável; sugestão inicial de 15 segundos |
| Abrir comanda livre na leitura | Desligado por padrão; exige permissão quando ativado |
| Feedback sonoro/visual | Configurável; mensagem visual sempre disponível |
| Quantidade por leitura | Padrão 1; alterações explícitas e limitadas |
| Confirmar produto com opções | Obrigatório quando houver escolha pendente |

Precedência: terminal → unidade → empresa, respeitando políticas de segurança e módulos autorizados. Uma configuração mais específica não pode conceder permissão negada por política superior.

Ao desligar o leitor ou a dupla leitura, o sistema deve continuar operando manualmente. Impedir configuração que elimine todos os meios de lançamento.

### 7.2 Modo manual

1. Abrir ou selecionar comanda/mesa; alternativamente iniciar venda de balcão.
2. Buscar produto pelo nome, SKU ou código digitado, ou escolher no catálogo.
3. Informar quantidade e opções.
4. Adicionar ao pedido.
5. Continuar lançando ou receber o pagamento.

Mostrar **Modo manual — leitor não obrigatório**. Digitar um código não deve exigir hardware de leitura. Regras de preço, estoque, permissões e produção são iguais em todos os modos.

### 7.3 Modo leitura contínua

1. Selecionar ou ler a comanda uma vez.
2. Ler sucessivamente os produtos.
3. Cada leitura válida adiciona o produto à comanda ativa.
4. Para trocar a comanda, usar ação explícita ou código reconhecido de outra comanda, exibindo imediatamente o novo destino.

Não interpretar uma leitura desconhecida como abertura de comanda ou cadastro automático de produto.

### 7.4 Modo dupla leitura obrigatória

Cada item exige o ciclo **COMANDA → PRODUTO → COMANDA → PRODUTO**.

Exemplo:

```text
Tela: AGUARDANDO COMANDA
Leitura: CMD-000042
Tela: COMANDA 042 — AGUARDANDO PRODUTO
Leitura: código da Cerveja IPA 600 ml
Resultado: 1 unidade adicionada à COMANDA 042
Tela: AGUARDANDO COMANDA
```

Requisitos:

- Cada novo lançamento deve consumir um novo par de leituras.
- Após sucesso, limpar a seleção temporária, quantidade excepcional e modificadores.
- Produto lido antes da comanda: não lançar e mostrar orientação.
- Comanda inválida, bloqueada ou encerrada: não aceitar produto.
- Segunda comanda lida enquanto se espera produto: cancelar o par pendente e voltar ao início com aviso; não trocar silenciosamente o destino.
- Timeout: descartar o par incompleto sem gerar consumo.
- `Esc` cancela o par incompleto; nunca cancela silenciosamente venda persistida.
- Durante envio, não aceitar novo par até confirmar resultado ou recuperar a operação pendente.
- Em falha de resposta, consultar/repetir a mesma operação com a mesma chave idempotente.
- Para produto com opções obrigatórias, manter o destino fixo, solicitar opções e só então confirmar.
- Produto pesado exige peso válido informado ou capturado de integração homologada; não assumir quantidade 1.

Estados mínimos:

| Estado | Evento | Resultado |
|---|---|---|
| Aguardando comanda | Comanda válida | Aguardando produto |
| Aguardando comanda | Produto/identificador inválido | Aviso; nenhuma inclusão |
| Aguardando produto | Produto válido simples | Validar e enviar lançamento |
| Aguardando produto | Produto com opções | Aguardar opções mantendo a comanda |
| Aguardando produto | Outra comanda, timeout ou cancelamento | Limpar par e voltar ao início |
| Enviando | Sucesso | Confirmar visualmente e voltar ao início |
| Enviando | Resposta incerta | Recuperar pelo identificador sem duplicar |

### 7.5 Desabilitação e exceção manual

Disponibilizar no PDV o seletor **Manual / Leitura contínua / Dupla leitura**, visível conforme permissões, e o comando **Lançamento manual**.

- Usuário com `pdv.alterar_modo` pode desativar a dupla leitura e operar manualmente.
- Usuário com `pdv.lancamento_manual` pode lançar manualmente nos modos permitidos.
- Quando dupla leitura for política obrigatória, exigir `pdv.excecao_dupla_leitura` e, se configurado, autorização individual do gerente.
- A exceção autoriza apenas o lançamento solicitado e depois retorna à dupla leitura.
- A troca de modo limpa o par incompleto e não altera itens já lançados.
- Se houver operação em envio, resolver sua confirmação antes de trocar o modo.
- Registrar modo anterior/novo, operador, terminal, motivo e autorizador quando aplicável.

### 7.6 Roteador de códigos

Criar serviço único para classificar `COMANDA`, `PRODUTO`, `MESA`, `CLIENTE`, `FUNCIONARIO`, `PEDIDO` ou `DESCONHECIDO`. Reconhecer uma entidade não concede automaticamente autorização para agir sobre ela.

- Consultar identificadores dentro do escopo autenticado da empresa/unidade.
- Suportar produtos com vários códigos e comandas em Code 128/QR Code.
- Preservar zeros à esquerda e tratar códigos como texto.
- Priorizar prefixos próprios para comandas, sem depender exclusivamente do formato.
- Impedir cadastros ambíguos; em conflitos legados, bloquear o lançamento automático.
- Leitor USB/Bluetooth em modo teclado com terminador configurável; câmeras e equipamentos adicionais somente mediante suporte explícito.
- Capturar leituras apenas no contexto apropriado, sem interceptar senhas ou campos de observações.
- Identificar repetição de transmissão por operação, não eliminar duas vendas legítimas do mesmo produto pelo simples fato de seus códigos coincidirem.
- Dados de cartão de consumo são identificadores, nunca credenciais de administrador.

## 8. Comandas físicas e sessões de consumo

Separar **cartão físico reutilizável** da **sessão de consumo**. O cartão 042 pode ser usado por clientes diferentes ao longo do tempo, sem misturar históricos.

Cartão: identificador interno, número visível, código, QR Code, unidade, ativo/bloqueado e motivo de bloqueio.

Sessão: empresa, unidade, cartão opcional, cliente opcional, mesa, responsável, abertura, fechamento, itens, pagamentos e situação.

- No máximo uma sessão ativa por cartão no escopo definido.
- Estados de consumo: aberta, em fechamento, encerrada ou cancelada.
- Pagamento parcial é situação financeira distinta, não encerramento automático.
- Cartão perdido pode ser bloqueado e substituído mantendo a mesma sessão e auditoria.
- Reabertura exige permissão e análise dos efeitos financeiros/fiscais; não sobrescrever documentos emitidos.
- Gerar e imprimir cartões em lote, etiquetas e relação de códigos.
- Abrir, consultar, transferir, juntar e dividir consumos com rastreabilidade dos itens originais.

## 9. Mesas, reservas e salão

- Mapa de mesas por ambiente, capacidade, numeração e posição.
- Ocupação: livre, ocupada, reservada, conta solicitada e limpeza.
- Pedidos em preparo/prontos como indicadores separados, pois uma mesa pode ter pedidos em vários estados simultaneamente.
- Várias comandas por mesa, inclusive consumo individual.
- Transferência de mesa, garçom, comanda e item com permissão e auditoria.
- Divisão por itens, pessoas, valores ou partes iguais; ratear centavos de forma determinística.
- Reservas com horário, capacidade, duração, tolerância, contato e status.
- Fila de espera com estimativa identificada como estimativa e chamada registrada.
- Não transferir livremente entre unidades transações já pagas ou fiscalizadas.

## 10. Cardápio, produtos e precificação

Cadastro: nome, descrição, categoria, imagem, SKU, códigos, preço, custo, unidade, ativo, canais disponíveis, disponibilidade por horário/unidade, setor de produção e dados fiscais quando aplicáveis.

Tipos: revenda, preparado por receita, produção própria estocada, combo, adicional e produto por peso.

- Modificadores com grupos obrigatórios/opcionais, mínimos, máximos, valores e impacto na receita.
- Tamanhos, sabores, ponto da carne, ingredientes retirados e adicionais.
- Combos devem descontar componentes corretamente sem baixa duplicada.
- Pizza e produtos fracionados com regra explícita de preço: maior preço, média ou composição definida.
- Happy hour, promoções por dia/horário, cupons e regras de cumulatividade.
- Preço por canal e unidade, com histórico e vigência.
- Guardar no item vendido o preço, descrição, opções e receita vigentes no momento da venda.
- Informações de ingredientes/alergênicos fornecidas pelo estabelecimento, sem gerar garantias automáticas de ausência de contaminação cruzada.

## 11. Cozinha, bar e KDS

Fluxo: **NOVO → ACEITO → PREPARANDO → PRONTO → ENTREGUE**, com cancelamentos tratados à parte.

- Filas por cozinha, bar, copa e sobremesas.
- Exibir comanda, mesa, origem, horário, tempo decorrido, quantidade, opções e observações.
- Identificar novos itens acrescentados a um pedido em andamento.
- Suportar envio imediato ou por lote confirmado, configurável e claramente indicado no PDV.
- Alertas de atraso, prioridade autorizada e impressão setorial opcional.
- Cancelamento após envio deve notificar o setor; nunca desaparecer silenciosamente da fila.
- Usar eventos transacionais com outbox, confirmação e consumidores idempotentes.
- Reconexão recupera pedidos perdidos sem produzir novamente um item já reconhecido.
- Impressões possuem fila, status, retentativa e marca de reimpressão. Não presumir impressão silenciosa universal pelo navegador.

## 12. Delivery, retirada e cardápio digital

- Página pública da empresa com identidade, horários e cardápio disponível.
- Carrinho, modificadores, observações, endereço, taxa e área de entrega, pedido mínimo e prazo estimado.
- Modos entrega e retirada, com pagamento online apenas quando integração estiver operacional.
- Pedido recebido, confirmado, em preparo, pronto, saiu para entrega, entregue ou cancelado.
- Entregador, rota/endereço e comprovante de entrega com acesso restrito.
- Integrações de marketplaces por adaptadores, sem presumir disponibilidade de API ou credenciais.
- Prevenir pedidos duplicados e abuso de pedidos públicos; preço e disponibilidade sempre validados no servidor.
- QR de mesa público não deve autorizar fechamento, transferência de consumo ou acesso a dados de outros clientes.

## 13. Estoque, compras e fichas técnicas

- Separar produtos vendidos e insumos consumidos.
- Unidades `un`, `kg`, `g`, `L`, `ml` e conversões compatíveis.
- Fichas técnicas versionadas com rendimento, quantidades, perdas previstas e custo calculado.
- Exemplo: vender um hambúrguer consome os ingredientes da receita vigente, incluindo adicionais.
- Definir estratégia por produto: consumir ingredientes na venda/preparo ou consumir produto acabado previamente produzido. Nunca as duas simultaneamente.
- Reservar no pedido confirmado; efetivar consumo conforme política operacional definida e impedir baixa dupla.
- Cancelamento antes do preparo pode liberar reserva; após preparo, registrar perda/consumo quando não houver retorno físico ao estoque.
- Compras com fornecedor, documento, custos, recebimento parcial e parcelas em contas a pagar.
- Depósitos, unidades, lotes, validade, estoque mínimo, ponto de reposição e transferências.
- Produção própria com consumo de insumos e entrada do produto produzido.
- Inventário com contagem, divergências, aprovação e trilha de ajuste.
- Movimentos imutáveis com reversões vinculadas ao original.
- Política explícita para estoque negativo e indisponibilidade de produtos.
- CMV teórico, CMV real, custo médio, perdas, curva ABC e sugestão de compra.

## 14. Caixa, recebimento e financeiro

Preservar os recursos comuns do ORBI:

- Abertura por operador/terminal/turno, troco inicial e exigência configurável de caixa aberto.
- Sangria, suprimento, despesa de caixa, fechamento cego e justificativa de diferença.
- Contador de cédulas/moedas, conferência por forma de pagamento e relatório.
- Reabertura e datas retroativas com limite configurável, permissão, motivo e data real de registro preservada.
- Dinheiro, Pix, débito, crédito, vales e outras formas habilitadas.
- Taxas, prazo de recebimento, conta de destino, parcelamento e conciliação.
- Contas a pagar/receber, fluxo previsto/realizado, centros de custo, categorias e DRE gerencial.
- Crédito de cliente, vale-presente, fiado autorizado e cobrança de devedores.
- Estornos parciais/totais vinculados ao recebimento original.
- Comissões e taxa de serviço em contas separadas, com critérios configuráveis e histórico.

Regras críticas:

- Cálculos monetários em centavos inteiros ou decimal exato; nunca ponto flutuante binário para totalizações.
- Consumo lançado, pagamento confirmado, recebível e liquidação bancária são eventos diferentes.
- Pagamento eletrônico não pode ser confirmado apenas pelo retorno visual do checkout ou comprovante enviado pelo cliente.
- Pagamento misto deve controlar saldo remanescente e falha de apenas uma parcela.
- Cobrança/estorno com resultado incerto deve ser consultado antes de nova tentativa.
- Troco apenas em meios elegíveis; impedir troco indevido sobre cartão/Pix.
- Taxa de serviço deve aparecer discriminada e admitir ajuste/remoção conforme política aplicável, sem ser disfarçada no preço.

## 15. Fiscal e periféricos

Criar camada fiscal desacoplada do provedor, incluindo documentos adequados à operação e UF, como NFC-e e NF-e quando aplicáveis.

- Cadastro tributário, ambiente de homologação/produção, certificados e segredos protegidos.
- Emissão, consulta, rejeição, cancelamento, XML e representação impressa.
- Estados separados: não solicitado, pendente, autorizado, rejeitado, cancelado e contingência quando admitida.
- Validar regras vigentes com documentação oficial e responsável contábil antes de configurar produção. Não ativar SAT/MFE ou qualquer regime legado por suposição.
- Contingência fiscal depende de regra fiscal e integração próprias; fila offline do PDV não equivale a autorização fiscal.
- Documento rejeitado não recebe aparência de documento autorizado.
- Integrar impressora, gaveta, balança e pagamento presencial por interfaces suportadas e documentadas. Quando necessário, usar agente local autenticado.

## 16. Clientes, fidelidade e relacionamento

- Cadastro, contatos, aniversário, endereços, preferências, etiquetas e consentimentos por canal.
- Histórico de consumo, visitas, ticket médio, créditos, débitos, pontos e avaliações.
- Importação CSV/Excel com prévia, validação, deduplicação e proteção contra fórmulas em exportações.
- Fidelidade com extrato, validade, resgate e reversão em cancelamento.
- Avaliação pós-consumo, painel de satisfação e ações de retorno.
- Campanhas com segmentação, modelos, descadastro e registro de consentimento.
- Clube de clientes opcional; não confundir com a assinatura da empresa no RUSTEN.
- Exportação e anonimização com verificação de permissões e obrigações de retenção; preservar registros que devam ser mantidos.

## 17. Agente de atendimento por WhatsApp

Adaptar o fluxo ORBI para:

- Consultar cardápio, preços, disponibilidade e funcionamento.
- Montar pedido, validar opções, apresentar resumo e solicitar confirmação antes de enviá-lo.
- Consultar status de pedido com verificação apropriada da identidade.
- Criar, remarcar e cancelar reservas de mesas dentro das regras.
- Encaminhar reclamações, descontos, cobranças e exceções à equipe.
- Caixa de entrada com assumir conversa, pausar agente, responder e devolver ao agente.
- Simulador isolado das vendas reais e configuração de identidade, gatilhos e mensagens.
- Integração oficial, credenciais protegidas, assinatura de webhooks e histórico de falhas.

O agente só pode executar ações por ferramentas autorizadas e validadas no backend. Texto de cliente não pode mudar preços, permissões, políticas de cobrança ou configurações do sistema.

## 18. Perfis e permissões operacionais

Perfis iniciais: **Proprietário, Administrador, Gerente, Caixa, Garçom, Cozinha, Bar, Estoque, Financeiro, Entregador e Consulta**.

Matriz por módulo/ação: visualizar, criar, editar, exportar, cancelar, estornar, autorizar, dados financeiros, dados pessoais e escopo de unidade/próprios registros.

Permissões específicas:

```text
pdv.lancar
pdv.lancamento_manual
pdv.alterar_modo
pdv.excecao_dupla_leitura
pdv.alterar_quantidade
pdv.alterar_preco
pdv.desconto
pdv.cancelar_item
pdv.cancelar_venda
pdv.transferir_item
pdv.reabrir_comanda
caixa.abrir
caixa.fechar
caixa.sangria
caixa.suprimento
caixa.reabrir
financeiro.visualizar
financeiro.estornar
estoque.ajustar
relatorios.cmv
configuracoes.gerenciar
assinatura.gerenciar
```

Autorizações gerenciais devem identificar a pessoa e a operação aprovada. Evitar PIN compartilhado; aplicar limitação de tentativas e validade curta. Nenhum perfil da empresa pode conceder poder MASTER ou permissões acima do próprio escopo.

## 19. Área MASTER — equivalência funcional com ORBI

### 19.1 Acesso e identidade

- Rota `/master` e entrada **Administração** para usuário MASTER autorizado.
- Credenciais iniciais por `MASTER_INITIAL_USERNAME`, `MASTER_INITIAL_PASSWORD` e `MASTER_EMAIL`, provisionadas de forma segura, sem senha padrão publicada.
- Troca obrigatória da senha inicial e possibilidade de alterar login, e-mail e senha.
- Autenticação em duas etapas, códigos de recuperação e gestão de sessões.
- Recuperação MASTER por link de uso único com validade de 30 minutos.
- Recuperação de usuário de empresa com validade de 60 minutos, uso único e revogação de sessões após troca.
- Reautenticação em mudanças sensíveis; respostas de recuperação sem revelar existência de contas.
- Verificação de papel e escopo no servidor em toda operação MASTER.

### 19.2 Menu obrigatório

| Tela | Recursos |
|---|---|
| Dashboard | Empresas por situação, MRR, vencimentos, pagamentos recentes e cartões por sistema |
| Empresas | Filtros por sistema, situação, plano, ciclo e vencendo em 15 dias; ficha completa |
| Assinaturas | Ciclo, plano, validade, carência, próximo vencimento e histórico |
| Pagamentos | Cobranças, tentativas, eventos do gateway, conciliação e estornos |
| Planos | Preços mensais/anuais, módulos, limites, vigência e ativação por sistema |
| Testes | Teste de 15 dias, 30 dias, prazo personalizado, ilimitado ou desabilitado |
| Perfis e permissões | Padrões da plataforma e perfis administrativos limitados |
| Módulos | Catálogo e habilitação por produto, plano e empresa |
| Sistemas | ORBI, TORVEN e RUSTEN; endereço, integração, teste e sincronização |
| Auditoria | Ações MASTER e integrações, com registros resistentes à alteração |
| Configurações | Contratação, cobrança, gateway, suporte, e-mail, credenciais e 2FA |

### 19.3 Dashboard MASTER

- Total de empresas e distribuição entre teste, ativa, vencida, em carência e bloqueada.
- Separar bloqueio administrativo de bloqueio por inadimplência.
- MRR com definição explícita: componente mensal recorrente contratado e anual normalizado, sem confundir com caixa recebido.
- Recebimentos, falhas, vencimentos próximos, conversão de teste, cancelamentos e inadimplência.
- Filtros por período e sistema; visão consolidada e visão exclusiva RUSTEN.
- Indicador de última atualização das integrações; falha de sincronização não significa ausência de empresas.

### 19.4 Ficha da empresa

Dados: sistema, empresa, responsável, contato, plano, ciclo, preço contratado, cadastro, início/fim do teste, período pago, carência, estado de acesso, unidades, usuários, terminais, consumo de limites e último acesso.

Ações:

- **Bloquear acesso**, com motivo obrigatório. Pagamento não remove bloqueio administrativo.
- **Liberar**, restaurando acesso, liberando até uma data ou por prazo indeterminado.
- **Iniciar, prorrogar ou encerrar teste**.
- **Alterar plano**, definindo vigência e reflexo na cobrança.
- **Alterar carência**, com valor global ou exceção por empresa.
- **Habilitar/desabilitar módulos** e ajustar limites autorizados.
- **Gerenciar perfis e permissões** dentro do escopo previsto.
- **Consultar pagamentos, faturas e eventos**.
- **Enviar link de nova senha** ao responsável.
- Corrigir e-mail principal com confirmação explícita da mudança e notificação apropriada.
- Consultar histórico completo de alterações, autoria e motivos.

Liberação manual não marca fatura como paga nem apaga a dívida. Encerrar teste não cancela período já pago. Bloqueio não exclui dados.

### 19.5 Planos e módulos

- Criar planos por sistema com nome, descrição, mensal/anual, módulos, limites e disponibilidade pública.
- Valores comerciais editáveis; não inventar preços de mercado como requisito técnico.
- Limites: unidades, usuários, terminais, armazenamento e integrações, quando utilizados no modelo comercial.
- Versionar preço contratado; editar plano não altera retroativamente cobranças anteriores.
- Mudança mensal passa a valer na próxima cobrança por padrão; qualquer mudança imediata exige cálculo e confirmação explícitos.
- Redução de plano não apaga dados excedentes. Explicar limitações para novas operações.
- Permissão efetiva depende de plano, exceção autorizada, ativação do módulo e perfil do usuário.
- Histórico de exceções por empresa com prazo opcional e motivo.

### 19.6 Testes, prazos e cobrança

- Teste padrão global: 15 dias, 30 dias, ilimitado ou sem teste.
- Possibilidade de prazo personalizado por empresa.
- Carência inicial após vencimento: **15 dias**, alterável pelo MASTER.
- Avisos configuráveis antes e depois do vencimento, com deduplicação e histórico de entrega.
- Configurar contratação mensal recorrente ou anual com pagamento único do período.
- Anual não se renova automaticamente sem adesão explícita a recorrência suportada.
- Controlar possibilidade de novos cadastros.
- Datas mostradas no fuso da empresa; cálculo temporal consistente no servidor.
- Não prolongar acesso indefinidamente por repetição de webhook ou atualização da página.

### 19.7 Regras de acesso

Manter separados: situação financeira da assinatura, período pago, teste, carência, bloqueio administrativo e liberação manual.

Precedência do cálculo:

1. Bloqueio administrativo ativo impede acesso operacional, mesmo com pagamento aprovado.
2. Sem bloqueio administrativo, liberação manual válida concede acesso sem quitar faturas.
3. Período pago válido concede acesso.
4. Teste válido concede acesso conforme escopo do teste.
5. Inadimplência dentro da carência concede acesso com aviso.
6. Fora desses casos, bloquear operações e apresentar regularização.

Uma ação explícita do MASTER pode remover bloqueio administrativo; nenhuma rotina de gateway pode fazê-lo implicitamente.

Tela de bloqueio: motivo, situação, vencimento e ações **Regularizar pagamento**, **Já paguei, verificar**, **Falar com suporte** e **Sair**. Permitir acesso autenticado restrito às rotas necessárias à regularização. Não expor detalhes internos de investigação ou dados de outras empresas.

Antes do fim da carência, alertar o responsável e terminais. Se o bloqueio ocorrer com comandas abertas, preservar itens e recebimentos confirmados; definir rotina restrita e auditada para conciliar transações já em trânsito, sem permitir novas vendas pelo caminho de regularização.

### 19.8 Central de sistemas

Preservar o conceito ORBI de central que reúne vários sistemas:

- Cadastro ORBI, TORVEN, RUSTEN e futuros produtos.
- Nome, identificador, endereço, ambiente, credencial de integração e status.
- Testar conexão, sincronizar e consultar falhas.
- Segredos ocultos, criptografados, rotacionáveis e nunca enviados ao frontend.
- Eventos assinados e proteção contra repetição.
- Restringir destinos de conexão para evitar acesso indevido à rede interna.
- Não assumir bancos compartilhados: usar adaptadores se os sistemas forem independentes.
- Definir autoridade de cada dado: MASTER controla planos e concessões; gateway informa eventos financeiros; produto controla operação do estabelecimento.
- Usar identificador composto por sistema e empresa ao correlacionar produtos independentes.
- Não atribuir recursos do RUSTEN a empresas ORBI/TORVEN por engano.

### 19.9 Perfis administrativos e suporte

MASTER principal com visão integral; perfis administrativos delegados com escopo por sistema e ações, como leitura, suporte, financeiro e gestão de planos.

Configurar WhatsApp, e-mail, horários, recado, teste de contato e status do envio de e-mails. Exibir esses contatos no login, suporte e tela de bloqueio.

Área de ajuda com perguntas frequentes e aulas vinculadas às telas. Não gerar links fictícios ou informar vídeos existentes sem que tenham sido entregues.

Não criar acesso silencioso às contas dos clientes. Se implementada sessão de suporte, exigir concessão adequada, prazo, aviso visível e auditoria, sem revelar senhas.

## 20. Cobrança SaaS independente do gateway

Criar domínio interno de faturamento, que funciona independentemente de fornecedor:

```text
BillingService
SubscriptionService
AccessPolicyService
PaymentProviderRegistry
PaymentProviderAdapter
WebhookInbox
BillingReconciliationJob
```

Interface conceitual do adaptador:

```text
createCustomer
createCheckout
createSubscription
updateSubscription
cancelSubscription
getPayment
getSubscription
refundPayment
validateWebhook
normalizeEvent
```

Capacidades indisponíveis no fornecedor devem retornar condição explícita; não simular sucesso.

- Primeiro adaptador: **Mercado Pago**, validando APIs e capacidades atuais na documentação oficial durante implementação.
- Mensal: recorrência em cartão quando suportada/configurada.
- Anual: pagamento único por meio permitido e escolhido pelo contratante.
- Guardar identificadores internos e externos com o provedor e ambiente.
- Tokenização/checkout seguro; nunca armazenar número completo ou CVV.
- Webhooks verificados, eventos persistidos e processamento idempotente.
- Consultar o provedor para confirmar estado quando necessário.
- Tratar eventos atrasados, fora de ordem, duplicados, reembolso e contestação.
- Reconciliar periodicamente cobranças sem confirmação.
- Renovar o período pago uma única vez por evento financeiro válido.
- Jobs duráveis com retentativa, backoff e fila de falhas.
- Informar falha de sincronização de plano, sem mostrar alteração como concluída se o gateway a rejeitou.
- Troca de gateway não migra automaticamente tokens ou assinaturas antigas. Novas cobranças podem usar o novo provedor; existentes seguem no original até migração explícita, sem cobrança dupla.

Separar totalmente **cobrança SaaS da plataforma** e **pagamentos dos consumidores ao estabelecimento**: credenciais, contas recebedoras, eventos, permissões e conciliação independentes.

### 20.1 InfinitePay Smart — vendas do estabelecimento e importação

**Cenário obrigatório:** o estabelecimento continua realizando vendas diretamente na maquininha Smart física da InfinitePay e precisa registrá-las também no RUSTEN. Não exigir que essas vendas sejam iniciadas no RUSTEN ou substituídas por checkout/InfiniteTap.

Este módulo é independente da cobrança das mensalidades SaaS no MASTER. A conta InfinitePay pertence à empresa recebedora; nunca encaminhar pagamentos dos consumidores para a conta da plataforma por padrão.

Situação de referência em 30/09/2026: a documentação consultada confirma exportação de relatórios de vendas em CSV. Não foi confirmada API pública para capturar automaticamente todas as vendas da Smart física ou sincronizar seu catálogo com sistemas externos. Implementar a preparação técnica sem apresentar essas capacidades como disponíveis.

| Modalidade | Entrega requerida |
|---|---|
| Smart física — relatório CSV | Importador com prévia, mapeamento, validação e conciliação |
| Smart física — lançamento manual | Registro de venda externa ou de pagamento de comanda existente |
| Smart física — sincronização oficial | Adaptador preparado, desabilitado até documentação, acesso e homologação |
| Checkout Integrado | Integração opcional para novas cobranças originadas no RUSTEN |
| InfiniteTap | Integração opcional e separada para celular compatível |
| Catálogo e estoque da InfinitePay | Não ativar sincronização sem interface oficial validada |

**Checkout e InfiniteTap não são mecanismos de importação do histórico da Smart.** Não usar suas consultas/webhooks para presumir acesso a todas as transações da conta.

### 20.2 Tela de configuração InfinitePay por empresa

Criar **Configurações → Integrações → InfinitePay**, com abas:

- **Conta:** nome da integração, identificação do recebedor, InfiniteTag quando aplicável, unidade responsável e status. Identificação preenchida manualmente não comprova titularidade nem conexão verificada.
- **Maquininhas Smart:** apelido, número de série quando disponível, unidade, terminal lógico, ativo/inativo e histórico de vínculos.
- **Importação:** formatos suportados, perfis de colunas, fuso, formato de data, separador decimal, tipo do relatório e conta financeira de destino.
- **Conciliação:** formas de pagamento equivalentes, critérios de correspondência, política de revisão e categorias de taxas/ajustes.
- **Checkout:** habilitar/desabilitar, InfiniteTag, URLs de retorno e webhook geradas pelo sistema, consulta de pagamento e status da configuração.
- **InfiniteTap:** habilitar/desabilitar, dispositivos e configuração de retorno específica; não confundir com Smart física.
- **Sincronização oficial:** disponibilidade do adaptador, autorização, capacidades, última execução e pendências. Inicialmente mostrar “Indisponível — integração oficial da Smart ainda não validada”.
- **Histórico:** lotes importados, erros, conciliações, cancelamentos, alterações e operador responsável.

Campos secretos apenas quando exigidos pela interface oficial da modalidade, protegidos no backend. Não inventar chave de API ou pedir senha do aplicativo InfinitePay para importar CSV. Não usar captura automatizada de sessão, APIs privadas ou raspagem do portal como substituto de integração oficial.

### 20.3 Importador de vendas CSV

Criar **Financeiro → Integrações → InfinitePay → Importar vendas**.

Fluxo:

1. Selecionar conta recebedora, unidade e arquivo CSV exportado da InfinitePay.
2. Identificar se o arquivo contém vendas, recebíveis, liquidações ou movimentações de conta. Não tratar todos como novas vendas.
3. Detectar codificação, delimitador e cabeçalhos; permitir ajuste e exibir amostra.
4. Escolher perfil de importação conhecido ou mapear as colunas manualmente.
5. Validar e classificar cada registro como novo, duplicado, atualização, possível correspondência ou erro.
6. Mostrar prévia, período, totais comparáveis, campos ausentes e impacto financeiro/estoque antes da confirmação.
7. Confirmar o lote com usuário autorizado e processar sem duplicar registros em retentativas.
8. Exibir resumo por resultado e permitir baixar erros de validação, sem perder linhas rejeitadas.

Não presumir um layout ainda não fornecido. O mecanismo genérico pode ser implementado, mas o perfil “InfinitePay validado” só fica disponível após teste com exportação real representativa. Até lá, indicar “Aguardando arquivo de exemplo para validar layout”. Não anunciar CSV genérico como conector homologado.

Campos candidatos, importados **somente quando presentes e com significado validado**:

| Grupo | Campos candidatos |
|---|---|
| Identificação | ID da transação, NSU, autorização, número de série, conta recebedora |
| Datas | Venda, previsão de recebimento, liquidação, atualização |
| Valores | Bruto, taxa, líquido, desconto, acréscimo e valor cancelado |
| Pagamento | Crédito, débito, Pix, bandeira, parcelas, status |
| Itens | Código externo, SKU, descrição, quantidade, preço unitário e total |

Mostrar campos indisponíveis como não informados. Não inventar taxa, data de liquidação, produtos ou quantidades. Diferenças aritméticas podem ser apresentadas para revisão, sem classificá-las automaticamente como tarifa contratual.

Suportar valores brasileiros, zeros à esquerda nos identificadores, aspas, campos vazios, formatos de data explícitos e limites de tamanho/linhas. Rejeitar arquivo inválido com orientação útil. Neutralizar fórmulas em exportações de erros e auditoria.

OFX pode ser previsto para conciliação financeira após validar o formato real; não usá-lo como fonte presumida de itens vendidos. PDF permanece documento de consulta/anexo, sem importação automática obrigatória.

### 20.4 Duplicidades, parcelas e reprocessamento

- Identidade principal: empresa + conta recebedora + identificador externo da transação; complementar com tipo de evento ou parcela quando necessário.
- Não usar NSU isolado como chave global sem validar sua unicidade no contexto real.
- Se não houver identificador estável, usar comparação de campos como sinal de possível duplicidade e exigir revisão. Mesmo valor/horário não comprovam a mesma venda.
- Hash do arquivo detecta reenvio do mesmo lote; também deduplicar registros de arquivos diferentes com períodos sobrepostos.
- Reimportação pode atualizar status validado ou acrescentar eventos; nunca gerar novamente receita, estoque ou recebimento já contabilizado.
- Parcelas e depósitos de uma venda não representam novas vendas. Vincular recebíveis e liquidações à transação de origem quando houver dados suficientes.
- Preservar arquivo original, linha de origem, perfil de mapeamento, versão do parser, autor e resultados de processamento conforme política de retenção.
- Lotes parcialmente processados podem ser retomados; cada linha deve ter estado persistente e efeitos idempotentes.
- Estornar importação mediante reversões auditadas e análise de dependências; não apagar movimentos já conciliados ou documentos fiscais.

### 20.5 Conciliação com vendas e comandas do RUSTEN

Oferecer dois destinos distintos:

**A. Pagamento de venda já registrada no RUSTEN**

Vincular a transação externa ao recebimento/comanda existente. Se o operador já registrou o pagamento manualmente, apenas reconciliar esse registro; não adicionar outro pagamento. Não criar nova venda, nova receita ou nova baixa de estoque.

**B. Venda realizada somente na Smart**

Criar registro de **Venda externa — InfinitePay Smart**, com dados efetivamente disponíveis e ligação ao pagamento. Se faltarem itens, classificar como **Sem detalhamento de produtos** e não movimentar estoque nem atribuir categoria de produto fictícia.

Regras:

- Correspondência automática apenas com vínculo inequívoco e único entre transação e venda, respeitando conta, unidade, moeda e saldo.
- Valor e proximidade de horário servem para sugerir correspondências, nunca para fechar comandas automaticamente.
- Permitir seleção manual com confirmação, justificativa e auditoria.
- Suportar uma comanda paga em várias transações e, quando autorizado, uma transação rateada entre comandas. A soma alocada não pode exceder o pagamento nem o saldo elegível.
- Não reabrir caixa fechado silenciosamente. Tratar conciliação posterior preservando data da venda, data do pagamento, data de liquidação e data de importação.
- Diferenciar “Pagamento informado pelo operador”, “Importado de relatório” e “Confirmado por integração oficial”. CSV importado não deve ser rotulado como confirmação online da API.
- Cancelamentos, estornos e contestações seguem eventos separados; um chargeback não implica retorno físico de mercadoria ao estoque.
- Relatórios devem separar vendas, recebimentos e liquidações, evitando contagem dupla entre caixa, importação e extrato bancário.

### 20.6 Produtos vendidos e estoque

Se o relatório contiver itens individualizados:

1. Apresentar associação entre código externo e produto/SKU RUSTEN.
2. Validar unidade, quantidade, preço e integridade da composição do pedido.
3. Permitir salvar associações dentro da conta/empresa correta.
4. Encaminhar códigos não associados para revisão; nomes parecidos não bastam para equivalência automática.
5. Aplicar a política de estoque/receita versionada somente após confirmação e uma única vez.

Baixa de estoque em importação deve começar desabilitada. Para ativar, exigir permissão e escolha da data de início do controle, evitando descontar vendas históricas já contempladas no saldo inicial/inventário. Ausência de receita histórica compatível deve gerar pendência, não consumo silencioso da receita atual.

Se o arquivo contiver apenas totais financeiros, não deduzir quantidades ou produtos pelo valor. Permitir complementar os itens manualmente, com identificação da autoria, revisão e prevenção de nova contabilização financeira.

O estoque RUSTEN permanece sob seu próprio controle. Importar vendas não comprova atualização do estoque InfinitePay. Sincronização de catálogos/estoques só poderá ser habilitada com contrato oficial de integração, direção dos dados e tratamento de conflitos definidos.

### 20.7 Preparação para integração automática oficial

Criar adaptador separado do gateway SaaS, com capacidades explícitas:

```text
MerchantSalesProvider
  capabilities
  importSalesFile
  fetchSales           // opcional, somente com API oficial validada
  fetchSaleDetails     // opcional
  fetchSettlements     // opcional
  verifyWebhook        // opcional
  normalizeEvent
  fetchCatalog         // opcional
```

Não criar endpoints InfinitePay fictícios. Métodos não disponíveis retornam “capacidade não suportada”. O motor comum recebe registros normalizados do CSV e, futuramente, da integração oficial, preservando origem e a mesma estratégia de deduplicação.

Ao validar integração oficial, implementar autenticação documentada, paginação, limites, sincronização incremental, recuperação de lacunas, retentativas e reconciliação. Deduplicar também entre API e CSV; migração de modalidade não pode importar novamente vendas antigas.

Habilitar sincronização somente após testar acesso à conta correta, vendas reais representativas, duplicidades, parcelas, cancelamentos e correspondência de identificadores. Exibir última sincronização e atraso; falha de conexão não significa “nenhuma venda”.

### 20.8 MASTER e permissões da InfinitePay

Preservar a estrutura MASTER existente e acrescentar:

- Catálogo de conectores e capacidades disponíveis por sistema/plano.
- Habilitação do módulo **Importação e conciliação InfinitePay** por empresa.
- Status técnico e indicadores de lotes/erros, com acesso mínimo a dados pessoais.
- Liberação de sincronização automática somente quando o adaptador oficial estiver validado.
- Separação visual entre **Gateway da assinatura SaaS** e **Meios de recebimento do estabelecimento**.
- Conta recebedora e destino financeiro configurados por empresa; MASTER não altera destinatário silenciosamente.

Permissões adicionais:

```text
integracoes.infinitepay.configurar
integracoes.infinitepay.importar
integracoes.infinitepay.conciliar
integracoes.infinitepay.reverter_importacao
integracoes.infinitepay.associar_produtos
integracoes.infinitepay.autorizar_baixa_estoque
integracoes.infinitepay.sincronizar
```

Aplicar escopo por unidade/empresa a arquivos, lotes, transações e associações. Alterações de conta recebedora e política de estoque exigem reautenticação quando apropriado e auditoria.

### 20.9 Modelo de dados, indicadores e testes complementares

Entidades adicionais: `merchant_payment_connections`, `external_terminals`, `import_profiles`, `import_batches`, `import_rows`, `external_sales`, `external_sale_items`, `external_payment_events`, `reconciliation_allocations`, `external_product_mappings`, `merchant_sync_cursors`.

Indicadores: vendas externas importadas, pagamentos conciliados, não conciliados, itens sem associação, duplicidades, cancelamentos, erros de lote e última sincronização. Não incluir receita dos estabelecimentos no MRR da plataforma.

Critérios de aceite adicionais obrigatórios:

| Cenário | Resultado |
|---|---|
| Mesmo CSV enviado duas vezes | Nenhum efeito financeiro/estoque duplicado |
| CSV com períodos sobrepostos | Deduplicação por transação, não apenas por arquivo |
| Duas vendas legítimas de mesmo valor | Ambas preservadas; sem fusão por valor |
| Venda já paga manualmente no RUSTEN | Conciliação sem novo pagamento/receita |
| Venda externa sem itens | Registro financeiro sem baixa de estoque |
| Itens presentes e associados | Baixa autorizada uma vez, respeitando início do controle |
| Histórico anterior ao saldo inicial | Não descontar estoque novamente |
| Relatório por parcela/recebimento | Não multiplicar faturamento pelo número de parcelas |
| Arquivo com colunas desconhecidas | Mapeamento/prévia; nenhuma importação silenciosa |
| Lote interrompido | Retomada sem duplicidade |
| Cancelamento reimportado | Evento atualizado sem reversão duplicada |
| Correspondência ambígua | Revisão humana antes de vincular/fechar |
| API futura e CSV representam mesma venda | Registro único com origens rastreáveis |
| Smart sem API oficial habilitada | Sincronização indisponível; CSV/manual continuam utilizáveis |
| Arquivo/conta de outra empresa | Acesso e associação rejeitados |

### 20.10 Documentação e validação de referência

Entregar manual de exportação do relatório InfinitePay, importação no RUSTEN, associação de produtos e conciliação; perfil CSV validado depende do arquivo real fornecido pelo usuário. Não bloquear a implementação do mecanismo genérico por falta dessa amostra, mas explicitar a pendência de homologação do layout.

Referências oficiais consultadas em 30/09/2026, a revalidar antes da implementação das respectivas integrações:

- [Relatório de vendas pelo aplicativo — CSV/PDF](https://ajuda.infinitepay.io/pt-BR/articles/6545795-como-gerar-um-relatorio-de-vendas-pelo-app)
- [Relatório de vendas pelo navegador](https://ajuda.infinitepay.io/pt-BR/articles/6399448-como-gerar-um-relatorio-de-vendas-pelo-navegador)
- [Relatório na maquininha Smart](https://ajuda.infinitepay.io/pt-BR/articles/9897646-como-imprimir-um-relatorio-de-vendas-na-maquininha)
- [Documentação do Checkout Integrado](https://www.infinitepay.io/checkout-documentacao)
- [Integração InfiniteTap](https://www.infinitepay.io/checkout-tap)
- [Portal de desenvolvedores](https://www.infinitepay.io/desenvolvedores)

## 21. SaaS, isolamento e arquitetura de dados

- Aplicação multiempresa com isolamento rígido por `tenant_id` e escopo adicional de unidade.
- Resolver tenant a partir de identidade autenticada; não confiar em `tenant_id` enviado pelo cliente.
- Aplicar isolamento em consultas, alterações, relatórios, exportações, anexos, cache, jobs, webhooks e canais em tempo real.
- Chaves estrangeiras/constraints devem impedir referência cruzada entre empresas.
- Papel MASTER separado do papel proprietário; acesso administrativo explícito e auditado.
- Valores de configuração e concessões de acesso validados no servidor.
- Logs não podem carregar senhas, tokens ou dados completos de cartão.

Entidades mínimas:

| Domínio | Entidades |
|---|---|
| Plataforma | systems, tenants, plans, plan_versions, module_entitlements, access_overrides |
| Identidade | users, memberships, roles, permissions, sessions, recovery_tokens |
| Estrutura | units, terminals, shifts, production_sectors, printers |
| Atendimento | dining_tables, reservations, waiting_list, tab_cards, consumption_sessions |
| Vendas | orders, order_items, modifiers, transfers, payments, refunds |
| Cardápio | products, product_codes, categories, recipes, recipe_versions, combos, promotions |
| Estoque | ingredients, warehouses, lots, stock_movements, purchases, production_batches |
| Financeiro | cash_sessions, cash_movements, receivables, payables, accounts, reconciliations |
| Relacionamento | customers, consents, loyalty_ledger, vouchers, feedback |
| SaaS | subscriptions, invoices, payment_attempts, provider_events, trial_grants |
| Infraestrutura | audit_events, outbox_events, webhook_inbox, sync_operations, fiscal_documents |

Usar transações nas operações locais de venda/estoque/financeiro. Para efeitos externos, usar outbox, idempotência e compensações explícitas. Aplicar controle de versão ao fechamento e transferência de comandas para impedir conflitos entre terminais.

## 22. Operação offline e sincronização

Implementar política explícita, sem prometer capacidades que dependem de conexão:

- Cache local mínimo de cardápio, permissões válidas e dados operacionais autorizados.
- Fila local durável com identificadores únicos, horário local, terminal e estado de sincronização.
- Mostrar **Offline**, operações pendentes, última sincronização e limitações.
- Durante isolamento sem servidor local, permitir vendas novas do próprio terminal conforme concessão offline; comandas compartilhadas ficam restritas ao terminal que detenha posse válida ou em consulta.
- Não permitir que dois terminais offline alterem livremente a mesma comanda.
- KDS remoto, Pix online, cartão integrado e emissão fiscal não devem ser apresentados como confirmados sem comunicação correspondente.
- Opcionalmente, um servidor local autenticado pode manter comunicação PDV/KDS na rede do estabelecimento; isso é infraestrutura adicional, não capacidade automática do navegador.
- Na reconexão, deduplicar, preservar ordem por entidade, verificar versões e encaminhar conflitos para resolução registrada.
- Não descartar venda por mudança de preço ou estoque; preservar o registro e tratar conflito explicitamente.
- Licença offline assinada, limitada no tempo e vinculada ao terminal; não permitir contornar bloqueio mudando relógio local.
- Bloqueio remoto só se propaga ao terminal desconectado na reconexão ou expiração da concessão; documentar essa limitação.
- Não limpar fila pendente em logout, atualização ou troca de tenant; proteger os dados e exigir sincronização/resolução apropriada antes de remoção.

## 23. Segurança, auditoria e continuidade

- Hash forte de senhas, gerenciamento seguro de sessões, rate limiting e MFA no MASTER.
- Preservar política ORBI de bloqueio temporário após tentativas inválidas, com proteção adicional contra abuso e configuração documentada.
- Validação de entrada, autorização por objeto, queries parametrizadas e proteção contra XSS, CSRF quando aplicável e upload malicioso.
- Segredos em configuração segura do ambiente; nenhuma chave sensível no bundle do frontend.
- Webhooks assinados, proteção contra replay e limites de requisição.
- Auditoria de cancelamentos, descontos, modo de leitura, autorizações, estoque, caixa, planos, bloqueios, liberações e acessos administrativos.
- Registrar ator, empresa, unidade, terminal, ação, motivo, instante e alterações relevantes, sem capturar segredos.
- Logs críticos append-only com permissões restritas; políticas de retenção não podem apagar livremente evidências obrigatórias.
- Backup criptografado, política de retenção, monitoramento e restauração ensaiada.
- Exportação JSON da empresa não substitui backup operacional completo de banco e anexos.
- Definir objetivos de recuperação e de perda máxima de dados; documentar o que foi efetivamente validado.
- Auditoria de segurança com foco em isolamento entre empresas, escalada para MASTER, cobrança, scanner, integrações públicas e sincronização.
- Corrigir vulnerabilidades relevantes encontradas e registrar riscos residuais. Não declarar sistema inviolável.

## 24. Relatórios

- Faturamento, recebimentos, saldo aberto e ticket médio.
- Vendas por período, hora, produto, categoria, garçom, mesa, terminal, unidade e canal.
- Margem, CMV real/teórico, perdas e divergência de estoque.
- Tempo de produção, entrega, permanência e giro de mesas.
- Cancelamentos, descontos, reaberturas, transferências e autorizações.
- Uso de dupla leitura, lançamentos manuais, exceções e falhas de códigos.
- Taxa de serviço e comissões.
- Fluxo de caixa, DRE gerencial e conciliação por meio de pagamento.
- Fidelidade, retorno e satisfação de clientes.
- MASTER: MRR, receita recebida, inadimplência, testes, conversão e cancelamentos por sistema.

Tabelas com filtros, paginação, totais, exportação e impressão. Fórmulas e bases dos indicadores devem ser documentadas; dados financeiros ocultos de perfis não autorizados, inclusive nas APIs e exportações.

## 25. Critérios de aceite obrigatórios

| Cenário | Resultado verificável |
|---|---|
| Leitor desligado | Venda manual completa, do produto ao recebimento |
| Dupla leitura desligada | Seleção manual e leitura contínua funcionam conforme configuração |
| Par comanda/produto válido | Um único item na sessão correta |
| Novo produto após par concluído | Exige nova comanda no modo obrigatório |
| Produto antes de comanda | Nenhum lançamento |
| Outra comanda no meio do par | Par cancelado e aviso; nenhum destino trocado silenciosamente |
| Timeout | Nenhum item lançado e seleção temporária limpa |
| Opções obrigatórias | Item confirmado apenas após preenchimento |
| Exceção manual autorizada | Item auditado e retorno à dupla leitura |
| Operador sem permissão | Backend rejeita troca de modo e exceção |
| Duas vendas legítimas do mesmo produto | Ambas contabilizadas |
| Reenvio da mesma operação | Apenas uma inclusão |
| Cartão reutilizado | Nova sessão sem misturar histórico anterior |
| Dois terminais fecham a mesma comanda | Apenas um fechamento efetivo |
| Cancelamento após preparo | Reversão financeira e destino físico do estoque tratados separadamente |
| Pagamento misto com falha parcial | Saldo correto, sem duplicar a parcela aprovada |
| Acesso cruzado de tenant | Rejeitado em API, exportação, anexos e eventos |
| Usuário comum acessa MASTER | Rejeitado no servidor |
| Teste 15/30/ilimitado | Prazo e acesso correspondem à concessão |
| Vencimento mais carência | Bloqueio no limite configurado |
| Pagamento confirmado | Liberação financeira idempotente, sem remover bloqueio administrativo |
| Liberação manual | Acesso concedido sem registrar pagamento fictício |
| Evento duplicado/fora de ordem | Estado financeiro consistente |
| Troca de gateway | Nenhuma duplicação ou migração implícita de assinatura |
| Falha de conexão com ORBI/TORVEN | Status de falha sem corromper dados consolidados |
| Offline e reconexão | Nenhuma perda/duplicação; conflitos tratados visivelmente |
| Documento fiscal rejeitado | Não exibido como autorizado |
| Recuperação de senha | Token expira, uso único e sessões anteriores revogadas |
| Restauração de backup | Dados e relações recuperados em ambiente isolado |

## 26. Sequência de execução e entregáveis

Executar por etapas integradas:

1. Diagnóstico do repositório e matriz de aproveitamento do ORBI.
2. Modelo multiempresa, autenticação, permissões e equivalência MASTER.
3. Cardápio, cartões/sessões, mesas, PDV manual e caixa.
4. Leitura contínua, dupla leitura opcional e autorizações manuais.
5. KDS, estoque, receitas, compras e financeiro.
6. Cobrança SaaS desacoplada, Mercado Pago, prazos e bloqueios; módulo independente de importação e conciliação de vendas InfinitePay Smart, com configurações e adaptador futuro conforme seção 20.1–20.10.
7. Delivery, cardápio público, reservas, fidelidade e atendimento.
8. Offline, integrações fiscais/periféricos e observabilidade.
9. Validação integrada, segurança, documentação e preparação de publicação.

Entregar:

- Código funcional e migrações versionadas.
- Matriz de funcionalidades mantidas/adaptadas/novas.
- Configuração de ambiente sem segredos reais.
- Manual do operador, do gerente e do MASTER.
- Instruções para configurar os três modos do PDV e testar o leitor.
- Instruções de cobrança, gateway, webhooks, suporte e recuperação de acesso.
- Documentação das APIs, eventos, políticas offline e modelo de dados.
- Testes relevantes dos critérios críticos e relatório do que passou/falhou.
- Plano de backup, restauração, atualização e reversão.
- Relação de credenciais, equipamentos ou homologações ainda necessários, sem simular sucesso.
- Histórico de alterações e limitações conhecidas.

**Resultado esperado:** RUSTEN operacional para alimentação, com lançamento manual independente de scanner, dupla leitura habilitável/desabilitável conforme permissões, gestão integrada do estabelecimento e área MASTER equivalente à do ORBI, incluindo administração central de sistemas, empresas, assinaturas, testes, prazos, pagamentos, bloqueios e liberações.
