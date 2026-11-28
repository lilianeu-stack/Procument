import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { ErrorMessage, FormActions } from './PageCard.jsx';
import SignatureUpload from './SignatureUpload.jsx';

function supplierBlock(supplier) {
  return [supplier?.supplierName, supplier?.supplierContact, supplier?.supplierPhone,
    supplier?.supplierEmail, supplier?.supplierAddress].filter(Boolean).join(' · ');
}

export default function SupplierGRNForm({ supplier, order, onClose, onSubmit }) {
  const receivableLines = useMemo(() => (order?.lines || []).filter((line) =>
    line.deliveryStatus !== 'Rejected' && Number(line.outstandingQuantity) > 0
  ), [order]);

  const [form, setForm] = useState({
    grnDate: new Date().toISOString().slice(0, 10),
    receivedByName: '',
    verifiedByName: '',
    receivedBySignature: null,
    verifiedBySignature: null,
    lines: receivableLines.map((line) => ({
      purchaseOrderItemId: line.purchaseOrderItemId,
      quantity: String(line.outstandingQuantity),
      comment: ''
    }))
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  function updateLine(index, field, value) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, position) =>
        position === index ? { ...line, [field]: value } : line)
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!form.receivedBySignature) throw new Error('Upload the Received by signature image.');
      if (!form.verifiedBySignature) throw new Error('Upload the Verified by signature image.');
      const response = await onSubmit({
        purchaseOrderId: Number(order.id),
        source: `${supplier?.supplierName || 'Supplier'} · ${order.reference}`,
        suppliedBy: supplierBlock(supplier),
        grnDate: form.grnDate,
        receivedByName: form.receivedByName,
        verifiedByName: form.verifiedByName,
        receivedBySignature: form.receivedBySignature,
        verifiedBySignature: form.verifiedBySignature,
        lines: form.lines.map((line) => ({
          purchaseOrderItemId: Number(line.purchaseOrderItemId),
          quantity: Number(line.quantity),
          comment: line.comment
        }))
      });
      // Keep the note open with the delivery result. Closing immediately would
      // hide a failed supplier email and invite a duplicate GRN submission.
      setResult(response || { message: 'Good Received Note recorded.' });
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  return <Modal
    title={`Good Received Note · ${order.reference}`}
    size="xl"
    onClose={onClose}
  >
    <form onSubmit={submit} className="space-y-4">
      {result && <div role="status" className="rounded-xl border border-brand bg-hover px-4 py-3 text-xs leading-5 text-black">
        <p className="font-extrabold">{result.message}</p>
        <p className="mt-1">
          {result.emailDelivery?.ok
            ? `Emailed to ${result.emailRecipient || supplier?.supplierEmail || 'the supplier'}.`
            : `The GRN was recorded, but the email was not delivered: ${result.emailDelivery?.error?.message || result.emailDelivery?.reason || 'unknown email error'}`}
        </p>
      </div>}
      <section className="rounded-xl border border-brand bg-white p-4 sm:p-5">
        <div className="border-b border-subtle pb-3 text-center">
          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-black">Hope Haven</p>
          <h3 className="display-font mt-1 text-lg font-extrabold text-black">GOOD RECEIVED NOTE</h3>
        </div>

        <div className="grid gap-5 py-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Receiving Department</p>
            <p className="mt-1 break-words text-xs font-bold text-black">{order.departmentName || '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Tel. No.</p>
            <p className="mt-1 break-words text-xs font-bold text-black">—</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Supplied by</p>
            <p className="mt-1 break-words text-xs font-bold leading-6 text-black">{supplierBlock(supplier) || '—'}</p>
          </div>
        </div>

        {receivableLines.length ? <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed text-left text-xs">
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '48%' }} />
              <col style={{ width: '30%' }} />
            </colgroup>
            <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black">
              <tr>{['Quantity', 'Unit', 'Description item received', 'Comment'].map((cell) =>
                <th key={cell} className="border border-brand px-3 py-3 font-extrabold">{cell}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {receivableLines.map((line, index) => <tr key={line.purchaseOrderItemId}>
                <td className="border border-brand px-3 py-3 align-top">
                  <input
                    aria-label={`Quantity for ${line.itemName}`}
                    required
                    min="1"
                    max={line.outstandingQuantity}
                    type="number"
                    value={form.lines[index]?.quantity ?? ''}
                    onChange={(event) => updateLine(index, 'quantity', event.target.value)}
                    className="field min-h-8 py-1"
                  />
                </td>
                <td className="border border-brand px-3 py-3 align-top font-semibold">{line.unit || 'unit'}</td>
                <td className="border border-brand px-3 py-3 align-top leading-6">
                  <span className="font-bold break-words">{line.itemName}</span>
                  {line.description && <span className="mt-1 block break-words text-[11px]">{line.description}</span>}
                  <span className="mt-1 block text-[10px] text-black">
                    {line.quantity} ordered · {line.receivedQuantity} on previous GRNs
                  </span>
                </td>
                <td className="border border-brand px-3 py-3 align-top">
                  <input
                    aria-label={`Comment for ${line.itemName}`}
                    value={form.lines[index]?.comment ?? ''}
                    onChange={(event) => updateLine(index, 'comment', event.target.value)}
                    className="field min-h-8 py-1"
                    placeholder="Optional comment"
                  />
                </td>
              </tr>)}
            </tbody>
          </table>
        </div> : <p role="status" className="rounded-lg border border-brand bg-hover px-3 py-4 text-center text-xs font-bold text-black">
          No available items from this supplier remain for a Good Received Note. Rejected items are never included.
        </p>}

        <div className="mt-5 border-t border-subtle pt-4">
          <div className="mb-4 flex justify-end">
            <label className="text-xs font-bold text-black">Date
              <input required type="date" value={form.grnDate} onChange={(event) => setForm({ ...form, grnDate: event.target.value })} className="field mt-2" />
            </label>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Received by:</p>
              <label className="mt-2 block text-xs font-bold text-black">Name
                <input required value={form.receivedByName} onChange={(event) => setForm({ ...form, receivedByName: event.target.value })} className="field" />
              </label>
              <div className="mt-3">
                <SignatureUpload
                  label="Received by signature"
                  value={form.receivedBySignature}
                  onChange={(value) => setForm({ ...form, receivedBySignature: value })}
                  disabled={busy}
                />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[.08em] text-black">Verified by:</p>
              <label className="mt-2 block text-xs font-bold text-black">Name
                <input required value={form.verifiedByName} onChange={(event) => setForm({ ...form, verifiedByName: event.target.value })} className="field" />
              </label>
              <div className="mt-3">
                <SignatureUpload
                  label="Verified by signature"
                  value={form.verifiedBySignature}
                  onChange={(value) => setForm({ ...form, verifiedBySignature: value })}
                  disabled={busy}
                />
              </div>
            </div>
          </div>
          <p className="mt-3 text-[10px] text-black">Upload both signature photos to create the GRN.</p>
        </div>
      </section>

      <ErrorMessage>{error}</ErrorMessage>
      {result ? <div className="flex justify-end border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black transition-colors hover:bg-accent-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          Close
        </button>
      </div> : <FormActions
        busy={busy}
        disabled={!receivableLines.length || !form.receivedBySignature || !form.verifiedBySignature}
        close={onClose}
        label="Create GRN"
        busyLabel="Creating…"
      />}
    </form>
  </Modal>;
}
