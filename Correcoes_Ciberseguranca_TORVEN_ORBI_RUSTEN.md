# Correções de cibersegurança - TORVEN, ORBI e RUSTEN

**Data:** 02/10/2026. **Uso:** roteiro de implementação para desenvolvimento/VibeCode.
**Base:** avaliação externa de baixo impacto, bundles públicos, revisão parcial dos repositórios TORVEN/ORBI e cinco reproduções locais isoladas.

## Instrução inicial para o agente de programação

Analise o projeto existente, suas instruções locais, migrations, backend, frontend, integrações e testes antes de editar. Aplique as correções correspondentes ao sistema aberto. Preserve dados, rotas, funções comerciais, isolamento entre empresas, layout e integração com a central Master. Faça mudanças em branch própria, com migrações reversíveis quando possível, e valide em homologação antes da publicação.

Não invente vulnerabilidades, endpoints ou estrutura de arquivos. Os caminhos abaixo foram confirmados nos snapshots indicados; resolva eventuais diferenças da branch atual. Não substitua o backend por uma autenticação apenas no frontend. Não coloque senhas, segredos JWT ou credenciais de gateway no JavaScript entregue ao navegador. Não use credenciais reais de clientes em testes.

Diferencie **falha observada na publicação**, **defeito do código analisado** e **condição dependente da configuração**. O código dos repositórios não foi vinculado criptograficamente ao deployment. Não declare uma condição presente em produção só porque ela é possível no código. Para RUSTEN, a revisão foi limitada ao material público e ao backend identificado no bundle; descubra o código real antes de implementá-lo.

## 1. Escopo e prioridades

| Ordem | Sistema | Achados | Entrega |
|---|---|---|---|
| P0 - primeira intervenção | TORVEN | F01, F02 | Validar segredo efetivo e corrigir invalidação de sessões |
| P0 - validar configuração | ORBI | F03 | Impedir chave JWT insuficiente; conferir rotação segura |
| P1 | ORBI | F04 | Revogar access token no logout |
| P1 | Todos | F05 | Reduzir exposição dos tokens no navegador |
| P1 | TORVEN | F07, F08, F09 | Limites compartilhados, senha consistente, posse das referências |
| P1 | TORVEN / RUSTEN | F10, F12 | CSP compatível com os recursos utilizados |
| P2 | TORVEN / RUSTEN | F06 | Restringir CORS nas APIs privadas |
| P2 | TORVEN | F11, F13 | Headers adicionais e regra explícita de assinatura indisponível |

P0 representa ordem de tratamento, sem significar que um ataque foi comprovado. F01/F03 dependem do segredo realmente instalado. Não foi comprovada invasão, exposição de clientes ou acesso indevido entre empresas.

Snapshots revisados:

- TORVEN: `lealves05/TORVEN`, commit `143f0429bc8888b95ae29f72590043d146a9d970`.
- ORBI: `lealves05/ORBI`, commit `b28ade7f39e81a4d5b9decabbfaa0c3d294b335f`.
- RUSTEN: repositório não localizado na conexão disponível.

## 2. Segredos JWT e início seguro - F01/F03

### TORVEN

**Arquivo confirmado:** `backend/src/auth.js`.

O código permite um segredo literal de desenvolvimento quando `JWT_SECRET` está ausente e apenas registra aviso em produção. Remova essa possibilidade nos ambientes publicados, incluindo Vercel, Supabase Edge e demais ambientes usados pelo projeto.

1. Identifique onde as variáveis são montadas no processo/Edge Function e se existe leitura de segredos do banco. Valide a configuração **após** essa montagem, antes de atender solicitações.
2. Em produção, chave ausente, conhecida, curta ou de exemplo deve impedir a inicialização. Não registre a chave no erro ou log.
3. Provisione uma chave gerada com pelo menos 32 bytes aleatórios. Uma string com 32 caracteres previsíveis não oferece a mesma garantia. Documente o formato aceito sem inserir o valor no repositório.
4. Fixe algoritmo, emissor, finalidade e audiência adequados ao sistema. Compare usuário, empresa e versão de autenticação com o banco.
5. Se a instalação estava usando uma chave fraca, trate a substituição como incidente de credencial: invalide as sessões afetadas de forma planejada.

### ORBI

**Arquivo confirmado:** `backend/src/security.js`, função `masterSecret()`.

A ausência da chave já provoca falha em produção, mas uma chave curta diferente do literal de desenvolvimento é aceita. Substitua o aviso de comprimento por validação impeditiva. Os testes locais aceitaram uma chave de um caractere; o valor real em produção não foi examinado.

