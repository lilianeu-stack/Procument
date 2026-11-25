import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('procurement workflow keeps only the request summary and Create RFQ action', () => {
  const workflow = source('../src/components/portals/ProcurementProcessingPage.jsx');
  assert.match(workflow, /Create RFQ/);
  assert.match(workflow, /<RFQForm/);
  assert.doesNotMatch(workflow, /<RfqsPage/);
  assert.doesNotMatch(workflow, /<PurchaseOrdersPage/);
  assert.doesNotMatch(workflow, /role="tablist"/);
  assert.doesNotMatch(workflow, /Request for quotations/);
  assert.match(workflow, /Requested items/);
  assert.match(workflow, /Description/);
  assert.match(workflow, /Quantity/);
  assert.match(workflow, /Unit cost/);
  assert.match(workflow, /Total/);
});

test('RFQ form has only start/deadline dates and a searchable multi-supplier dropdown', () => {
  const rfqs = source('../src/pages/RfqsPage.jsx');
  const app = source('../src/App.jsx');
  const pageContent = source('../src/pages/PageContent.jsx');
  const purchaseOrders = source('../src/pages/PurchaseOrdersPage.jsx');
  assert.match(rfqs, /Send date/);
  assert.match(rfqs, /Start date/);
  assert.match(rfqs, /End date \(deadline\)/);
  assert.match(rfqs, /type="datetime-local" step="60"/);
  assert.match(rfqs, /Search suppliers by name or email/);
  assert.match(rfqs, /supplier\$\{selected\.length === 1 \? '' : 's'\} selected/);
  assert.match(rfqs, /No suppliers found/);
  assert.match(rfqs, /Message to suppliers/);
  assert.match(rfqs, /<textarea rows="3"/);
  assert.match(rfqs, /Supplier responses/);
  assert.match(rfqs, /value="responded">Supplier responded/);
  assert.match(rfqs, /value="awaiting">Awaiting response/);
  assert.match(rfqs, /View responses \(\$\{rfq\.responses\.length\}\)/);
  assert.match(rfqs, /Send to Committee/);
  assert.match(rfqs, /onSendToCommittee\(payload\)/);
  assert.match(rfqs, /Select all RFQs with supplier responses shown/);
  assert.match(rfqs, /Select \$\{rfq\.reference\} for Procurement Committee/);
  assert.doesNotMatch(rfqs, /onSendToCommittee\(rfq\.id\)/);
  assert.match(app, /onSendRfqToCommittee: \(payload\) => mutate\('\/rfqs\/send-to-committee', payload\)/);
  assert.match(app, /onPreviewCommittee: \(rfqIds\) => api\(`\/rfqs\/committee-preview\?rfqIds=\$\{rfqIds\.map\(encodeURIComponent\)\.join\(','\)\}`\)/);
  assert.match(app, /onLoadCommitteeReviews: \(rfqId\) => api\(`\/rfqs\/\$\{rfqId\}\/committee-reviews`\)/);
  assert.match(pageContent, /onSendToCommittee=\{actions\.onSendRfqToCommittee\}/);
  assert.match(pageContent, /onPreviewCommittee=\{actions\.onPreviewCommittee\}/);
  assert.match(pageContent, /onLoadCommitteeReviews=\{actions\.onLoadCommitteeReviews\}/);
  assert.match(rfqs, /Create a PO for supplier/);
  assert.match(rfqs, /selectedRfq\.status !== 'Awarded'/);
  assert.match(rfqs, /selectedRfqHasPurchaseOrder/);
  assert.match(pageContent, /purchaseOrders=\{data\.purchaseOrders\}/);
  assert.match(pageContent, /onCreatePO=\{actions\.onCreatePO\}/);
  assert.match(purchaseOrders, /export function OrderForm/);
  assert.match(rfqs, /Invitation sent to suppliers/);
  assert.match(rfqs, /quote\.supplierEmail/);
  assert.match(rfqs, /Overall supplier comment/);
  assert.match(rfqs, /quote\.items\.map/);
  assert.match(rfqs, /space-y-3/);
  assert.match(rfqs, /max-h-44/);
  assert.doesNotMatch(rfqs, /min-h-\[80vh\]/);
  assert.doesNotMatch(rfqs, /mt-auto/);
  assert.doesNotMatch(rfqs, /Approved requisition/);
});

