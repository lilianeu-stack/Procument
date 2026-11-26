import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { availableExports, canExport, renderCsv, renderPdf, renderXlsx } from '../src/services/exports.js';

const service = readFileSync(new URL('../src/services/exports.js', import.meta.url), 'utf8');

test('report definitions exclude credentials, tokens, file payloads and raw audit details', () => {
  for (const sensitive of [
    'password_hash', 'token_hash', 'file_data', 'refresh_token',
    'oauth_client_secret', 'a.details'
  ]) {
    assert.equal(service.includes(sensitive), false, `${sensitive} must never be exported`);
  }
  assert.match(service, /a\.entity_type AS 'Record type'/);
  assert.doesNotMatch(service, /SELECT a\.details/);
});

test('export permissions match the pages each role can actually open', () => {
  assert.equal(canExport(null, 'requisitions'), false);
  assert.equal(canExport({ role: 'admin' }, 'users'), true);
  assert.equal(canExport({ role: 'approver' }, 'requisitions'), true);
  assert.equal(canExport({ role: 'procurement' }, 'invoices'), true);
  assert.equal(canExport({ role: 'procurement' }, 'storeRequests'), true);
  assert.equal(canExport({ role: 'procurement' }, 'inventoryMovements'), true);
  assert.equal(canExport({ role: 'procurement' }, 'committeeMembers'), true);
  assert.equal(canExport({ role: 'finance' }, 'invoices'), true);
  assert.equal(canExport({ role: 'storekeeper' }, 'inventory'), true);
  assert.equal(canExport({ role: 'supervisor' }, 'supervisorStock'), true);
  assert.equal(canExport({ role: 'requestor' }, 'portalRequisitions'), true);

  assert.equal(canExport({ role: 'approver' }, 'users'), false);
  assert.equal(canExport({ role: 'procurement' }, 'users'), false);
  assert.equal(canExport({ role: 'storekeeper' }, 'supervisorStock'), false);
  assert.equal(canExport({ role: 'requestor' }, 'requisitions'), false);
  assert.equal(canExport({ role: 'supervisor' }, 'auditLogs'), false);

  const roles = Object.fromEntries(availableExports().map((entry) => [entry.key, entry.role]));
  assert.deepEqual([...roles.requisitions].sort(), ['admin', 'approver']);
  assert.deepEqual([...roles.invoices].sort(), ['finance', 'procurement']);
  assert.deepEqual([...roles.storeRequests].sort(), ['procurement', 'storekeeper']);
  assert.deepEqual([...roles.committeeMembers].sort(), ['admin', 'procurement']);
});

test('report downloads render genuine PDF, Excel and BOM/CRLF CSV formats', async () => {
  const report = {
    label: 'QA Register',
    filters: 'None',
    rows: [{ Reference: 'QA-1', Description: 'Format check', Amount: 12.5 }]
  };

  const csv = renderCsv(report);
  assert.equal(csv[0], 0xef);
  assert.equal(csv[1], 0xbb);
  assert.equal(csv[2], 0xbf);
  assert.match(csv.toString('utf8'), /\r\n/);
  assert.match(csv.toString('utf8'), /"Reference","Description","Amount"/);

  const xlsx = await renderXlsx(report, 'QA');
  assert.equal(xlsx.subarray(0, 2).toString(), 'PK');

  const pdf = await renderPdf(report, 'QA');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
