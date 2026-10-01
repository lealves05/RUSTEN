// RUSTEN API — gestão para bares e restaurantes.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './lib/core.js';
import { auth, requireAccess } from './lib/auth.js';
import { migrate } from './migrate.js';
import { router as authRouter } from './routes/auth.js';
import { router as adminRouter } from './routes/admin.js';
import { router as menuRouter } from './routes/menu.js';
import { router as floorRouter } from './routes/floor.js';
import { router as pdvRouter } from './routes/pdv.js';
import { router as cashRouter } from './routes/cash.js';
import { router as homeRouter } from './routes/home.js';
import { router as customersRouter } from './routes/customers.js';
import { router as kitchenRouter } from './routes/kitchen.js';
import { router as stockRouter } from './routes/stock.js';
import { router as reportsRouter } from './routes/reports.js';
import { router as deliveryRouter } from './routes/delivery.js';
import { router as marketingRouter } from './routes/marketing.js';
import { router as agentRouter } from './routes/agent.js';
import { router as reservationsRouter } from './routes/reservations.js';
import { router as publicRouter } from './routes/public.js';
import { platformRouter, cronRouter, accessRouter } from './routes/platform.js';
import { flushOutbox } from './lib/platform.js';
import { env } from './lib/env.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  // Autenticação por token no cabeçalho (sem cookies). CORS_ORIGINS='*' libera qualquer origem HTTPS.
  const origins = (env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = (o) => !o || origins.includes(o) || (origins.includes('*') && /^https:\/\//.test(o));
  app.use(cors({ origin: (o, cb) => cb(null, allowed(o)), credentials: false,
    allowedHeaders: ['content-type', 'authorization', 'x-terminal-id'] }));
  // Corpo cru preservado para conferir assinaturas da central
  // foto da nota fiscal (até ~6 MB em base64) só nesta rota
  app.use('/api/stock/notes/read', express.json({ limit: '9mb' }));
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'rusten-api' }));
  app.use('/api/auth', authRouter);
  app.use('/api/platform/v1', platformRouter);
  app.use('/api/cron', cronRouter);
  app.use('/api/access', accessRouter); // funciona com acesso bloqueado (regularização)
  app.use('/api/public', publicRouter); // cardápio digital, pedidos online, avaliação e webhook do WhatsApp

  const gated = [auth(), requireAccess()];
  app.use('/api/admin', ...gated, adminRouter);
  app.use('/api/home', ...gated, homeRouter);
  app.use('/api/menu', ...gated, requireAccess('cardapio'), menuRouter);
  app.use('/api/floor', ...gated, floorRouter);
  app.use('/api/pdv', ...gated, requireAccess('pdv'), pdvRouter);
  app.use('/api/cash', ...gated, requireAccess('pdv'), cashRouter);
  app.use('/api/customers', ...gated, requireAccess('clientes'), customersRouter);
  app.use('/api/kitchen', ...gated, requireAccess('cozinha'), kitchenRouter);
  app.use('/api/stock', ...gated, requireAccess('estoque'), stockRouter);
  app.use('/api/reports', ...gated, requireAccess('relatorios'), reportsRouter);
  app.use('/api/delivery', ...gated, requireAccess('delivery'), deliveryRouter);
  app.use('/api/marketing', ...gated, requireAccess('marketing'), marketingRouter);
  app.use('/api/agent', ...gated, requireAccess('agente'), agentRouter);
  app.use('/api/reservations', ...gated, requireAccess('salao'), reservationsRouter);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada', 'not_found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido', code: 'invalid' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Requisição muito grande', code: 'too_large' });
    if (err?.code === '22P02' || err?.code === '22003') return res.status(400).json({ error: 'Valor inválido', code: 'invalid' });
    if (err?.code === '23503') return res.status(400).json({ error: 'Referência inválida', code: 'invalid_reference' });
    console.error(JSON.stringify({ level: 'error', msg: err?.message, path: req.path, method: req.method, code: err?.code }));
    res.status(500).json({ error: 'Erro interno. Tente novamente.', code: 'internal' });
  });
  return app;
}

const isMain = !env.EDGE_RUNTIME && process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(env.PORT || 3001);
  await migrate();
  createApp().listen(port, () => console.log(`RUSTEN API na porta ${port}`));
  setInterval(() => flushOutbox().catch(() => {}), 60_000).unref();
}