test('Send to Committee previews recipient content and stores one decision set per link', () => {
  const rfqs = source('../src/pages/RfqsPage.jsx');
  const modal = source('../src/pages/CommitteeReviewModal.jsx');
  const form = source('../src/components/portals/CommitteeReviewPage.jsx');
  const app = source('../src/App.jsx');

  assert.match(rfqs, /openCommitteeReview/);
  assert.match(rfqs, /onSendToCommittee\(payload\)/);
  assert.match(modal, /memberIds: selectedMembers/);
  assert.match(modal, /Select at least one committee member/);
  assert.match(modal, /Message from Procurement/);
  assert.match(modal, /Accept/);
  assert.match(modal, /Deny/);
  assert.match(modal, /Recommended supplier/);
  assert.match(modal, /Reason for recommendation/);
  assert.doesNotMatch(modal, /Your comment to the Committee/);
  assert.doesNotMatch(modal, /Delivery/);
  assert.match(form, /\/committee-review\/\$\{encodeURIComponent\(token\)\}/);
  assert.match(form, /\/committee-review\/\$\{encodeURIComponent\(token\)\}\/decisions/);
  assert.match(form, /Message from Procurement/);
  assert.match(form, /Supplier response total/);
  assert.match(form, /Reason for denying this response/);
  assert.match(form, /Your submitted decisions/);
  assert.match(form, /one response per link/);
  assert.match(rfqs, /Resend link/);
  assert.match(app, /onResendCommitteeReview/);
  assert.match(app, /CommitteeReviewPage/);
  assert.doesNotMatch(app, /CommitteeDecisionPage/);
});

test('procurement overview keeps only the metric cards', () => {
  const overview = source('../src/pages/OverviewPage.jsx');
  assert.match(overview, /Total requisitions/);
  assert.match(overview, /Awaiting approval/);
  assert.match(overview, /Items in catalogue/);
  assert.match(overview, /Active suppliers/);
  assert.doesNotMatch(overview, /Recent requisitions/);
  assert.doesNotMatch(overview, /Inventory health/);
  assert.doesNotMatch(overview, /Keep every request moving/);
});

test('add supplier form does not ask for a contact person', () => {
  const suppliers = source('../src/pages/SuppliersPage.jsx');
  assert.match(suppliers, /Supplier name/);
  assert.match(suppliers, /Email/);
  assert.match(suppliers, /Phone/);
  assert.doesNotMatch(suppliers, /Contact person/);
  assert.doesNotMatch(suppliers, /contactName: ''/);
});

test('supplier directory hides rating and status columns and wires edit and safe removal', () => {
  const suppliers = source('../src/pages/SuppliersPage.jsx');
  const app = source('../src/App.jsx');
  assert.doesNotMatch(suppliers, /'Rating'|'Status'|StatusBadge/);
  assert.match(suppliers, /aria-label=\{`Edit \$\{supplier\.name\}`\}/);
  assert.match(suppliers, /aria-label=\{`Delete \$\{supplier\.name\}`\}/);
  assert.match(suppliers, /onUpdate\(editingSupplier\.id, form\)/);
  assert.match(suppliers, /onDelete\(deletingSupplier\.id\)/);
  assert.match(suppliers, /history will be kept/i);
  assert.match(app, /onUpdateSupplier: \(id, form\) => mutate\(`\/suppliers\/\$\{id\}`, form, 'PATCH'\)/);
  assert.match(app, /onDeleteSupplier: \(id\) => mutate\(`\/suppliers\/\$\{id\}`, \{\}, 'DELETE'\)/);
});

