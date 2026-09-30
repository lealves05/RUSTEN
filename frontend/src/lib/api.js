// Cliente da API: sessão com renovação automática, terminal do dispositivo e erros legíveis.
const BASE = import.meta.env.VITE_API_URL || '';
const K = { access: 'rusten.access', refresh: 'rusten.refresh', terminal: 'rusten.terminal' };

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* armazenamento indisponível */ } },
};

export const tokens = {
  get access() { return store.get(K.access); },
  get refresh() { return store.get(K.refresh); },
  save(t) { store.set(K.access, t.access_token); store.set(K.refresh, t.refresh_token); },
  clear() { store.set(K.access, null); store.set(K.refresh, null); },
};
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
async function refresh() {
  if (!tokens.refresh) return false;
  refreshing ||= fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: tokens.refresh }),
  }).then(async (r) => { if (!r.ok) { tokens.clear(); return false; } tokens.save(await r.json()); return true; })
    .catch(() => false).finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  return refreshing;
}

const listeners = new Set();
export const onAuthLost = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onBlocked = (fn) => { blockedListeners.add(fn); return () => blockedListeners.delete(fn); };
const blockedListeners = new Set();

export async function api(path, { method = 'GET', body, retry = true, signal } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (tokens.access) headers.authorization = `Bearer ${tokens.access}`;
  if (terminal.id) headers['x-terminal-id'] = String(terminal.id);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new ApiError(0, { error: 'Sem conexão com o servidor', code: 'network' });
    err.uncertain = method !== 'GET'; // o servidor pode ter recebido: consultar antes de repetir
    throw err;
  }
  if (res.status === 401 && retry && tokens.refresh && !path.startsWith('/api/auth/')) {
    if (await refresh()) return api(path, { method, body, retry: false, signal });
    listeners.forEach((fn) => fn());
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