**Cuidado com rotação:** o ORBI deriva chaves para decifrar configurações persistidas. Não troque `JWT_SECRET` sem estratégia para essas informações. Inventarie os usos de `derivedKey`, `seal` e `unseal`; implemente identificador/versão de chave e migração controlada ou separe chaves de autenticação e criptografia em repouso. Faça backup e valide leitura dos segredos existentes após a migração.

**Aceite:** testes de inicialização com chave ausente, padrão e curta falham; a chave válida inicia o serviço; tokens antigos seguem o plano de invalidação; nenhuma configuração persistida torna-se ilegível.

## 3. Revogação após mudança de senha - F02

**Sistema:** TORVEN.
**Arquivos confirmados:** `backend/src/routes/auth.js`, `backend/src/routes/users.js`, `backend/src/auth.js`.

As alterações próprias e administrativas atualizam apenas `password_hash`. O middleware verifica `password_changed_at`, que fica inalterado nesses caminhos. O reset por link de e-mail já atualiza esse campo. Uniformize o comportamento.

### Correção mínima

Atualize hash e marcador de alteração na mesma operação/transação em todos os fluxos. Exemplo ilustrativo, sujeito à estrutura existente:

```sql
UPDATE users
   SET password_hash = $1,
       password_changed_at = NOW()
 WHERE id = $2
   AND company_id = $3;
```

Esse ajuste elimina a omissão principal, mas o middleware atual usa comparação de horários com tolerância. Para invalidação determinística, adote uma versão de autenticação.

### Correção recomendada

1. Criar `auth_version` inteiro não nulo, inicializado em zero.
2. Incluir essa versão em novos JWTs.
3. Ao trocar senha ou realizar recuperação administrativa, incrementar a versão na mesma atualização do hash.
4. Em `requireAuth`, comparar a versão assinada com a versão atual do banco; divergência resulta em `401`.
5. Definir uma transição explícita para tokens anteriores sem versão. Não aceitá-los indefinidamente.
6. Atualizar também ativação de demonstração, redefinição por e-mail e qualquer rotina da central que altere credenciais.
7. Após alteração, criar uma nova sessão somente conforme a regra do produto. Ao redefinir senha de outro usuário, não emitir sessão para o administrador em nome dele.
8. Registrar o evento e usuário responsável sem armazenar senha ou token.

**Aceite:** com duas sessões fictícias anteriores, alterar a senha pelo usuário e pelo administrador; reapresentar os tokens antigos e exigir `401`. Login com a nova senha funciona. Repita para recuperação por e-mail e ativação. Teste mudanças no mesmo segundo para detectar problemas de relógio/tolerância.

## 4. Logout e duração de sessões - F04

**Sistema:** ORBI. **Arquivos:** `backend/src/auth.js`, `backend/src/routes/auth.js`.

O logout revoga o refresh token. A validação do access token não consulta a sessão renovável e permite uso até a expiração, com padrão de 12 horas. A área Master já usa outra sessão revogável; preserve essa separação.

1. Vincular cada access token a um identificador de sessão registrado no servidor.
2. Conferir sessão, usuário, empresa, finalidade, expiração e revogação em cada requisição protegida. Um cache dessa consulta deve ter uma janela de revogação explicitamente aceita.
3. O logout deve revogar a sessão específica e sua família de refresh tokens.
4. Reduzir o access token a um prazo curto, como 15 minutos, sem usar essa redução como substituto da revogação.
5. Manter rotação do refresh token, hash no banco e detecção de reutilização.
6. Definir e testar separadamente logout de um dispositivo e encerramento de todas as sessões.
7. Verificar que o mecanismo de detecção de reuso também impede utilização continuada de tokens de acesso das sessões revogadas.

**Aceite:** emitir sessão A e B; logout de A; access/refresh de A falham com `401`; B mantém funcionamento, salvo operação explícita de revogar todas. Token de equipe não é aceito no Master; token Master não é aceito como token comum.

## 5. Tokens no navegador e arquitetura de sessão - F05

**Sistemas:** os três. **Observado:** tokens em `localStorage`; não foi demonstrado XSS.