test('Procurement Committee page exposes the contact fields and CRUD actions', () => {
  const page = source('../src/pages/ProcurementCommitteePage.jsx');
  const sidebar = source('../src/components/layout/Sidebar.jsx');
  assert.match(page, /First name/);
  assert.match(page, /Last name/);
  assert.match(page, /Email/);
  assert.match(page, /Phone number/);
  assert.match(page, /onCreate/);
  assert.match(page, /onUpdate\(editingMember\.id, form\)/);
  assert.match(page, /onDelete\(deletingMember\.id\)/);
  assert.match(sidebar, /PROCUREMENT_COMMITTEE_PAGE, icon: Users/);
});

test('supplier page uses the requisition form presentation', () => {
  const supplierPage = source('../src/components/portals/SupplierRfqPage.jsx');
  assert.match(supplierPage, /Requested items form/);
  assert.match(supplierPage, /Requisition response portal/);
  assert.match(supplierPage, /Message from Procurement/);
  assert.match(supplierPage, /Your unit price \(RWF\)/);
  assert.match(supplierPage, /Submit response/);
  assert.match(supplierPage, /quotation/);
  assert.doesNotMatch(supplierPage, /Request for quotation/);
  assert.doesNotMatch(supplierPage, /itemComments/);
  assert.doesNotMatch(supplierPage, /'Description'/);
  assert.doesNotMatch(supplierPage, /'Comment'/);
  assert.doesNotMatch(supplierPage, /Quotation total/);
  assert.match(supplierPage, /Your response total/);
  assert.match(supplierPage, /text-base font-bold/);
  assert.doesNotMatch(supplierPage, /Delivery days/);
  assert.doesNotMatch(supplierPage, /rfq\.justification/);
  assert.doesNotMatch(supplierPage, /Priority/);
  assert.doesNotMatch(supplierPage, /Required by/);
  assert.doesNotMatch(supplierPage, /Estimated total/);
});

test('public response forms show a single submitted response instead of an editable form', () => {
  const supplierPage = source('../src/components/portals/SupplierRfqPage.jsx');
  const requestPage = source('../src/components/portals/RequestResponsePage.jsx');

  assert.match(supplierPage, /const responded = Boolean\(rfq\?\.quotation\)/);
  assert.match(supplierPage, /responded \? <strong>\{currency\(price\)\}<\/strong>/);
  assert.match(supplierPage, /Response submitted\{rfq\.quotation\.submittedAt/);
  assert.match(supplierPage, /Only one response is accepted for each form/);

  assert.match(requestPage, /const responded = Boolean\(request\?\.responded\)/);
  assert.match(requestPage, /\{responded \? 'Your response' : 'Add your comment'\}/);
  assert.match(requestPage, /Response submitted/);
  assert.match(requestPage, /Only one response is accepted for each form/);
  assert.match(requestPage, /request\.response/);
  assert.match(requestPage, /\{request\.message && <section/);
  assert.match(requestPage, /Message from Procurement/);
  assert.match(requestPage, /\{request\.message\}/);
});

test('Procurement can resend a working response link for an already-sent form', () => {
  const documentView = source('../src/components/portals/ProcurementDocumentView.jsx');
  const app = source('../src/App.jsx');

  assert.match(documentView, /Sent response forms \(\$\{sentForms\.length\}\)/);
  assert.match(documentView, /Resend working link/);
  assert.match(documentView, /portalApi\.resendRequisitionForm\(id, threadId\)/);
  assert.match(documentView, /await portalApi\.getRequisitionForms\(id\)/);
  assert.match(documentView, /localhost link\. Resend a form/);
  assert.match(app, /getRequisitionForms: \(id\) => api\(`\/email\/requisitions\/\$\{id\}\/forms`\)/);
  assert.match(app, /resendRequisitionForm: \(id, threadId\) => mutate\(`\/email\/requisitions\/\$\{id\}\/forms\/\$\{threadId\}\/resend`, \{\}\)/);
});
