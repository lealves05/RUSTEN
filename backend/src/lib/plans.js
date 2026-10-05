// Contrato dos planos entre a central (valores em reais: monthly_price/annual_price) e as telas do RUSTEN.
// A conversão para centavos é feita só aqui, uma vez (R01). Preço ausente, zero ou inválido = ciclo indisponível,
// nunca "grátis". O valor cobrado continua sendo calculado pela central na contratação; estes números são só exibição.

/** Reais (número ou texto da central) → centavos inteiros, ou null quando não há preço válido. */
export function toCents(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null;
  return Math.round(n * 100);
}

/**
 * Economia do anual em relação a 12 mensalidades (R02: a mesma conta em todas as telas).
 * Só existe quando os dois preços existem e o anual é realmente menor; arredondada para baixo (nunca promete a mais).
 */
export function annualSavings(monthlyCents, yearlyCents) {
  if (!monthlyCents || !yearlyCents) return null;
  const full = monthlyCents * 12;
  if (yearlyCents >= full) return null;
  return { cents: full - yearlyCents, pct: Math.floor(((full - yearlyCents) / full) * 100) };
}

/** Plano normalizado: centavos, economia anual e os campos antigos (compatibilidade com quem ainda os lê). */
export function normalizePlan(p) {
  if (!p || typeof p !== 'object') return null;
  const monthly = toCents(p.monthly_price ?? (p.monthly_cents != null ? p.monthly_cents / 100 : null));
  const yearly = toCents(p.annual_price ?? (p.yearly_cents != null ? p.yearly_cents / 100 : null));
  const savings = annualSavings(monthly, yearly);
  return {
    id: p.id ?? null, code: p.code ?? null, name: String(p.name ?? ''), description: p.description ?? null,
    features: p.features ?? null, max_users: p.max_users ?? null,
    monthly_cents: monthly, yearly_cents: yearly,
    annual_savings_cents: savings?.cents ?? null, annual_savings_pct: savings?.pct ?? null,
    // legado (reais): mantidos enquanto houver consumidores; null quando o ciclo não tem preço
    monthly_price: monthly == null ? null : monthly / 100, annual_price: yearly == null ? null : yearly / 100,
  };
}

/** Lista para contratação: só planos com ao menos um ciclo com preço. */
export const normalizePlans = (list) => (Array.isArray(list) ? list.map(normalizePlan).filter((p) => p && (p.monthly_cents || p.yearly_cents)) : []);

/**
 * Regra de teste da central → informação para a tela. Valores desconhecidos não viram teste ilimitado.
 * @param {string|null|undefined} t  NONE | 15_DAYS | 30_DAYS | UNLIMITED
 */
export function trialInfo(t) {
  if (t === '15_DAYS') return { trial: true, trial_days: 15, trial_label: 'Período de teste de 15 dias' };
  if (t === '30_DAYS') return { trial: true, trial_days: 30, trial_label: 'Período de teste de 30 dias' };
  if (t === 'UNLIMITED') return { trial: true, trial_days: null, trial_label: 'Período de teste com prazo definido pela administração' };
  return { trial: false, trial_days: null, trial_label: null };
}
