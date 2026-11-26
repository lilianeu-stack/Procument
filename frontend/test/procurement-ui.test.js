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

test('Purchase orders surfaces Procurement-recommended suppliers with clickable details', () => {
  const app = source('../src/App.jsx');
  const pageContent = source('../src/pages/PageContent.jsx');
  const purchaseOrders = source('../src/pages/PurchaseOrdersPage.jsx');

  assert.match(app, /onLoadCommitteeRecommendations: \(\) => api\('\/committee-recommendations'\)/);
  assert.match(pageContent, /suppliers=\{data\.suppliers\}/);
  assert.match(pageContent, /onLoadCommitteeRecommendations=\{actions\.onLoadCommitteeRecommendations\}/);
  assert.match(pageContent, /sendPurchaseOrderToSuppliers=\{actions\.sendPurchaseOrderToSuppliers\}/);
  assert.match(purchaseOrders, /Recommended suppliers/);
  assert.match(purchaseOrders, /click a supplier to see the quotation, reason and response/);
  assert.match(purchaseOrders, /View recommended supplier \$\{entry\.recommendedSupplier\}/);
  assert.match(purchaseOrders, /RecommendedSupplierDetail/);
  assert.match(purchaseOrders, /Reason for recommendation/);
  assert.match(purchaseOrders, /Committee response/);
  assert.match(purchaseOrders, /View purchase order \{entry\.purchaseOrderReference/);
  assert.match(purchaseOrders, /Create purchase order/);
  assert.match(purchaseOrders, /supplierId: Number\(selectedRfq\.__supplierId\)/);
});

test('official purchase order follows the supplied template and requires image signatures', () => {
  const documentSource = source('../src/components/documents/PurchaseOrderDocument.jsx');
  const purchaseOrders = source('../src/pages/PurchaseOrdersPage.jsx');
  const approvalPage = source('../src/components/portals/PurchaseOrderApprovalPage.jsx');
  const app = source('../src/App.jsx');
  const pageContent = source('../src/pages/PageContent.jsx');

  assert.match(documentSource, /Supplier Contact:/);
  assert.match(documentSource, /Payment Modalities:/);
  assert.match(documentSource, /Please furnish this office the following articles/);
  assert.match(documentSource, /Item No\./);
  assert.match(documentSource, /Total Amount in Words: Rwandan Francs/);
  assert.match(documentSource, /failure to make the full delivery/);
  assert.match(documentSource, /Sincerely Yours,/);
  assert.match(documentSource, /SignatureLine/);
  assert.match(documentSource, /order\.preparedSignature/);
  assert.match(documentSource, /order\.approvedSignature/);
  assert.match(purchaseOrders, /SignatureUpload/);
  assert.match(purchaseOrders, /Upload the Prepared by signature image\./);
  assert.match(purchaseOrders, /Upload the Approved by signature image\./);
  assert.match(purchaseOrders, /approvedBySignature: approvedSignature/);
  assert.match(purchaseOrders, /<SignatureUpload label="Approved by"/);
  assert.match(purchaseOrders, /Official signatures/);
  assert.match(purchaseOrders, /Supplier Email/);
  assert.match(purchaseOrders, /Supplier Phone/);
  assert.match(purchaseOrders, /rfq\?\.selectedSupplierEmail/);
  assert.match(purchaseOrders, /rfq\?\.selectedSupplierPhone/);
  assert.match(purchaseOrders, /supplierEmail: entry\.supplierEmail/);
  assert.match(purchaseOrders, /supplierPhone: entry\.supplierPhone/);
  assert.match(purchaseOrders, /onSaveSignatures/);
  assert.match(approvalPage, /Upload the Approved by signature image before approving\./);
  assert.match(approvalPage, /signature: approvedSignature/);
  assert.match(app, /savePurchaseOrderSignatures: \(id, form\) => mutate\(`\/purchase-orders\/\$\{id\}\/signatures`, form, 'PATCH'\)/);
  assert.match(pageContent, /onSaveSignatures=\{actions\.savePurchaseOrderSignatures\}/);
});

test('create purchase order uses supplier-entered quotation lines without a financial summary', () => {
  const purchaseOrders = source('../src/pages/PurchaseOrdersPage.jsx');
  const pageContent = source('../src/pages/PageContent.jsx');

  assert.ok(!purchaseOrders.includes('Financial Summary'));
  assert.ok(purchaseOrders.includes('function supplierQuoteLines(items)'));
  assert.ok(purchaseOrders.includes('setPoSelection({ rfqId: entry.rfqId, supplierId: entry.supplierId, items: entry.items || [] })'));
  assert.ok(purchaseOrders.includes('initialItems={poSelection?.items || linkedRecommendation?.items || []}'));
  assert.ok(purchaseOrders.includes('onLoadQuotes={onLoadQuotes}'));
  assert.ok(pageContent.includes('onLoadQuotes={actions.onLoadQuotes}'));
});

test('supplier pricing request blocks a past submission deadline before sending', () => {
  const modal = source('../src/components/portals/SupplierSelectionModal.jsx');

  assert.match(modal, /const TODAY = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(modal, /deadline && deadline < TODAY/);
  assert.match(modal, /min=\{TODAY\}/);
});

test('supplier pricing form opens with prefilled prices and only a comments input', () => {
  const pricing = source('../src/components/portals/SupplierPricingPage.jsx');

  // Prices already set on the purchase order seed the editable form and totals.
  assert.match(pricing, /const quoted = new Map\(\(response\?\.items \|\| \[\]\)/);
  assert.match(pricing, /const price = quoted\.get\(id\)\?\.unitPrice/);
  assert.match(pricing, /return \{ items: prices, comments: response\?\.comments \|\| '' \};/);
  assert.match(pricing, /calculateSupplierTotals\(quotedItems, vatRate, 0\)/);

  // Only a single Comments card remains; the extra quotation fields are gone.
  assert.match(pricing, /<PageCard title="Comments" description="Add any notes for Procurement about your prices\.">/);
  assert.match(pricing, /<label className="block text-xs font-bold">Comments/);
  for (const removed of [
    'Currency', 'Other charges', 'Delivery lead time', 'Quotation validity period',
    'Your Quotation', 'Your subtotal', 'Pricing comments',
    'Technical / commercial remarks', 'validity period and your delivery lead time'
  ]) {
    assert.ok(!pricing.includes(removed), `supplier pricing form still renders ${removed}`);
  }
});

test('supplier pricing form loads once and allows a single submission', () => {
  const pricing = source('../src/components/portals/SupplierPricingPage.jsx');

  assert.match(pricing, /useRef, useState/);
  assert.match(pricing, /const loadedTokenRef = useRef\(null\)/);
  assert.match(pricing, /if \(!force && loadedTokenRef\.current === token\) return;/);
  assert.match(pricing, /onRetry=\{\(\) => load\(true\)\}/);

  assert.match(pricing, /const submitAttemptedRef = useRef\(false\)/);
  assert.match(pricing, /if \(submitAttemptedRef\.current \|\| busy \|\| locked\) return;/);
  assert.match(pricing, /submitAttemptedRef\.current = true;/);
  assert.match(pricing, /if \(exception\?\.status === 409\) setLocked\(true\);/);
  assert.match(pricing, /disabled=\{busy \|\| !submitConfirmed\}/);
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
  assert.match(rfqs, /View Commit Results/);
  assert.match(rfqs, /bg-accent-tint px-3 py-2 text-xs font-bold text-black/);
  assert.match(rfqs, /disabled=\{!selectedRfq \|\| committeeBusy\}/);
  assert.match(rfqs, /function viewCommitteeResults\(\)[\s\S]*?viewQuotes\(selectedRfq\)/);
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
  assert.doesNotMatch(rfqs, /Create a PO for supplier/);
  assert.doesNotMatch(rfqs, /selectedRfqHasPurchaseOrder/);
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

test('Send to Committee previews recipient content and stores one decision per link', () => {
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
  assert.match(form, /Recommended supplier:/);
  assert.match(form, /Reason for recommendation/);
  assert.match(form, /Supplier response total/);
  assert.match(form, /name="committee-decision"/);
  assert.match(form, /Reason for this decision/);
  assert.match(form, /Your submitted decision/);
  assert.match(form, /Submitted by/);
  assert.match(form, /one decision per link/);
  assert.match(rfqs, /Submitted by/);
  assert.match(rfqs, /Resend link/);
  assert.match(app, /onResendCommitteeReview/);
  assert.match(app, /CommitteeReviewPage/);
  assert.doesNotMatch(app, /CommitteeDecisionPage/);
});

test('procurement overview groups every live metric into its business section', () => {
  const overview = source('../src/pages/OverviewPage.jsx');
  const app = source('../src/App.jsx');
  for (const label of [
    'Total Purchase Requests', 'Pending Requests', 'Approved Requests', 'Rejected Requests',
    'Total Requests Received', 'New Requests', 'Under Review', 'Processing', 'Completed', 'Rejected',
    'Total Purchase Orders', 'Pending Purchase Orders', 'Approved Purchase Orders',
    'Total RFQs', 'Draft RFQs', 'Sent RFQs', 'Evaluating RFQs', 'Awarded RFQs', 'Closed RFQs',
    'Total Suppliers', 'Total Stock Items', 'Low Stock Items'
  ]) assert.match(overview, new RegExp(label));
  assert.match(app, /api\('\/procurement\/received-requests\/stats'\)/);
  assert.match(app, /api\('\/rfqs\/stats'\)/);
  assert.match(overview, /grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4/);
  assert.match(overview, /min-h-\[112px\].*sm:min-h-\[120px\]/);
  assert.doesNotMatch(overview, /Recent requisitions/);
  assert.doesNotMatch(overview, /Inventory health/);
  assert.doesNotMatch(overview, /Keep every request moving/);
});

test('received-request and RFQ registers keep their tools without top summary cards', () => {
  const received = source('../src/components/portals/ReceivedRequests.jsx');
  const rfqs = source('../src/pages/RfqsPage.jsx');
  assert.doesNotMatch(received, /SUMMARY_CARDS|aria-label="Received request summary"/);
  assert.match(received, /Received requests register/);
  assert.match(received, /<DateRangeFilter/);
  assert.match(received, /DownloadButton exportKey=\{report\.exportKey\} format="pdf"/);
  assert.match(received, /DownloadButton exportKey=\{report\.exportKey\} format="xlsx"/);
  assert.match(received, /DownloadButton exportKey=\{report\.exportKey\} format="csv"/);
  assert.doesNotMatch(rfqs, /SUMMARY_CARDS|currentStats/);
  assert.match(rfqs, /Create RFQ/);
  assert.match(rfqs, /Filter by response/);
  assert.match(rfqs, /RFQ status/);
});

test('add supplier form does not ask for a contact person', () => {
  const suppliers = source('../src/pages/SuppliersPage.jsx');
  assert.match(suppliers, /Supplier name/);
  assert.match(suppliers, /Email/);
  assert.match(suppliers, /Phone/);
  assert.match(suppliers, /\['city', 'district', 'sector', 'cell'\]/);
  assert.match(suppliers, /address: legacyAddress/);
  assert.match(suppliers, /'Address'/);
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
