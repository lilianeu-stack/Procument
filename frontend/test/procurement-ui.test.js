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
  assert.match(pageContent, /sendPurchaseOrderToSupplier=\{actions\.sendPurchaseOrderToSupplier\}/);
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

test('official purchase order document uses the supplied design palette with large signatures', () => {
  const documentSource = source('../src/components/documents/PurchaseOrderDocument.jsx');
  const css = source('../src/index.css');

  assert.match(documentSource, /src="\/procurement-logo\.png"/);
  assert.match(documentSource, /<strong>HOPE HAVEN<\/strong>/);
  assert.match(css, /--pims-document-page:\s*#F4F7F6/);
  assert.match(css, /--pims-document-teal:\s*#123D3A/);
  assert.match(css, /\.official-header \{[\s\S]*?background:\s*var\(--pims-document-teal\)/);
  assert.match(css, /\.official-header,[\s\S]*?\.official-header \* \{[\s\S]*?color:\s*#FFFFFF\s*!important/);

  const signatureRule = /\.official-po-signature-image img \{([^}]*)\}/.exec(css);
  assert.ok(signatureRule, 'the purchase-order signature image rule should exist');
  assert.match(signatureRule[1], /height:\s*56px/);

  const fieldRule = /\.official-po-field \{([^}]*)\}/.exec(css);
  assert.ok(fieldRule, 'the purchase-order field rule should exist');
  assert.doesNotMatch(fieldRule[1], /border-bottom/);

  const valueRule = /\.official-po-field \.official-value \{([^}]*)\}/.exec(css);
  assert.ok(valueRule, 'the purchase-order value rule should exist');
  assert.doesNotMatch(valueRule[1], /border-bottom/);
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

test('purchase order supplier action emails the saved signed PO directly', () => {
  const app = source('../src/App.jsx');
  const pageContent = source('../src/pages/PageContent.jsx');
  const purchaseOrders = source('../src/pages/PurchaseOrdersPage.jsx');

  assert.ok(app.includes('sendPurchaseOrderToSupplier: (id, form = {}) => mutate(`/purchase-orders/${id}/send-to-supplier`, form)'));
  assert.ok(pageContent.includes('sendPurchaseOrderToSupplier={actions.sendPurchaseOrderToSupplier}'));
  assert.ok(!pageContent.includes('sendPurchaseOrderToSuppliers={'));
  assert.ok(purchaseOrders.includes('async function sendOfficialPurchaseOrder(order, payload = {})'));
  assert.ok(purchaseOrders.includes('await sendPurchaseOrderToSupplier(id, payload)'));
  assert.ok(purchaseOrders.includes('async function emailPurchaseOrder(order)'));
  assert.ok(purchaseOrders.includes('onClick={() => { void emailPurchaseOrder(order); }}'));
  assert.ok(purchaseOrders.includes('onClick={() => { void emailPurchaseOrder(detail); }}'));
  assert.ok(purchaseOrders.includes('Save & Send PO'));

  // The RFQ/pricing-form invitation modal is no longer part of this action.
  assert.ok(!purchaseOrders.includes('SupplierSelectionModal'));
  assert.ok(!purchaseOrders.includes('__sendToSuppliers'));
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

test('supplier pricing form shows the created official purchase order with signatures', () => {
  const pricing = source('../src/components/portals/SupplierPricingPage.jsx');

  assert.match(pricing, /import PurchaseOrderDocument from '..\/documents\/PurchaseOrderDocument\.jsx';/);
  assert.match(pricing, /Official purchase order · \$\{request\.purchaseOrder\.reference/);
  assert.match(pricing, /<PurchaseOrderDocument order=\{request\.purchaseOrder\} \/>/);
  assert.match(pricing, /The purchase order created by Procurement, including the official signatures\./);
  assert.doesNotMatch(pricing, /<PageCard title="Supplier Information"/);
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

test('Procurement dashboard hides the requested status cards only for Procurement users', () => {
  const overview = source('../src/pages/OverviewPage.jsx');
  for (const label of [
    'Rejected Requests', 'Under Review', 'Processing', 'Rejected', 'Draft RFQs', 'Awarded RFQs'
  ]) {
    assert.match(overview, new RegExp(`'${label}'`));
  }
  assert.match(overview, /role === 'procurement'/);
  assert.match(overview, /section\.metrics\.filter\(\(metric\) => !PROCUREMENT_HIDDEN_METRICS\.has\(metric\.label\)\)/);
});

test('Stock movements page hides its page header above the register controls', () => {
  const layout = source('../src/components/layout/AppLayout.jsx');

  assert.match(layout, /page !== 'Stock movements'/);
  assert.match(layout, /Review recorded receipts, issues, and inventory balance changes/);
});

test('Goods receipts and Email Inbox hide their large page headers', () => {
  const layout = source('../src/components/layout/AppLayout.jsx');
  assert.match(layout, /page !== 'Goods receipts'/);
  assert.match(layout, /page !== 'Email Inbox'/);
});

test('Stock overview hides its page header and has no Record receipt button', () => {
  const layout = source('../src/components/layout/AppLayout.jsx');
  const inventory = source('../src/pages/InventoryPage.jsx');
  assert.match(layout, /page !== 'Stock overview'/);
  assert.doesNotMatch(inventory, /Record receipt|recordReceiptButtonClass|canReceive/);
});

test('Procurement sidebar hides Goods receipts without hiding it for other roles', () => {
  const sidebar = source('../src/components/layout/Sidebar.jsx');
  assert.match(sidebar, /user\.role === 'procurement' && name === 'Goods receipts'/);
  assert.match(sidebar, /canAccessPage\(user\.role, name\)/);
});

test('Invoices is absent from the shared sidebar for all roles', () => {
  const sidebar = source('../src/components/layout/Sidebar.jsx');
  assert.doesNotMatch(sidebar, /\{ name: 'Invoices', icon: BriefcaseBusiness \}/);
  assert.doesNotMatch(sidebar, /name === 'Invoices'/);
});

test('received-request and RFQ registers keep their tools without top summary cards', () => {
  const received = source('../src/components/portals/ReceivedRequests.jsx');
  const rfqs = source('../src/pages/RfqsPage.jsx');
  assert.doesNotMatch(received, /SUMMARY_CARDS|aria-label="Received request summary"/);
  assert.match(received, /Received requests register/);
  assert.match(received, /<DateRangeFilter\s+fromToOnly/);
  assert.match(received, /label="Search request"/);
  assert.match(received, /placeholder="Search request"/);
  assert.doesNotMatch(received, /Search requester/);
  assert.doesNotMatch(received, /Search department/);
  assert.doesNotMatch(received, /All statuses/);
  assert.doesNotMatch(received, /Submission \/ forwarding/);
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

test('forwarded request can send requested items to another user', () => {
  const documentView = source('../src/components/portals/ProcurementDocumentView.jsx');
  const app = source('../src/App.jsx');

  assert.match(documentView, /const \[sendOpen, setSendOpen\] = useState\(false\)/);
  assert.match(documentView, /function openSendModal\(\)/);
  assert.match(documentView, /function sendToAnotherUser\(event\)/);
  assert.match(documentView, /<Send size=\{14\} \/>Send to another user/);
  assert.match(documentView, /<Modal title="Send requested items to another user"/);
  assert.match(documentView, /portalApi\.sendRequisitionEmail\(id, \{/);
  assert.match(documentView, /to: recipientEmail/);
  assert.match(documentView, /recipientPhone: recipientPhone\.trim\(\)/);
  assert.match(documentView, /message: senderNote\.trim\(\)/);
  assert.match(documentView, /\{busy \? 'Sending…' : 'Send by email'\}/);
  assert.match(documentView, /Sent response forms \(\$\{sentForms\.length\}\)/);
  assert.match(app, /sendRequisitionEmail: \(id, payload\) => api\(`\/email\/requisitions\/\$\{id\}\/send`, \{ method: 'POST', body: JSON\.stringify\(payload\) \}\)/);
});

test('page containers fill the available width and stay left aligned everywhere', () => {
  const shells = [
    '../src/components/layout/AppLayout.jsx',
    '../src/components/portals/PortalLayout.jsx'
  ];
  for (const path of shells) {
    const shell = source(path);
    assert.match(shell, /className="w-full max-w-none px-5 pb-10 pt-7 sm:px-8"/);
    assert.doesNotMatch(shell, /mx-auto max-w-\[1440px\]/);
  }

  const publicPages = [
    '../src/components/portals/CommitteeReviewPage.jsx',
    '../src/components/portals/PurchaseOrderApprovalPage.jsx',
    '../src/components/portals/RequestResponsePage.jsx',
    '../src/components/portals/SupplierRfqPage.jsx',
    '../src/components/portals/SupplierPricingPage.jsx'
  ];
  for (const path of publicPages) {
    const page = source(path);
    assert.match(page, /w-full max-w-none/);
    assert.doesNotMatch(page, /mx-auto[^"]*max-w-(?:5|6)xl/);
  }
});

test('date range filter can show only From and To inputs', () => {
  const dateFilter = source('../src/components/ui/DateRangeFilter.jsx');

  assert.match(dateFilter, /fromToOnly = false/);
  const fromToOnlyStart = dateFilter.indexOf('if (fromToOnly)');
  const compactStart = dateFilter.indexOf('if (compact)');
  assert.ok(fromToOnlyStart > -1);
  assert.ok(compactStart > fromToOnlyStart);
  const simpleBlock = dateFilter.slice(fromToOnlyStart, compactStart);

  assert.match(simpleBlock, /label="From"/);
  assert.match(simpleBlock, /label="To"/);
  assert.doesNotMatch(simpleBlock, /Preset/);
  assert.doesNotMatch(simpleBlock, /Clear dates/);
});

test('Goods receipts page exposes only the role-gated supplier Create GRN action', () => {
  const page = source('../src/pages/GoodsReceiptsPage.jsx');
  const form = source('../src/components/ui/GoodsReceiptForm.jsx');
  const pageCard = source('../src/components/ui/PageCard.jsx');
  const inventory = source('../src/pages/InventoryPage.jsx');

  assert.match(page, /Create GRN/);
  assert.match(page, /\['admin', 'storekeeper', 'procurement'\]\.includes\(user\?\.role\)/);
  assert.match(page, /onClick=\{\(\) => openSupplierGRN\(order\)\}/);
  assert.doesNotMatch(page, /Receipt register/);
  assert.doesNotMatch(page, /<GoodsReceiptForm/);
  assert.match(form, /itemId: Number\(form\.itemId\), quantity: Number\(form\.quantity\)/);
  assert.match(form, /FormActions busy=\{busy\} disabled=\{!items\.length\}/);
  assert.match(pageCard, /disabled=\{busy \|\| disabled\}/);
  // Stock receipts stay on the purchase-order workflow; Stock overview no
  // longer exposes a second stock-moving form.
  assert.doesNotMatch(inventory, /GoodsReceiptForm|onReceive|Record receipt/);
});
