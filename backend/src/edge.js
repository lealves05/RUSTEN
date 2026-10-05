// Entrada da API na Supabase Edge Function "rusten-api".
import './edge-env.js';
import express from 'express';
import { createApp } from './server.js';
import { env } from './lib/env.js';
import { migrate } from './migrate.js';

// migrações pendentes são aplicadas no primeiro acesso de cada instância (com trava no banco)
let ready = null;
const app = express();
app.use(async (_req, res, next) => {
  try {
    ready ??= migrate({ log: (m) => console.log(`[migrate] ${m}`) }).catch((e) => { ready = null; throw e; });
    await ready;
    next();
  } catch (e) {
    console.error('[boot]', e.message);
    res.status(503).json({ error: 'Serviço iniciando. Tente novamente em instantes.' });
  }
});
// rusten-api (site anterior) ou rusten-api-cf (site na Cloudflare, pacote embutido)
app.use([`${env.PATH_PREFIX}-cf`, env.PATH_PREFIX], createApp());
app.listen(8000);
