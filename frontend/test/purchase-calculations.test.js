import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountInWords, calculatePurchaseTotals, calculateSupplierTotals,
  canEditPurchaseOrder, formatRwf, roundMoney
} from '../src/utils/purchaseCalculations.js';

test('money is rounded to two decimals like the backend', () => {
  assert.equal(roundMoney(12.345), 12.35);
  assert.equal(roundMoney(12.344), 12.34);
  assert.equal(roundMoney('9.5'), 9.5);
  assert.equal(roundMoney(undefined), 0);
});

test('amounts are written in English Rwandan Francs words', () => {
  assert.equal(amountInWords(8996000), 'Eight Million and Nine Hundred Ninety Six Thousand Rwandan Francs');
  assert.equal(amountInWords(0), 'Zero Rwandan Francs');
  assert.equal(amountInWords(25.25), 'Twenty Five and Twenty Five Cents Rwandan Francs');
  assert.equal(amountInWords(1234, { currency: 'Dollars' }), 'One Thousand and Two Hundred Thirty Four Dollars');
});

test('purchase totals match the backend line/VAT calculation', () => {
  const totals = calculatePurchaseTotals([
    { quantity: 2, unitPrice: 100.25 },
    { quantity: 1, unitPrice: 50.1 }
  ], 18);
  assert.deepEqual(totals, {
    subtotal: 250.6,
    vatRate: 18,
    vatAmount: 45.11,
    total: 295.71,
    amountInWords: 'Two Hundred Ninety Five and Seventy One Cents Rwandan Francs'
  });
});

test('zero VAT and empty lines produce zero totals', () => {
  assert.deepEqual(calculatePurchaseTotals([], 0), {
    subtotal: 0,
    vatRate: 0,
    vatAmount: 0,
    total: 0,
    amountInWords: 'Zero Rwandan Francs'
  });
});

test('supplier quotation line totals use the supplier unit price and quantity', () => {
  const totals = calculateSupplierTotals([
    { purchaseOrderItemId: 1, quantity: 2, unitPrice: 150.25 },
    { purchaseOrderItemId: 2, quantity: 3, unitPrice: 0 }
  ], 0);
  assert.equal(totals.lines[0].lineTotal, 300.5);
  assert.equal(totals.lines[1].lineTotal, 0);
  assert.equal(totals.subtotal, 300.5);
  assert.equal(totals.vatRate, 0);
  assert.equal(totals.vatAmount, 0);
  assert.equal(totals.otherCharges, 0);
  assert.equal(totals.total, 300.5);
});

test('supplier totals add VAT and optional other charges to the subtotal', () => {
  const totals = calculateSupplierTotals([
    { quantity: 2, unitPrice: 100.25 },
    { quantity: 1, unitPrice: 50.1 }
  ], 18, 10);
  assert.equal(totals.subtotal, 250.6);
  assert.equal(totals.vatAmount, 45.11);
  assert.equal(totals.otherCharges, 10);
  assert.equal(totals.total, 305.71);
});

test('empty supplier quotations and invalid rates stay finite', () => {
  const totals = calculateSupplierTotals([], Number.NaN, 'not-a-number');
  assert.equal(totals.subtotal, 0);
  assert.equal(totals.vatRate, 0);
  assert.equal(totals.vatAmount, 0);
  assert.equal(totals.otherCharges, 0);
  assert.equal(totals.total, 0);
});

test('purchase order editing is restricted to pending orders and procurement roles', () => {
  assert.equal(canEditPurchaseOrder({ status: 'Pending approval' }, { role: 'procurement' }), true);
  assert.equal(canEditPurchaseOrder({ status: 'Pending approval' }, { role: 'admin' }), true);
  assert.equal(canEditPurchaseOrder({ status: 'Pending approval' }, { role: 'approver' }), false);
  assert.equal(canEditPurchaseOrder({ status: 'Approved' }, { role: 'admin' }), false);
  assert.equal(canEditPurchaseOrder(null, null), false);
});

test('official purchase amounts always show RWF', () => {
  assert.equal(formatRwf(8996000), '8,996,000.00 RWF');
});
