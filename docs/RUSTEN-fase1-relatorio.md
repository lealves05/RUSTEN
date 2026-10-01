# RUSTEN — Relatório da Fase 1 (base, PDV com motor de leitura e caixa)

Data: 30/09/2026 · Repositório novo `RUSTEN` (commit local, **push pendente**). Entregue como `RUSTEN-fase1.zip` e `rusten-fase1.bundle`
para `D:\Programacao\RUSTEN`.

## Diagnóstico e decisões

- **Código do ORBI não pôde ser lido nesta sessão** (a pasta foi liberada, mas as ferramentas de leitura de arquivos não ficaram
  disponíveis). O RUSTEN foi construído a partir da especificação e do que está documentado nos relatórios do ORBI/TORVEN:
  mesma pilha (Express 5 + pg + zod / React + Vite + Tailwind), migrações SQL aplicadas no boot, smoke ponta a ponta, CI no GitHub
  Actions, publicação GitHub → Render → Vercel → Supabase.
- **Produto separado**: repositório e banco próprios; nada do ORBI/TORVEN foi alterado. Como não há código herdado, não houve
  tabelas de agenda/serviços a preservar.
- **Cobrança e MASTER pela central do ORBI** (contrato v1), em vez de duplicar um MASTER dentro do RUSTEN. O RUSTEN aplica a
  precedência de acesso da seção 19.7 localmente com o que a central entrega.
- **Pendência de compatibilidade**: o formato exato da assinatura HMAC do contrato v1 (cabeçalhos e base assinada) foi
  implementado como `timestamp.nonce.MÉTODO.caminho.sha256(corpo)` com cabeçalhos `x-platform-*`. Precisa ser conferido com
  `saas/hub.js` do ORBI antes de ligar a central; o ajuste fica concentrado em `backend/src/lib/platform.js` (`sign`/`verifyPlatform`).
- Dinheiro em **centavos inteiros**; quantidade com 3 casas; rateio determinístico de centavos.
- **Dia comercial** por unidade (corte configurável, padrão 05:00): vendas da madrugada contam no dia anterior.

## Matriz de aproveitamento (ORBI → RUSTEN)

| Recurso | Situação nesta fase |
|---|---|
| Multiempresa, unidades, perfis com hierarquia, auditoria imutável, sessão com rotação, bloqueio após 8 senhas | **Mantido** (reimplementado no padrão ORBI) |
| Profissionais | **Adaptado**: usuários com 11 perfis (Proprietário … Consulta) |
| Serviços e categorias | **Adaptado**: cardápio (produtos, categorias, setores, opções, preço com histórico) |
| Agenda de profissionais / agendamento online | **Retirado** da experiência RUSTEN (reservas de mesa em fase posterior) |
| Comandas e caixa | **Expandido**: cartão físico × sessão de consumo, mesas, PDV em 3 modos, pagamento misto, caixa cego |
| MASTER e cobrança SaaS | **Via central do ORBI** (portão 402/403, verificação, checkout, planos públicos) |
| Estoque, fichas técnicas, KDS, delivery, clientes, fidelidade, marketing, agente, fiscal, InfinitePay | **Próximas fases** (menu mostra "em breve"; nada simulado) |

## Entregue

- **Cadastro em 4 etapas** (empresa, responsável, plano da central ou acesso inicial, configuração: unidade, mesas, cartões,
  modo do PDV, virada do dia, cardápio de demonstração removível).
- **PDV** com os três modos no mesmo motor e as mesmas regras de preço/permissão:
  - *Manual*: busca, favoritos, categorias, código digitado, multiplicador de quantidade; "leitor não obrigatório".
  - *Leitura contínua*: lê a comanda uma vez; cada produto lido entra no destino ativo; outra comanda troca o destino com aviso.
  - *Dupla leitura*: COMANDA → PRODUTO por item, contagem regressiva, Esc cancela o par, segunda comanda cancela o par,
    produto antes da comanda é recusado, opções obrigatórias mantêm o destino fixo, peso obrigatório para produto por peso.
  - **O servidor confere o par**: no modo dupla a API reprocessa os dois códigos e recusa comanda que não corresponde ao destino.
  - **Idempotência**: cada lançamento/pagamento tem chave única; reenvio e envios simultâneos geram uma só inclusão;
    resposta incerta vira "Conferir operação" (consulta pela chave, nunca duplica).
  - Exceção manual na dupla obrigatória: permissão própria + autorização individual do gerente (e-mail/senha, uso único,
    2 minutos), auditada; depois volta à dupla leitura.
  - Troca de modo auditada; política obrigatória impede sair da dupla.
- **Roteador de códigos** único (`scan_codes`): texto, zeros à esquerda preservados, vários códigos por produto, um código
  pertence a uma só entidade (cadastro ambíguo recusado), leituras desconhecidas auditadas.
- **Cartões × sessões**: uma sessão ativa por cartão (índice único), cartão reutilizado não mistura histórico, bloqueio,
  substituição de cartão perdido mantendo a sessão, geração em lote e relação imprimível de códigos.
- **Salão**: mapa por ambiente, situação com texto+ícone, em preparo/prontos separados, várias comandas por mesa, troca de mesa,
  mesa com consumo não pode ser liberada.
- **Consumo**: cancelamento de item com motivo (autorização quando falta permissão; marca "após preparo"), transferência e
  junção com rastreabilidade, taxa de serviço discriminada e ajustável com motivo, pedir conta, suspender/retomar, pré-conta
  impressa "NÃO É DOCUMENTO FISCAL", fechamento com controle de versão (dois terminais → um só fechamento), reabertura com permissão.
