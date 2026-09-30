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
