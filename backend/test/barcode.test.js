import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCode, nfeKeyDigit, purchaseCode, isNfeKey } from '../src/lib/barcode.js';

const base = '3526091122233300014455001000000101100000001'; // 43 dígitos (SP, 09/2026, mod. 55)
const key = base + nfeKeyDigit(base);

test('chave da NF-e: dígito verificador e dados da chave', () => {
  assert.equal(isNfeKey(key), true);
  const c = classifyCode(key.replace(/(\d{4})/g, '$1 '));
  assert.equal(c.kind, 'nfe');
  assert.equal(c.key, key);
  assert.deepEqual([c.info.uf, c.info.issued, c.info.cnpj, c.info.model, c.info.number], ['SP', '2026-09', '11222333000144', '55', 101]);
  const wrong = key.slice(0, 43) + ((Number(key[43]) + 1) % 10);
  assert.equal(classifyCode(wrong).kind, 'invalido');
});

test('pedido de compra: código com dígito verificador', () => {
  const code = purchaseCode(1234);
  assert.match(code, /^PC00001234\d$/);
  assert.deepEqual(classifyCode(code.toLowerCase()), { kind: 'pedido', purchase_id: 1234 });
  const bad = code.slice(0, 10) + ((Number(code[10]) + 1) % 10);
  assert.equal(classifyCode(bad).kind, 'invalido');
});

test('código qualquer não é aceito', () => {
  assert.equal(classifyCode('7891234567895').kind, 'invalido');
  assert.equal(classifyCode('').kind, 'invalido');
});
