// Regras de módulo por rota (o mesmo arquivo nos quatro sistemas da LORLER).
// Cada módulo lista as rotas da API que ele libera. Uma rota pode ser:
//   '/prefixo'                 → o prefixo e tudo abaixo dele
//   'POST /prefixo'            → só esses métodos (vários: 'POST,PUT,DELETE /prefixo')
//   '/clientes/:id/fidelidade' → ':nome' casa um segmento qualquer
// Vence a regra MAIS ESPECÍFICA (mais segmentos; empate → a que tem método). Assim um recurso dentro de outro
// módulo (ex.: /reports/commissions dentro de /reports) pode ser vendido à parte, e rotas essenciais podem ficar
// sempre liberadas (módulo '' = núcleo do sistema, nunca bloqueado).

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parse(spec, key) {
  const m = /^\s*(?:([A-Z,]+)\s+)?(\/\S*)\s*$/.exec(String(spec));
  if (!m) throw new Error(`rota de módulo inválida: ${spec}`);
  const methods = m[1] ? m[1].split(',').filter(Boolean) : null;
  const path = m[2].replace(/\/+$/, '') || '/';
  const segs = path.split('/').filter(Boolean);
  const re = new RegExp(`^/${segs.map((s) => (s.startsWith(':') ? '[^/]+' : esc(s))).join('/')}(?:/|$)`);
  return { key, methods, re, weight: segs.length * 2 + (methods ? 1 : 0), spec };
}

/**
 * @param {Record<string, { routes: string[] }>} features catálogo de módulos
 * @param {string[]} [core] rotas que nunca são bloqueadas por módulo (núcleo)
 */
export function compileModuleRules(features, core = []) {
  const rules = [];
  for (const [key, f] of Object.entries(features)) for (const r of f.routes || []) rules.push(parse(r, key));
  for (const r of core) rules.push(parse(r, ''));
  return rules.sort((a, b) => b.weight - a.weight);
}

/** Módulo que governa a rota ('' = núcleo; null = nenhum módulo). */
export function moduleForRoute(rules, method, path) {
  const p = String(path || '/').replace(/\/+$/, '') || '/';
  const meth = String(method || 'GET').toUpperCase();
  for (const r of rules) {
    if (r.methods && !r.methods.includes(meth) && !(meth === 'HEAD' && r.methods.includes('GET'))) continue;
    if (r.re.test(p)) return r.key;
  }
  return null;
}