1. Inventariar armazenamento de access, refresh e tokens administrativos. Não mover senhas ou tokens para IndexedDB como se isso os tornasse inacessíveis a scripts.
2. Preferir refresh em cookie `HttpOnly; Secure` e sessão/access em memória ou gerenciamento no servidor.
3. Usar `SameSite=Lax` ou política mais restrita que funcione para os fluxos reais; quando houver necessidade de cookie entre sites, justificar `SameSite=None; Secure` e aplicar proteção CSRF apropriada.
4. Validar `Origin`/`Referer` e token CSRF em operações que modificam dados quando a autenticação passar a usar cookies. CORS não substitui CSRF nem autorização.
5. Limpar os itens antigos de Web Storage durante a migração e no logout.
6. Não devolver refresh token em JSON para o frontend quando o modelo escolhido depender de cookie HttpOnly.

### Particularidade do RUSTEN

O bundle publicado aponta diretamente para:

`https://dwfbxrfniarhufltmlhb.supabase.co/functions/v1/rusten-api`

A API verdadeira foi testada nesse endpoint. Solicitações a `/api/auth/me` no domínio Vercel devolvem o HTML da SPA e não avaliam a autenticação real.

Cookies no domínio Supabase e página em `vercel.app` podem depender de políticas de cookies entre sites. Para esta mudança, planeje proxy/BFF na mesma origem ou domínio próprio compatível; não transforme o aplicativo em um fluxo que dependa de cookies de terceiros bloqueados pelo navegador. Preserve o backend existente enquanto a transição é validada.

**Aceite:** login, renovação, logout, múltiplas abas e retorno do provedor de pagamento funcionam em navegadores usados pelo estabelecimento. Refresh tokens deixam de aparecer em `localStorage`/`sessionStorage`. Verifique CSRF e isolamento de sessão com contas fictícias.

## 6. CORS nas APIs - F06

**TORVEN e backend real RUSTEN:** refletiram uma origem de teste arbitrária. As respostas foram `401` e não permitiram credenciais de cookie; não houve vazamento de dados autenticados.

- Configure origens exatas por ambiente, separando produção, homologação e desenvolvimento.
- Em produção, ausência de configuração não deve liberar todas as origens das rotas privadas.
- Não aceite `localhost` em produção por uma condição embutida na allowlist.
- Revise o comportamento da Edge Function, proxy e gateway: a camada externa pode inserir CORS após o middleware da aplicação.
- Para endpoints públicos intencionais, mantenha política documentada e limites próprios.
- Não use CORS como controle de login. Clientes fora do navegador continuam podendo chamar o servidor.

**Aceite:** testar `GET` e `OPTIONS` com origem aprovada, origem de homologação, origem desconhecida e ausência de `Origin`. A origem desconhecida não recebe ACAO nas rotas privadas. O frontend autorizado continua funcionando e todas as rotas privadas mantêm autenticação.

## 7. Limites compartilhados de tentativas - F07

**Sistema:** TORVEN. **Arquivo:** `backend/src/routes/auth.js`.

Substitua contadores locais por armazenamento compartilhado e atômico compatível com Edge/serverless. Preserve limites diferentes para login, recuperação, cadastro, ativação e demonstração.

1. Contar por IP confiável e identificador normalizado, usando hash da chave quando apropriado.
2. Evitar confiar em `X-Forwarded-For` arbitrário; documentar quais cabeçalhos o proxy substitui.
3. Atualizar contador/janela atomicamente em Postgres ou Redis.
4. Definir limites configuráveis, expiração, limpeza de registros e resposta `429` com `Retry-After`.
5. Evitar bloqueio permanente de contas por tentativas de terceiros; usar janela e escalonamento adequados.
6. Em homologação, gerar as tentativas necessárias para o teste. Não executar brute force nem teste de carga na produção.

**Aceite:** duas instâncias somam tentativas sobre a mesma chave; reiniciar uma instância não zera o contador global; alteração de header fornecido pelo cliente não cria um IP confiável diferente; respostas não revelam existência de conta.

## 8. Política consistente de senha - F08

**Sistema:** TORVEN. **Arquivos:** rotas de autenticação e usuários.

Criar um schema central aplicado a cadastro, ativação, alteração própria, redefinição administrativa e recuperação por e-mail. Como objetivo de fortalecimento, exigir frases-senha de ao menos 15 caracteres para contas sem MFA, permitir colagem/autopreenchimento e bloquear senhas comuns. Se outra política for adotada, documente-a e aplique-a consistentemente.

Se mantiver bcrypt, limite pela quantidade de bytes UTF-8 a 72 e recuse excesso claramente; não trunque silenciosamente. Avalie Argon2id apenas se suportado pelo ambiente, com migração de hashes no login. Não gere nova senha previsível, não envie senha em logs e não invalide todos os usuários apenas por alterar o schema.

