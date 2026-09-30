// Leitura de configuração: variáveis de ambiente, com padrões definidos pela entrada (ex.: Supabase Edge,
// onde o ambiente é somente leitura). Nunca escreva em process.env.
const defaults = globalThis.__RUSTEN_ENV_DEFAULTS__ || {};
export const env = new Proxy({}, {
  get: (_t, key) => {
    const v = typeof process !== 'undefined' ? process.env[key] : undefined;
    return v !== undefined && v !== '' ? v : defaults[key];
  },
});
