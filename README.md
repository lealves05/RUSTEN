# RUSTEN — Gestão para bares e restaurantes

Plataforma SaaS de PDV e gestão para bares, restaurantes, lanchonetes, cafeterias e pubs. Produto irmão do ORBI e do TORVEN,
com o mesmo arranjo de publicação: **GitHub → API no Render → site na Vercel → banco no Supabase**, e cobrança/assinatura
administradas pela **central (MASTER do ORBI)**.

```
RUSTEN/
├── backend/              API Node 20+ · Express 5 · pg · zod
│   ├── src/migrations/   SQL versionado (aplicado no boot) + rollback/
│   ├── src/routes/       auth, admin, menu, floor, pdv, cash, home, platform
│   ├── src/lib/          core (dinheiro, dia comercial), auth (sessão, permissões, acesso), pdv (motor de leitura), platform (central)
│   └── scripts/smoke.mjs teste ponta a ponta dos critérios de aceite
├── frontend/             React 18 · Vite · Tailwind (tema claro/escuro, PDV touch/teclado/leitor)
├── render.yaml           blueprint da API
└── docs/                 relatório da fase, manual do operador e decisões técnicas
```

## Rodar localmente

```bash
# API
cd backend && cp .env.example .env      # ajuste DATABASE_URL e JWT_SECRET
npm install && npm run dev              # aplica as migrações e sobe na porta 3001

# Site
cd frontend && npm install && npm run dev   # http://localhost:5173 (proxy /api → 3001)
```

Testes: `DATABASE_URL=postgres://…/rusten_test npm run smoke` (em `backend/`; **apaga** o banco informado — o nome precisa conter `test`).

## No ar hoje

- **API**: Supabase Edge Function `rusten-api` no projeto TORVEN (`dwfbxrfniarhufltmlhb`), tabelas no esquema **`rusten`**
  (isolado; nada do TORVEN é tocado). Endereço: `https://dwfbxrfniarhufltmlhb.supabase.co/functions/v1/rusten-api`
  (saúde: `/api/health`). O plano gratuito do Supabase só permite 2 projetos (ORBI e TORVEN), por isso o esquema separado.
- Reimplantar: a função usa `backend/deno.json` (import map `npm:`) e entrada `src/edge.js`; ou gere um arquivo único com
  `node scripts/build-edge.mjs` (sai em `backend/edge/index.js`). Variáveis: `SUPABASE_DB_URL` e `SUPABASE_SERVICE_ROLE_KEY`
  já existem no Supabase; `JWT_SECRET` é opcional (se ausente, a chave é derivada do segredo de serviço).
- Migrações novas: aplicar no esquema `rusten` (`set local search_path to rusten`) — no Edge não há leitura de arquivos no boot.
- **Site**: https://rusten.vercel.app (projeto `rusten` na equipe Vercel l2-r2). `frontend/.env.production` aponta para a API.
  Republicar: duplo clique em `D:\Programacao\PUBLICAR-RUSTEN.bat` (usa o Node portátil de `D:\Programacao`, porque o npm
  global do Windows está corrompido; registro em `RUSTEN\publicar-rusten.log`).

## Publicar (mesmo procedimento do ORBI)

1. **GitHub**: crie o repositório `RUSTEN` e faça `git push` (o CI roda smoke, lint e build).
2. **Supabase**: crie um projeto novo e separado; copie a connection string (pooler, modo *session*).
3. **Render**: *New › Blueprint* apontando para o repositório (usa `render.yaml`). Preencha `DATABASE_URL`, `CORS_ORIGINS`
   (endereço da Vercel) e, quando for ligar a central, `PLATFORM_HUB_URL` e `PLATFORM_SECRET`. As migrações rodam no boot.
4. **Vercel**: importe o repositório com *Root Directory* `frontend`, framework Vite, variável `VITE_API_URL` = endereço da API no Render.
5. **Central (ORBI › Master › Sistemas › Adicionar sistema)**: código `rusten`, API = endereço do Render, site = endereço da Vercel,
   página de assinatura `/configuracoes/assinatura`. Copie o segredo para `PLATFORM_SECRET` no Render, teste a conexão e sincronize.

Sem `PLATFORM_SECRET`/`PLATFORM_HUB_URL` o RUSTEN funciona normalmente, sem cobrança nem bloqueio (estado "sem central").

## Reversão

`backend/src/migrations/rollback/001_base_pdv.down.sql` desfaz a migração 001 (**apaga os dados do RUSTEN** — faça `pg_dump` antes).
Testado em clone: reverte, remove o registro e reaplica no próximo boot.
