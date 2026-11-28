import { useState } from 'react';
import { Building2, Check, FileText, Plus, X } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import SupplierGRNForm from '../components/ui/SupplierGRNForm.jsx';
import { dateLabel } from '../utils/format.js';

const createButtonClass = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black transition-colors hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const decisionButtonClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-brand bg-white px-3 py-2 text-xs font-bold text-black transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50';
const supplierButtonClass = 'w-full rounded-xl border border-brand bg-white px-4 py-3 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

function supplierDetails(supplier) {
  return [supplier.supplierContact, supplier.supplierPhone, supplier.supplierEmail, supplier.supplierAddress]
    .filter(Boolean).join(' · ');
}

function receivableLines(order) {
  // Only rejected deliveries are excluded. Pending and accepted lines can be
  // documented on an allowed supplier's GRN; stock is still added only when a
  // Storekeeper accepts the line.
  return (order?.lines || []).filter((line) =>
    line.deliveryStatus !== 'Rejected' && Number(line.outstandingQuantity) > 0);
}

export default function GoodsReceiptsPage({ user, onCreateSupplierGRN, onSupplierDecision, sentSuppliers = [] }) {
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [grnOrder, setGrnOrder] = useState(null);
  const [decidingOrder, setDecidingOrder] = useState(null);
  const [error, setError] = useState('');
  const canCreate = ['admin', 'storekeeper', 'procurement'].includes(user?.role);

  function openSupplierGRN(order) {
    setSelectedSupplier(null);
    setError('');
    setGrnOrder(order);
  }

  async function decide(order, decision) {
    setDecidingOrder(order.id);
    setError('');
    try {
      // A decision is terminal: the refreshed list removes denied orders and
      // marks allowed orders as ready for GRN creation.
      await onSupplierDecision(order.id, decision);
      setSelectedSupplier(null);
      setGrnOrder(null);
    } catch (exception) {
      setError(exception.message);
    } finally {
      setDecidingOrder(null);
    }
  }

  return <>
    <PageCard
      title="Sent suppliers"
      description={`${sentSuppliers.length} ${sentSuppliers.length === 1 ? 'supplier' : 'suppliers'} with purchase orders sent for delivery`}
      action={<span className="inline-flex items-center gap-1.5 rounded-full border border-brand bg-white px-3 py-1.5 text-[10px] font-bold text-black">
        <Building2 size={13} aria-hidden="true" />
        Awaiting goods receipt
      </span>}
    >
      {sentSuppliers.length ? <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
        {sentSuppliers.map((supplier) => <button
          key={supplier.supplierId || supplier.supplierName}
          type="button"
          onClick={() => setSelectedSupplier(supplier)}
          className={supplierButtonClass}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block break-words text-sm font-extrabold text-black">{supplier.supplierName}</span>
              <span className="mt-1 block break-words text-[11px] leading-5 text-black">
                {supplierDetails(supplier) || 'No registered contact details'}
              </span>
            </span>
            <FileText size={16} className="mt-1 shrink-0 text-black" aria-hidden="true" />
          </span>
          <span className="mt-3 flex flex-wrap gap-1.5">
            {(supplier.purchaseOrders || []).map((order) => (
              <span key={order.id} className="rounded-full bg-hover px-2.5 py-1 text-[10px] font-bold text-black">
                {order.reference} · {order.grnDecision === 'Allowed' ? 'Allowed' : 'Decision needed'}
              </span>
            ))}
          </span>
        </button>)}
      </div> : <EmptyState>
        <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand bg-white text-black">
            <Building2 size={22} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-sm font-bold text-black">No sent purchase orders yet</h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-black">
            Suppliers appear here as soon as their signed purchase order is sent.
          </p>
        </div>
      </EmptyState>}
    </PageCard>

    <ErrorMessage>{error}</ErrorMessage>

    {selectedSupplier && <Modal
      title={selectedSupplier.supplierName}
      size="lg"
      onClose={() => setSelectedSupplier(null)}
    >
      <div className="grid gap-4 rounded-xl border border-brand bg-hover p-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Contact</p>
          <p className="mt-1 text-xs font-bold text-black">{selectedSupplier.supplierContact || '—'}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Telephone</p>
          <p className="mt-1 text-xs font-bold text-black">{selectedSupplier.supplierPhone || '—'}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Email</p>
          <p className="mt-1 break-words text-xs font-bold text-black">{selectedSupplier.supplierEmail || '—'}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Address</p>
          <p className="mt-1 break-words text-xs font-bold leading-5 text-black">{selectedSupplier.supplierAddress || '—'}</p>
        </div>
      </div>

      <ErrorMessage>{error}</ErrorMessage>

      <div className="mt-5 space-y-3">
        {(selectedSupplier.purchaseOrders || []).map((order) => <div
          key={order.id}
          className="rounded-xl border border-brand bg-white p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-black">{order.reference}</p>
              <p className="mt-1 text-[11px] leading-5 text-black">
                {order.departmentName || 'Receiving department not recorded'}
                {order.deliveryDate ? ` · Expected ${dateLabel(order.deliveryDate)}` : ''}
                {order.decisionReason ? ` · Denied reason: ${order.decisionReason}` : ''}
              </p>
            </div>
            {canCreate && <div className="flex flex-wrap items-center gap-2">
              {order.grnDecision !== 'Allowed' ? <>
                <button
                  type="button"
                  disabled={decidingOrder === order.id}
                  onClick={() => decide(order, 'Allowed')}
                  className={decisionButtonClass}
                >
                  <Check size={14} aria-hidden="true" />Allow
                </button>
                <button
                  type="button"
                  disabled={decidingOrder === order.id}
                  onClick={() => decide(order, 'Denied')}
                  className={decisionButtonClass}
                >
                  <X size={14} aria-hidden="true" />Deny
                </button>
              </> : <span className="inline-flex items-center gap-1.5 rounded-full border border-brand bg-hover px-3 py-1.5 text-[10px] font-bold text-black">
                <Check size={13} aria-hidden="true" />Allowed
              </span>}
              <button
                type="button"
                disabled={order.grnDecision !== 'Allowed' || !receivableLines(order).length}
                title={order.grnDecision === 'Allowed' ? 'Create a Good Received Note' : 'Allow this supplier before creating a GRN'}
                onClick={() => openSupplierGRN(order)}
                className={createButtonClass}
              >
                <Plus size={15} aria-hidden="true" />Create GRN
              </button>
            </div>}
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-subtle">
            {order.lines.map((line) => <div
              key={line.purchaseOrderItemId}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-3 py-2 text-[11px] last:border-b-0"
            >
              <span className="font-bold text-black">{line.itemName}</span>
              <span className="text-black">
                {line.quantity} {line.unit} · {line.deliveryStatus}
                {line.deliveryStatus === 'Accepted' && ` · ${line.outstandingQuantity} available`}
              </span>
            </div>)}
          </div>
        </div>)}
      </div>
    </Modal>}

    {grnOrder && <SupplierGRNForm
      supplier={sentSuppliers.find((entry) =>
        (entry.purchaseOrders || []).some((order) => order.id === grnOrder.id))}
      order={grnOrder}
      onClose={() => setGrnOrder(null)}
      onSubmit={onCreateSupplierGRN}
    />}
  </>;
}