**Aceite:** a mesma senha curta é recusada em todos os fluxos; uma frase-senha adequada é aceita; caracteres multibyte não causam truncamento; hashes legados continuam verificáveis até a migração planejada.

## 9. Posse de referências e isolamento entre empresas - F09

**Sistema:** TORVEN. **Arquivo:** `backend/src/routes/users.js`.

Antes de aceitar `technician_id` ou `unit_id`, conferir que o registro pertence à empresa autenticada. A validação observada de UUID apenas confirma formato. A migration inicial traz FK simples do técnico; ela não prova igualdade de empresas. Inspecione também constraints, triggers e RLS efetivos da instalação.

1. Resolver `company_id` a partir da sessão validada, nunca a partir do corpo da requisição.
2. Consultar as referências com `id = $1 AND company_id = $2` na mesma transação da alteração.
3. Rejeitar referências ausentes ou de outra empresa sem revelar quem é o proprietário real.
4. Revisar os demais campos relacionados: cliente, equipamento, fornecedor, produto, unidade, OS, orçamento e conta financeira.
5. Revisar joins e exportações, além de escrita. Filtrar o registro principal não resolve automaticamente referências cruzadas.
6. Usar constraints compostas e RLS como defesa adicional quando compatíveis; não assumir que RLS ativo protege consultas feitas por papel que o ignora.

**Aceite:** criar A/B em banco descartável; todas as operações com IDs de B a partir de A falham e não deixam alterações parciais. O mesmo teste funciona com UUID válido, query string, corpo aninhado e rotas de exportação pertinentes.

## 10. CSP e bloqueio de frames - F10/F12

### TORVEN

**Arquivo confirmado:** `frontend/vercel.json`. Hoje contém rewrites, inclusive para `torven-api`, e não declara headers de proteção de HTML. Acrescente os headers preservando integralmente os rewrites existentes. `helmet` no backend não garante que o HTML estático da Vercel receba esses headers.

### RUSTEN

Não foi acessado o repositório. Descubra sua configuração de publicação e implemente a política no local adequado. O script inline de tema deve ser externalizado ou autorizado com hash/nonce; não habilite `unsafe-inline` em scripts apenas para evitar o ajuste. A política deve permitir a origem exata da API Supabase observada.

### Exemplo de política inicial para o frontend

