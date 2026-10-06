// Preferências deste aparelho (localStorage; sem armazenamento, valem os padrões).
const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

// Mostrar o QR de avaliação automaticamente ao encerrar um consumo
export const reviewAuto = { get: () => get('rusten.review.auto', 'on') !== 'off', set: (on) => set('rusten.review.auto', on ? 'on' : 'off') };
export const prefs = { get, set };