- **Pagamentos**: dinheiro/Pix/débito/crédito/vale/outro, parcial e misto, troco só em dinheiro, nunca acima do saldo, estorno
  vinculado ao original, origem "informado pelo operador".
- **Caixa**: por terminal (terminal obrigatório quando a empresa tem terminais), troco inicial, sangria/suprimento/despesa,
  fechamento cego com contador de cédulas e justificativa obrigatória em diferença, reabertura em até 48 h com motivo, histórico.
- **Configurações**: empresa e aparência (tema claro/escuro/automático, densidade, menu lateral/superior), PDV em três níveis
  (empresa → unidade → terminal; nível mais específico só restringe; configuração que elimina todos os meios de lançamento é
  recusada), usuários, perfis (matriz de permissões; ninguém concede o que não tem), unidades/terminais, assinatura, auditoria (CSV).
- **Início**: consumo lançado × recebido separados, consumos abertos, mesas, itens em preparo, caixas, divergências.
- Busca global (Ctrl+K), atalhos Alt+P/S/C/I, indicador de conexão, situação do caixa, avisos da assinatura, tela de bloqueio.

## Critérios de aceite cobertos (smoke — 44/44 OK)

Leitor desligado com venda completa · dupla desligada (manual e contínua) · par válido gera um item · produto antes da comanda ·
outra comanda no par · manual/contínua recusados com dupla obrigatória · exceção sem autorização recusada e autorizada auditada
(uso único) · opções obrigatórias · peso obrigatório · duas vendas iguais contam · reenvio (inclusive simultâneo) conta uma vez ·
cartão reutilizado · cartão bloqueado · fechamento concorrente · pagamento misto/troco/saldo · cancelar item pago · taxa de
serviço · transferência · mesa ocupada/limpeza · garçom sem permissão recusado no servidor · hierarquia de perfis · isolamento entre
empresas · terminal de outra empresa ignorado · caixa cego · bloqueio administrativo 402 com regularização acessível · liberação
manual · teste vencido/carência · módulo fora do plano 403 · chamada da central assinada/inválida/repetida · auditoria imutável ·
rotação de sessão com detecção de reuso · bloqueio por senhas · remoção da demonstração · caixa exige terminal · dia comercial ·
rateio · precedência de configuração.

Navegador (Playwright): cadastro → terminal → caixa → comanda → itens com opções → dupla leitura simulando o leitor → pagamento
com troco → encerramento; 12 telas entre desktop, celular e tema escuro sem erro de página nem rolagem lateral (os únicos erros de
console foram as fontes do Google, bloqueadas no ambiente de teste). Reversão da migração testada em clone.

## Manual rápido — PDV e leitor

1. Identifique o dispositivo (barra amarela "Terminal") e abra o caixa em Financeiro.
2. Configurações › PDV › Leitura e lançamento: escolha o modo padrão, se a dupla é obrigatória, tempo de espera, quantidade por
   leitura, terminador do leitor (Enter/Tab) e se a exceção exige gerente. Veja o "Resultado efetivo" à direita.
3. **Testar o leitor**: leitor USB/Bluetooth em modo teclado. No PDV, com o foco fora de campos de texto, leia `CMD-000001`:
   a barra deve mostrar a comanda. Os códigos de cada cartão estão em Salão › Cartões de comanda › Relação de códigos
   (imprima em Code 128 ou QR Code com o conteúdo exato). O campo "Digite ou leia o código" aceita o mesmo código digitado.
4. Sem leitor: modo Manual, abrir comanda/mesa ou Balcão e tocar nos produtos.

## Pendente (próximas fases, nada aparece como operacional)

KDS/cozinha e impressão setorial · estoque, fichas técnicas, compras, CMV · delivery e cardápio público · reservas e fila de
espera · clientes, fidelidade, avaliações, marketing · agente WhatsApp · fiscal (NFC-e/NF-e) e periféricos · importação e
conciliação InfinitePay (CSV genérico aguarda arquivo real para homologar o layout) · operação offline com fila local ·
relatórios · recuperação de senha por e-mail (hoje: redefinição pelo proprietário ou senha provisória pela central).

## Para colocar no ar (situação em 30/09/2026)

- **API no ar**: Supabase Edge Function `rusten-api` (versão 3) no projeto TORVEN, tabelas no esquema isolado **`rusten`**
  (26 tabelas; nada do TORVEN foi alterado). O plano gratuito limita a 2 projetos, por isso não houve projeto próprio.
  Endereço: `https://dwfbxrfniarhufltmlhb.supabase.co/functions/v1/rusten-api` — `/api/health` respondendo OK.
  Ajustes para o Edge: `lib/env.js` (process.env é somente leitura), `Buffer` de `node:buffer`, `deno.json` com `npm:`.
- **Site no ar**: https://rusten.vercel.app (Vercel, projeto `rusten`, publicado em 01/10/2026 pelo `PUBLICAR-RUSTEN.bat`).
  O npm global do Windows está corrompido (`Cannot find module './inventory.js'`); o script usa o Node portátil.
- Commit local 22af563 (entregue como `RUSTEN.zip` e `rusten.bundle`).
- Central: conferir o formato da assinatura com o `saas/hub.js` do ORBI antes de cadastrar o sistema `rusten` no Master.
