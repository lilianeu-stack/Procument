import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPdf } from '../src/services/exports.js';

test('multi-page PDF reports keep every page available for footers', async () => {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    Reference: `QA-${String(index + 1).padStart(3, '0')}`,
    Description: 'Multi-page report regression check',
    Amount: '1,234.56'
  }));

  const pdf = await renderPdf({
    label: 'QA Multi-page Report',
    rows,
    dateField: 'Created'
  }, 'QA');

  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 5000);
});
