// R01/R02: contrato de preços dos planos (central em reais → telas em centavos) e economia do anual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCents, normalizePlan, normalizePlans, annualSavings, trialInfo } from '../src/lib/plans.js';

test('reais da central viram centavos uma única vez', () => {
  assert.equal(toCents(79.9), 7990);
  assert.equal(toCents('119.90'), 11990);
  assert.equal(toCents('1295,00'), 129500);
  assert.equal(toCents(768), 76800);
});

test('preço ausente, zero ou inválido = indisponível (nunca grátis)', () => {
  for (const v of [null, undefined, '', 0, '0', -5, 'abc', NaN]) assert.equal(toCents(v), null, String(v));
  const p = normalizePlan({ id: 'x', name: 'Só mensal', monthly_price: 50, annual_price: null });
  assert.equal(p.yearly_cents, null);
  assert.equal(p.annual_price, null);
  assert.deepEqual(normalizePlans([{ name: 'Vazio', monthly_price: 0, annual_price: null }]), []);
});

test('catálogo do RUSTEN: valores e economia do anual iguais em todas as telas', () => {
  const [basico, pro] = normalizePlans([
    { id: 'a', code: 'basico', name: 'Básico', monthly_price: '79.90', annual_price: '768.00' },
    { id: 'b', code: 'profissional', name: 'Profissional', monthly_price: '119.90', annual_price: '1295.00' },
  ]);
  assert.equal(basico.monthly_cents, 7990); assert.equal(basico.yearly_cents, 76800);
  assert.equal(basico.annual_savings_cents, 19080); assert.equal(basico.annual_savings_pct, 19);
  assert.equal(pro.monthly_cents, 11990); assert.equal(pro.yearly_cents, 129500);
  assert.equal(pro.annual_savings_cents, 14380); assert.equal(pro.annual_savings_pct, 9);
  assert.equal(basico.monthly_price, 79.9);
});

test('anual igual ou mais caro que 12 mensalidades não anuncia economia', () => {
  assert.equal(annualSavings(1000, 12000), null);
  assert.equal(annualSavings(1000, 13000), null);
  assert.equal(annualSavings(null, 100), null);
});

test('regra de teste: desconhecido não vira teste ilimitado', () => {
  assert.deepEqual(trialInfo('15_DAYS'), { trial: true, trial_days: 15, trial_label: 'Período de teste de 15 dias' });
  assert.equal(trialInfo('NONE').trial, false);
  assert.equal(trialInfo(undefined).trial, false);
  assert.equal(trialInfo('QUALQUER').trial, false);
  assert.equal(trialInfo('UNLIMITED').trial_days, null);
});
