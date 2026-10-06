// Sessão do usuário: dados de /me, permissões, tema e bloqueio da assinatura.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokens, onAuthLost, onBlocked } from './api.js';
import { applyBrand } from './brand.js';

const Ctx = createContext(null);

export function applyTheme(theme) {
  const t = theme || 'auto';
  try { localStorage.setItem('rusten.theme', t); } catch { /* sem armazenamento */ }
  const dark = t === 'escuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  applyBrand(); // a cor de destaque é ajustada para o tema (contraste)
}

export function SessionProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(tokens.hasSession);
  const [blocked, setBlocked] = useState(null);

  const load = useCallback(async () => {
    if (!tokens.access && !tokens.hasSession) { setMe(null); setLoading(false); return null; }
    try {
      const data = await api('/api/auth/me');
      setMe(data);
      setBlocked(data.access?.allowed === false ? data.access : null);
      const ap = data.company?.settings?.appearance || {};
      applyBrand(ap);
      applyTheme(localStorage.getItem('rusten.theme.user') || ap.theme);
      return data;
    } catch {
      setMe(null);
      return null;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onAuthLost(() => { tokens.clear(); setMe(null); }), []);
  useEffect(() => onBlocked((b) => setBlocked((cur) => cur || { allowed: false, reason: b?.error, state: b?.state })), []);

  const logout = useCallback(async (all = false) => {
    try { await api('/api/auth/logout', { method: 'POST', body: { all } }); } catch { /* sessão já inválida */ }
    tokens.clear(); setMe(null);
  }, []);

  const value = useMemo(() => ({
    me, loading, blocked, reload: load, logout, setBlocked,
    can: (p) => !!me?.permissions?.includes(p),
    hasModule: (m) => !me?.access || me.access.modules?.includes(m),
    tz: me?.company?.timezone || 'America/Sao_Paulo',
  }), [me, loading, blocked, load, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
