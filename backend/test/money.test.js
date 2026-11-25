import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords, calculatePurchaseTotals, roundMoney } from '../src/utils/money.js';

test('roundMoney rounds to two decimals and neutralizes invalid values', () => {
  assert.equal(roundMoney(8.996), 9);
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney('12.345'), 12.35);
  assert.equal(roundMoney(Number.NaN), 0);
  assert.equal(roundMoney(undefined), 0);
});

test('amountInWords renders whole amounts using the official style', () => {
  assert.equal(amountInWords(0), 'Zero Rwandan Francs');
  assert.equal(amountInWords(8996000), 'Eight Million and Nine Hundred Ninety Six Thousand Rwandan Francs');
  assert.equal(amountInWords(1000), 'One Thousand Rwandan Francs');
  assert.equal(amountInWords(1001), 'One Thousand and One Rwandan Francs');
  assert.equal(amountInWords(1234567), 'One Million and Two Hundred Thirty Four Thousand and Five Hundred Sixty Seven Rwandan Francs');
});

test('amountInWords renders fractions and supports a currency override', () => {
  assert.equal(amountInWords(12.25), 'Twelve Rwandan Francs and Twenty Five Cents');
  assert.equal(amountInWords(0.25), 'Zero Rwandan Francs and Twenty Five Cents');
  assert.equal(amountInWords(2, { currency: 'Dollars' }), 'Two Dollars');
});

test('calculatePurchaseTotals derives VAT and words from lines only', () => {
  const lines = [
    { quantity: 2, unitPrice: 1000 },
    { quantity: 3, unitPrice: 1998.67 }
  ];
  const result = calculatePurchaseTotals(lines, 18);
  assert.equal(result.subtotal, 7996.01);
  assert.equal(result.vatRate, 18);
  assert.equal(result.vatAmount, 1439.28);
  assert.equal(result.total, 9435.29);
  assert.equal(result.amountInWords, amountInWords(9435.29));
});

test('calculatePurchaseTotals defaults to a zero VAT rate', () => {
  assert.deepEqual(calculatePurchaseTotals([{ quantity: 2, unitPrice: 25 }], undefined), {
    subtotal: 50,
    vatRate: 0,
    vatAmount: 0,
    total: 50,
    amountInWords: 'Fifty Rwandan Francs'
  });
});
