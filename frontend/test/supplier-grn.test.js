import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const source = (path) => readFileSync(resolve(here, path), 'utf8');

test('Goods receipts page lists sent suppliers and opens a scoped Create GRN action', () => {
  const page = source('../src/pages/GoodsReceiptsPage.jsx');
  const form = source('../src/components/ui/SupplierGRNForm.jsx');
  const app = source('../src/App.jsx');
  const pageContent = source('../src/pages/PageContent.jsx');

  assert.match(page, /sentSuppliers = \[\]/);
  assert.match(page, /title="Sent suppliers"/);
  assert.match(page, /onClick=\{\(\) => setSelectedSupplier\(supplier\)\}/);
  assert.match(page, /title=\{selectedSupplier\.supplierName\}/);
  assert.match(page, /onClick=\{\(\) => openSupplierGRN\(order\)\}/);
  assert.match(page, /onClick=\{\(\) => decide\(order, 'Allowed'\)\}/);
  assert.match(page, /onClick=\{\(\) => decide\(order, 'Denied'\)\}/);
  assert.match(page, /order\.grnDecision !== 'Allowed' \|\| !receivableLines\(order\)\.length/);
  assert.match(page, /<SupplierGRNForm/);
  assert.match(page, /onSubmit=\{onCreateSupplierGRN\}/);
  assert.match(pageContent, /onSupplierDecision=\{actions\.onSupplierDecision\}/);

  assert.match(form, /GOOD RECEIVED NOTE/);
  assert.match(form, /Receiving Department/);
  assert.match(form, /Supplied by/);
  assert.match(form, /\['Quantity', 'Unit', 'Description item received', 'Comment'\]/);
  assert.match(form, /Received by:/);
  assert.match(form, /Verified by:/);
  assert.match(form, /import SignatureUpload/);
  assert.match(form, /receivedBySignature: null/);
  assert.match(form, /verifiedBySignature: null/);
  assert.match(form, /<SignatureUpload/);
  assert.match(form, /receivedBySignature: form\.receivedBySignature/);
  assert.match(form, /verifiedBySignature: form\.verifiedBySignature/);
  assert.match(form, /deliveryStatus !== 'Rejected'/);
  assert.match(form, /purchaseOrderItemId: Number\(line\.purchaseOrderItemId\)/);
  assert.match(form, /quantity: Number\(line\.quantity\)/);
  assert.match(form, /comment: line\.comment/);

  assert.match(app, /api\('\/goods-receipts\/sent-suppliers'\)/);
  assert.match(app, /grnSuppliers: grnSuppliers\.sentSuppliers \|\| \[\]/);
  assert.match(app, /onCreateSupplierGRN: \(form\) => mutate\('\/goods-receipts\/from-supplier', form\)/);
  assert.match(app, /mutate\('\/goods-receipts\/supplier-decision', \{ purchaseOrderId, decision, reason \}\)/);
  assert.match(pageContent, /sentSuppliers=\{data\.grnSuppliers\}/);
  assert.match(pageContent, /onCreateSupplierGRN=\{actions\.onCreateSupplierGRN\}/);
});

test('the GRN form requires both uploaded signature photos', () => {
  const form = source('../src/components/ui/SupplierGRNForm.jsx');

  assert.ok(form.includes("if (!form.receivedBySignature) throw new Error('Upload the Received by signature image.');"));
  assert.ok(form.includes("if (!form.verifiedBySignature) throw new Error('Upload the Verified by signature image.');"));
  assert.ok(form.includes('disabled={!receivableLines.length || !form.receivedBySignature || !form.verifiedBySignature}'));
  assert.ok(form.includes('label="Received by signature"'));
  assert.ok(form.includes('label="Verified by signature"'));
});

test('the GRN form reports supplier email delivery instead of silently closing', () => {
  const form = source('../src/components/ui/SupplierGRNForm.jsx');

  assert.match(form, /setResult\(response \|\| \{ message: 'Good Received Note recorded\.' \}\)/);
  assert.match(form, /result\.emailDelivery\?\.ok/);
  assert.match(form, /Emailed to \$\{result\.emailRecipient/);
  assert.match(form, /the email was not delivered/);
});

test('goods receipts page has no receipt register', () => {
  const page = source('../src/pages/GoodsReceiptsPage.jsx');
  assert.doesNotMatch(page, /Receipt register/);
  assert.doesNotMatch(page, /receipts\.map/);
  assert.doesNotMatch(page, /Items received/);
});
