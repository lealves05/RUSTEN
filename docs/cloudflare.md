# RUSTEN na Cloudflare (branch `cloudflare`)

Documento completo da migração (ORBI, TORVEN, RUSTEN e Master): `ORBI/docs/cloudflare.md`.

- Endereço: **https://rusten.lorler.com.br** (Worker `rusten-web`; enquanto o domínio não estiver ativo, `rusten-web.<conta>.workers.dev`).
- O Worker (`cloudflare/worker.js`) serve o site e encaminha `/api/*` para a Edge Function `rusten-api` da Supabase
  (projeto `dwfbxrfniarhufltmlhb`). A API e o banco não mudam.
- IP real nos limites de tentativa: `backend/src/edgeProxy.js` + segredo `EDGE_PROXY_KEY` (no Worker e na Supabase).
- Central (Master): passa a ser **https://master.lorler.com.br** na virada (`platform_hub_url`; SQL no documento do ORBI).
- Publicar: `PUBLICAR-CLOUDFLARE.bat` (envia a branch ao GitHub sem alterar a `main`, gera o build e publica).
- Build local: `cd frontend && npm run build:cloudflare && npm run deploy:cloudflare`.
- O site é chamado pela mesma origem: `frontend/.env.cloudflare` deixa `VITE_API_URL` vazio (modo `cloudflare`).
- A carregadora da `rusten-api` (versão 8, publicada em 05/10/2026) baixa o pacote de `rusten.lorler.com.br/edge/rusten-api.js`
  e usa `rusten.vercel.app` como reserva enquanto a transição não termina (secret opcional `RUSTEN_BUNDLE_URL`).
