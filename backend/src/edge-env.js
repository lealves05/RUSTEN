// Padrões da Supabase Edge Function (o ambiente de lá é somente leitura). Executado antes dos demais módulos.
globalThis.__RUSTEN_ENV_DEFAULTS__ = {
  EDGE_RUNTIME: '1',
  NODE_ENV: 'production',
  DB_SCHEMA: 'rusten',          // tabelas do RUSTEN ficam no esquema próprio
  DB_POOL_MAX: '3',
  PATH_PREFIX: '/rusten-api',   // a Supabase entrega o caminho com o nome da função
  CORS_ORIGINS: '*',            // token no cabeçalho, sem cookies
};