O exemplo abaixo é uma base para testar, e não uma configuração final universal:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' data: blob:;
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;
```

No RUSTEN, acrescente a origem exata do backend a `connect-src`. Liste outras origens somente quando necessárias e verificadas. Não adicione `*` ou `unsafe-eval`. Adapte `frame-src`, workers e URLs blob apenas para os recursos realmente utilizados, como impressão ou visualização de PDFs.

1. Começar com `Content-Security-Policy-Report-Only`, corrigir recursos bloqueados e tratar dados dos relatórios sem expor conteúdo sensível.
2. Passar a `Content-Security-Policy` obrigatória após validação.
3. Colocar `frame-ancestors` no header HTTP. Essa diretiva não deve ser resolvida por meta tag.
4. Preservar `X-Frame-Options: DENY` no RUSTEN e introduzi-lo no TORVEN quando não houver requisito de embedding.
5. Manter a CSP existente do ORBI e verificar sua compatibilidade após qualquer mudança de arquitetura.

**Aceite:** iframe de origem externa é bloqueado; scripts de origem não permitida são bloqueados; nenhuma violação afeta login, impressão, anexos, checkout ou tema; a política final não permite avaliação dinâmica de scripts.

## 11. Headers adicionais e cache de dados sensíveis - F11

**Sistema:** TORVEN. Adicionar ao HTML e às respostas relevantes:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Permita `camera=(self)` somente se houver leitura/registro por câmera de fato. O leitor físico de código de barras não exige automaticamente câmera. Mantenha HTTPS/HSTS já observados. Não remova políticas existentes dos outros sistemas.

Como defesa adicional, garantir `Cache-Control: no-store` em autenticação, respostas privadas, exportações e dados financeiros/pessoais. O cabeçalho `public, max-age=0, must-revalidate` foi observado nas respostas anônimas das APIs TORVEN/ORBI; isso não comprovou cache de informação privada. Não desabilite cache dos assets públicos com hash apenas por essa observação.

**Aceite:** dados privados e tokens não são armazenados por caches; JS/CSS públicos continuam com política apropriada; nenhuma informação de um usuário aparece na sessão de outro por cache.

## 12. Assinatura SaaS, central e disponibilidade - F13

**Sistema:** TORVEN. **Arquivo:** `backend/src/platform.js`.

O retorno `null` de `accessFor` libera acesso em `platformGate`. Esse modo pode ser legítimo para uma instalação sem cobrança central, mas precisa ser explícito.

- Introduzir modo de operação inequívoco: `standalone` autorizado ou `saas_required`.
- Em `saas_required`, configuração da central ausente deve aparecer como erro operacional, sem conceder uso silencioso ilimitado.
- Se existir último estado válido, reutilizá-lo com tolerância documentada e prazo máximo. Nunca liberar automaticamente uma empresa já bloqueada.
- Definir comportamento quando não existir qualquer estado anterior e a central estiver fora do ar.
- Preservar login, consulta mínima de situação e regularização conforme a regra comercial; manter dados intactos durante bloqueio.
- Não acrescentar um bloqueio geral a todos os clientes por uma queda transitória sem validar o impacto operacional.

**Aceite:** testar empresa ativa, em teste, vencida, bloqueada, sem central, sem estado e com cache vencido; simular indisponibilidade em homologação; confirmar exatamente a política prevista em cada situação.

## 13. Testes ainda necessários para concluir a avaliação interna

Execute estes testes com dados fictícios e perfis separados. São pendências, não falhas já comprovadas:

| Área | Teste necessário | Evidência de aceite |
|---|---|---|
| Multiempresa | Empresa A/B em todos os endpoints de dados e exportações | A não lê, altera ou relaciona registros de B |
| Perfis | Proprietário, administrador, atendente, técnico e usuário restrito | Permissões também são verificadas no servidor |
| Master | Token comum em rotas Master; token Master em rotas comuns; MFA | Finalidades isoladas; ações e eventos auditados |
| XSS | Campos persistidos, importações, observações, impressões e PDFs | Conteúdo tratado corretamente no contexto de saída |
| Injeção | SQL, filtros, buscas, parâmetros e ordenação | Consultas parametrizadas; identificadores controlados |
| Uploads | MIME declarado versus bytes reais, PDF, imagem e tamanho | Conteúdo validado; limites; nomes seguros; acesso autorizado |
| Sessão | Logout, refresh concorrente, revogação, MFA, reset e múltiplas abas | Comportamento consistente e tokens antigos recusados |
| Pagamentos | Assinatura, idempotência, reenvio e conciliação do webhook | Nenhuma liberação por retorno do navegador sem confirmação |
| RUSTEN/PDV | Caixa, comanda, dupla leitura, preços, cancelamento, estorno | Operações autenticadas e auditadas; totais calculados no servidor |
| Gateway | Mercado Pago, InfinitePay ou demais integrações utilizadas | Valor, empresa e evento conciliados; segredos somente no servidor |
| Dependências | Lockfiles, SBOM, auditoria e advisories oficiais | Versões documentadas; vulnerabilidades tratadas com evidência |
| Infraestrutura | Variáveis, papéis do banco, RLS, backups, restore e logs | Configurações efetivas verificadas; recuperação demonstrada |

Não marcar uma área como aprovada apenas porque o scanner não encontrou um problema. Os testes externos desta avaliação não incluíram contas autenticadas, revisão integral de código, load test, enumeração de clientes, exploração de dados reais ou auditoria completa de dependências.

## 14. Entregas obrigatórias após a implementação

1. Lista dos arquivos alterados e migrations aplicadas.
2. Resultado antes/depois para cada achado, com seu ID.
3. Comandos de verificação e resultados dos testes significativos.
4. Política de sessão, segredo e CORS documentada por ambiente.
5. Registro das pendências e das condições não verificadas.
6. Confirmação de que o frontend e as regras comerciais continuam funcionando.
7. Relatório de reteste do ambiente publicado, sem expor tokens, senhas, clientes ou credenciais de gateway.

Classifique cada ID como `CORRIGIDO E RETESTADO`, `CORRIGIDO - RETESTE PENDENTE`, `NÃO APLICÁVEL COM JUSTIFICATIVA` ou `PENDENTE`. Não declare o sistema invulnerável.

## Referências técnicas

- [OWASP WSTG](https://owasp.org/projects/web-security-testing-guide)
- [OWASP HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
- [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Vercel - configuração do projeto](https://vercel.com/docs/project-configuration)

Essas referências orientam os controles. As conclusões sobre os sistemas decorrem das respostas coletadas e do código identificado no relatório; elas não representam certificação de segurança.
