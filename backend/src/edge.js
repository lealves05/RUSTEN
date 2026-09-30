// Entrada da API na Supabase Edge Function "rusten-api".
import './edge-env.js';
import express from 'express';
import { createApp } from './server.js';
import { env } from './lib/env.js';

const app = express();
app.use(env.PATH_PREFIX, createApp());
app.listen(8000);
