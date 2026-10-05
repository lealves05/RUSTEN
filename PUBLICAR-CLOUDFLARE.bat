@echo off
chcp 65001 >nul
title RUSTEN - publicar na Cloudflare (lorler.com.br)
setlocal EnableExtensions
cd /d "%~dp0"
rem ============================================================================
rem  Publica a branch "cloudflare" do RUSTEN:
rem    - envia a branch ao GitHub (a branch main NAO e alterada)
rem    - site + /api -> Worker "rusten-web" (rusten.lorler.com.br); a API continua na Edge Function "rusten-api"
rem    - chave do repasse do IP real (EDGE_PROXY_KEY) no site e na Supabase
rem  Logins pedidos no navegador (so na primeira vez): GitHub, Supabase, Cloudflare.
rem ============================================================================
set "REF=dwfbxrfniarhufltmlhb"
set "WT=%~dp0..\_cloudflare\RUSTEN"
set "KEYS=%USERPROFILE%\.plataforma-cloudflare"
set "LOG=%~dp0publicar-cloudflare.log"
if exist "%~dp0..\node-v24.20.0-win-x64\node.exe" set "PATH=%~dp0..\node-v24.20.0-win-x64;%PATH%"
echo [%date% %time%] inicio > "%LOG%"
where git >nul 2>nul || (echo Git nao encontrado. Instale em https://git-scm.com/download/win & pause & exit /b 1)
where node >nul 2>nul || (echo Node nao encontrado. & pause & exit /b 1)
git rev-parse --verify cloudflare >nul 2>nul || (echo A branch "cloudflare" nao existe neste repositorio. & pause & exit /b 1)
if not exist "%KEYS%" mkdir "%KEYS%"

echo.
echo  [1/5] Enviando a branch cloudflare ao GitHub (main fica como esta)...
if exist ".git\index.lock" del /f /q ".git\index.lock"
git remote get-url origin >nul 2>nul || git remote add origin https://github.com/lealves05/RUSTEN.git
git push -u origin cloudflare >> "%LOG%" 2>&1
if errorlevel 1 (echo   Aviso: nao foi possivel enviar ao GitHub agora. Seguindo com a publicacao. Veja %LOG%) else (echo   OK)

echo  [2/5] Preparando a copia de trabalho da branch cloudflare...
rem copia sem prender a branch (assim a branch cloudflare pode receber atualizacoes); sempre na versao mais nova
rem (arquivos gerados no build anterior vao para um stash da copia de trabalho)
if not exist "%WT%\.git" (
  git worktree add --detach "%WT%" cloudflare >> "%LOG%" 2>&1 || (echo   Falhou. Veja %LOG% & pause & exit /b 1)
) else (
  git -C "%WT%" stash push -q --include-untracked >> "%LOG%" 2>&1
  git -C "%WT%" checkout -q --detach cloudflare >> "%LOG%" 2>&1 || (echo   Falhou ao atualizar a copia. Veja %LOG% & pause & exit /b 1)
)
echo   %WT%

echo  [3/5] Gerando o site...
pushd "%WT%\frontend"
call npm ci --no-audit --no-fund >> "%LOG%" 2>&1 || (echo   npm ci falhou. Veja %LOG% & popd & pause & exit /b 1)
call npm run build:cloudflare >> "%LOG%" 2>&1 || (echo   build falhou. Veja %LOG% & popd & pause & exit /b 1)
popd
echo   OK
echo  Carregadora da API (busca o pacote no site novo, com o antigo como reserva)...
rem a carregadora da Edge Function rusten-api ja e publicada pelo administrador; o pacote vai junto com o site (/edge/rusten-api.js)

echo  [4/5] API "rusten-api-cf" (pacote embutido) e chave do repasse do IP...
pushd "%WT%\backend"
call npm ci --no-audit --no-fund >> "%LOG%" 2>&1 || (echo   npm ci da API falhou. Veja %LOG% & popd & pause & exit /b 1)
call npm run build:edge >> "%LOG%" 2>&1 || (echo   build da API falhou. Veja %LOG% & popd & pause & exit /b 1)
popd
if not exist "%KEYS%\edge-dwfb.key" node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "%KEYS%\edge-dwfb.key"
call npx --yes supabase@2 projects list >nul 2>&1 || (
  echo   Entre na Supabase no navegador que vai abrir...
  call npx --yes supabase@2 login
)
for /f "usebackq delims=" %%K in ("%KEYS%\edge-dwfb.key") do set "EK=%%K"
call npx --yes supabase@2 secrets set EDGE_PROXY_KEY=%EK% --project-ref %REF% >> "%LOG%" 2>&1 || echo   Aviso: chave nao gravada na Supabase (os limites de tentativa usam o IP da Cloudflare ate isso ser feito).
set "EK="
pushd "%WT%\backend"
call npx --yes supabase@2 functions deploy rusten-api-cf --project-ref %REF% --no-verify-jwt --use-api >> "%LOG%" 2>&1
if errorlevel 1 (echo   Falhou a publicacao da API. Veja %LOG% & popd & pause & exit /b 1)
popd
echo   API OK

echo  [5/5] Publicando o site na Cloudflare...
pushd "%WT%\frontend"
call npx wrangler whoami >nul 2>&1 || (
  echo   Entre na Cloudflare no navegador que vai abrir...
  call npx wrangler login
)
call npx wrangler deploy -c ..\cloudflare\wrangler.jsonc --domain rusten.lorler.com.br >> "%LOG%" 2>&1
if errorlevel 1 (
  echo   rusten.lorler.com.br ainda nao disponivel - publicando no endereco workers.dev
  call npx wrangler deploy -c ..\cloudflare\wrangler.jsonc >> "%LOG%" 2>&1 || (echo   Falhou. Veja %LOG% & popd & pause & exit /b 1)
) else (echo   rusten.lorler.com.br OK)
type "%KEYS%\edge-dwfb.key" | npx wrangler secret put EDGE_PROXY_KEY -c ..\cloudflare\wrangler.jsonc >> "%LOG%" 2>&1
popd

node -e "fetch('https://rusten.lorler.com.br/api/health').then(r=>console.log('   https://rusten.lorler.com.br/api/health -> '+r.status)).catch(()=>console.log('   rusten.lorler.com.br: sem resposta ainda (DNS/certificado)'))"
echo   Enderecos workers.dev publicados:
findstr /i /c:"workers.dev" "%LOG%"
echo.
echo  Pronto. Teste em https://rusten.lorler.com.br/entrar (ou no endereco *.workers.dev acima).
echo  Detalhes: %LOG%
echo [%date% %time%] fim >> "%LOG%"
pause
exit /b 0
