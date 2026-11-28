import { useState } from 'react';
import Modal from './Modal.jsx';
import { ErrorMessage, FormActions } from './PageCard.jsx';

export default function GoodsReceiptForm({
  items, onClose, onSubmit, title = 'Record stock receipt', submitLabel = 'Confirm receipt'
}) {
  const [form, setForm] = useState({ itemId: '', quantity: '1', source: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ ...form, itemId: Number(form.itemId), quantity: Number(form.quantity) });
      onClose();
    } catch (exception) {
      setError(exception.message);
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={title} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      {items.length ? <label className="block text-xs font-bold">Item
        <select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })} className="field">
          <option value="">Select an item…</option>
          {items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}
        </select>
      </label> : <p role="status" className="text-xs text-black">Add an inventory item before creating a goods receipt.</p>}
      <label className="block text-xs font-bold">Quantity
        <input required min="1" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className="field" />
      </label>
      <label className="block text-xs font-bold">Source
        <input required value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="field" />
      </label>
      <ErrorMessage>{error}</ErrorMessage>
      <FormActions busy={busy} disabled={!items.length} close={onClose} label={submitLabel} />
    </form>
  </Modal>;
}
