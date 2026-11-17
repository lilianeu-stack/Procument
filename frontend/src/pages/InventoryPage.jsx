import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { currency, dateLabel } from '../utils/format.js';

function InventoryItemForm({ onClose, onSubmit }) {
  const [form, setForm] = useState({ sku: '', name: '', category: '', unit: 'unit', reorderLevel: '10', unitCost: '0' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await onSubmit({ ...form, reorderLevel: Number(form.reorderLevel), unitCost: Number(form.unitCost) }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Add inventory item" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs font-bold">SKU<input required value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} className="field" /></label>
      <label className="text-xs font-bold">Item name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" /></label>
      <label className="text-xs font-bold">Category<input required value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="field" /></label>
      <label className="text-xs font-bold">Unit<input required value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} className="field" /></label>
      <label className="text-xs font-bold">Reorder level<input required min="0" type="number" value={form.reorderLevel} onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })} className="field" /></label>
      <label className="text-xs font-bold">Unit cost<input required min="0" step="0.01" type="number" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} className="field" /></label>
    </div>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Add item" />
  </form></Modal>;
}

function ReceiptForm({ items, onClose, onSubmit }) {
  const [form, setForm] = useState({ itemId: '', quantity: '1', source: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({ ...form, itemId: Number(form.itemId), quantity: Number(form.quantity) }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Record stock receipt" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Item<select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })} className="field"><option value="">Select an item…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></label>
    <label className="block text-xs font-bold">Quantity<input required min="1" type="number" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} className="field" /></label>
    <label className="block text-xs font-bold">Source<input required value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} className="field" /></label>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Confirm receipt" />
  </form></Modal>;
}

export default function InventoryPage({ page, items, movements, user, search, onAddItem, onReceive }) {
  const [dialog, setDialog] = useState('');
  const canEdit = ['admin', 'storekeeper'].includes(user.role);
  const canReceive = ['admin', 'storekeeper', 'procurement'].includes(user.role);
  const filtered = items.filter((item) => `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  const lowStock = filtered.filter((item) => item.quantity <= item.reorderLevel);

  return <>
    {page === 'Stock movements' ? <PageCard title="Stock movement history" description={`${movements.length} latest receipts and issues`}>
      {movements.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Date', 'Item', 'Movement', 'Quantity', 'Source', 'Balance'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{movements.map((entry) => <tr key={entry.id}><td className="px-4 py-3">{dateLabel(entry.createdAt)}</td><td className="px-4 py-3 font-semibold">{entry.item}</td><td className="px-4 py-3">{entry.type}</td><td className="px-4 py-3">{entry.quantity}</td><td className="px-4 py-3">{entry.source}</td><td className="px-4 py-3">{entry.balance}</td></tr>)}</tbody></table></div> : <EmptyState>No stock movements recorded.</EmptyState>}
    </PageCard> : <PageCard title="Inventory catalogue" description={`${items.length} items · ${lowStock.length} below reorder level`}
      action={<div className="flex gap-2">{canEdit && <button onClick={() => setDialog('item')} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-brand"><Plus size={14} />Add item</button>}{canReceive && <button onClick={() => setDialog('receipt')} className="flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Record receipt</button>}</div>}>
      {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Item', 'Category', 'On hand', 'Reorder at', 'Unit cost', 'Status'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{filtered.map((item) => <tr key={item.id}><td className="px-5 py-4 font-bold">{item.name}<div className="mt-1 text-[10px] font-normal text-muted">{item.sku}</div></td><td className="px-5 py-4">{item.category}</td><td className="px-5 py-4 font-bold">{item.quantity} {item.unit}</td><td className="px-5 py-4">{item.reorderLevel}</td><td className="px-5 py-4">{currency(item.unitCost)}</td><td className="px-5 py-4"><StatusBadge value={item.quantity <= item.reorderLevel ? 'Low stock' : 'Approved'} /></td></tr>)}</tbody></table></div> : <EmptyState>No inventory items match your search.</EmptyState>}
    </PageCard>}
    {dialog === 'item' && <InventoryItemForm onClose={() => setDialog('')} onSubmit={onAddItem} />}
    {dialog === 'receipt' && <ReceiptForm items={items} onClose={() => setDialog('')} onSubmit={onReceive} />}
  </>;
}
