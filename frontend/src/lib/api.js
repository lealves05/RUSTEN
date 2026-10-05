// Cliente da API: sessão com renovação automática, terminal do dispositivo e erros legíveis.
const BASE = import.meta.env.VITE_API_URL || '';
const K = { access: 'rusten.access', refresh: 'rusten.refresh', terminal: 'rusten.terminal', session: 'rusten.session' };

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* armazenamento indisponível */ } },
};

// F05: o token de renovação fica num cookie HttpOnly (a página não lê) e o token de acesso só em memória.
// No armazenamento do navegador fica apenas a indicação "há sessão" (sem nenhum segredo).
// Tokens guardados pela versão anterior são usados uma única vez para migrar a sessão para o cookie e apagados.
let accessMem = null;
store.set(K.access, null); // versão anterior guardava o token de acesso: descartado
export const tokens = {
  get access() { return accessMem; },
  get hasSession() { return !!accessMem || store.get(K.session) === '1' || !!store.get(K.refresh); },
  save(t) {
    accessMem = t?.access_token || null;
    store.set(K.session, accessMem ? '1' : null);
    store.set(K.refresh, null); store.set(K.access, null);
  },
  clear() { accessMem = null; store.set(K.session, null); store.set(K.refresh, null); store.set(K.access, null); },
};
const SESSION_HEADERS = { 'x-session-mode': 'cookie' };
export const terminal = {
  get id() { return Number(store.get(K.terminal)) || null; },
  set(id) { store.set(K.terminal, id ? String(id) : null); },
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Erro ${status}`);
    this.status = status; this.code = body?.code; this.body = body;
  }
}

let refreshing = null;
// Renovação única entre abas (ex.: Cozinha e Painel da TV no mesmo navegador): o servidor troca o token a cada
// renovação e trata o reuso do antigo como roubo, então as abas renovam uma de cada vez (o cookie é compartilhado).
export async function refresh() {
  if (!tokens.hasSession) return false;
  const run = async () => {
    const legacy = store.get(K.refresh); // migração da versão anterior (uma vez)
    return fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...SESSION_HEADERS },
      body: JSON.stringify(legacy ? { refresh_token: legacy } : {}),
    }).then(async (r) => {
      store.set(K.refresh, null);
      if (!r.ok) { if (r.status === 401 || r.status === 403) tokens.clear(); return false; }
      tokens.save(await r.json()); return true;
    }).catch(() => false);
  };
  refreshing ||= (navigator.locks?.request ? navigator.locks.request('rusten-refresh', run) : run())
    .finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  return refreshing;
}

const listeners = new Set();
export const onAuthLost = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onBlocked = (fn) => { blockedListeners.add(fn); return () => blockedListeners.delete(fn); };
const blockedListeners = new Set();

export async function api(path, { method = 'GET', body, retry = true, signal } = {}) {
  if (!tokens.access && tokens.hasSession && retry && !/^\/api\/auth\/(refresh|login|register|demo|forgot|reset|plans|reset-options)\b/.test(path)) await refresh(); // aba nova: renova pelo cookie
  const headers = { 'content-type': 'application/json', ...SESSION_HEADERS };
  if (tokens.access) headers.authorization = `Bearer ${tokens.access}`;
  if (terminal.id) headers['x-terminal-id'] = String(terminal.id);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, credentials: 'same-origin', body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new ApiError(0, { error: 'Sem conexão com o servidor', code: 'network' });
    err.uncertain = method !== 'GET'; // o servidor pode ter recebido: consultar antes de repetir
    throw err;
  }
  if (res.status === 401 && retry && !path.startsWith('/api/auth/')) {
    if (tokens.hasSession && await refresh()) return api(path, { method, body, retry: false, signal });
    listeners.forEach((fn) => fn()); // sessão encerrada (ex.: "Sair" em outra aba): volta para o login
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) {
    if (res.status === 402) blockedListeners.forEach((fn) => fn(data));
    if (res.status >= 500) { const e = new ApiError(res.status, data); e.uncertain = method !== 'GET'; throw e; }
    throw new ApiError(res.status, data);
  }
  return data;
}

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`);

// Download autenticado (CSV etc.)
export async function download(path, filename) {
  if (!tokens.access && tokens.hasSession) await refresh();
  const headers = { ...SESSION_HEADERS };
  if (tokens.access) headers.authorization = `Bearer ${tokens.access}`;
  let res = await fetch(`${BASE}${path}`, { headers });
  if (res.status === 401 && await refresh()) res = await fetch(`${BASE}${path}`, { headers: { ...SESSION_HEADERS, authorization: `Bearer ${tokens.access}` } });
  if (!res.ok) { let b = null; try { b = await res.json(); } catch { /* sem corpo */ } throw new ApiError(res.status, b); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Chamadas públicas (sem sessão): cardápio digital, pedido, avaliação
export async function publicApi(path, { method = 'GET', body } = {}) {
  let res;
  try { res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError(0, { error: 'Sem conexão. Verifique a internet e tente de novo.' }); }
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
