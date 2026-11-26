import { useState } from 'react';
import { Activity, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Package, Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { currency, dateLabel } from '../utils/format.js';

const addItemButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-brand bg-white px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';
const recordReceiptButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-black bg-reference px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';
const MOVEMENT_ICONS = { Receipt: ArrowDownToLine, Issue: ArrowUpFromLine, Adjustment: ArrowLeftRight };

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

export default function InventoryPage({ page, items, movements, user, search, query = {}, onAddItem, onReceive }) {
  const [dialog, setDialog] = useState('');
  const canEdit = ['admin', 'storekeeper'].includes(user.role);
  const canReceive = ['admin', 'storekeeper', 'procurement'].includes(user.role);
  const filtered = items.filter((item) => `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(search.toLowerCase()));
  const lowStock = filtered.filter((item) => item.quantity <= item.reorderLevel);
  const lowStockOnly = query.lowStock === 'true' || query.lowStock === '1';
  const visibleItems = lowStockOnly ? lowStock : filtered;

  return <>
    {page === 'Stock movements' ? <PageCard
      className="shadow-dashboard"
      title="Movement history"
      description={`${movements.length} recent ${movements.length === 1 ? 'movement' : 'movements'} · Receipts, issues, and adjustments`}
    >
      {movements.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: '14%' }} />
            <col style={{ width: '23%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '21%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black">
            <tr>{['Date', 'Item', 'Movement', 'Quantity', 'Source', 'Balance'].map((cell) =>
              <th key={cell} className="whitespace-nowrap px-5 py-3.5 font-bold">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {movements.map((entry) => {
              const MovementIcon = MOVEMENT_ICONS[entry.type] || Activity;
              return <tr key={entry.id} className="transition-colors hover:bg-hover">
                <td className="whitespace-nowrap px-5 py-4 align-middle tabular-nums">{dateLabel(entry.movementAt || entry.createdAt)}</td>
                <td className="break-words px-5 py-4 align-middle">
                  <span className="block font-semibold">{entry.item || '—'}</span>
                  {entry.sku && <span className="mt-1 block text-[10px] font-medium tracking-wide text-black">{entry.sku}</span>}
                </td>
                <td className="px-5 py-4 align-middle">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-white px-2.5 py-1.5 text-[10px] font-semibold text-black">
                    <MovementIcon size={13} aria-hidden="true" />
                    {entry.type || 'Movement'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-4 align-middle font-bold tabular-nums">{entry.quantity}</td>
                <td className="break-words px-5 py-4 align-middle">{entry.source || '—'}</td>
                <td className="whitespace-nowrap px-5 py-4 align-middle">
                  <span className="inline-flex rounded-lg border border-brand bg-white px-2.5 py-1.5 font-semibold tabular-nums">{entry.balance}</span>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <EmptyState>
        <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand bg-white text-black">
            <Activity size={22} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-sm font-bold text-black">No stock movements yet</h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-black">
            Receipts, issues, and adjustments will appear here as inventory changes are recorded.
          </p>
        </div>
      </EmptyState>}
    </PageCard> : <PageCard
      className="shadow-dashboard"
      title="Inventory register"
      description={`${visibleItems.length} of ${items.length} items · ${lowStock.length} below reorder level${lowStockOnly ? ' · Low stock only' : ''}`}
      action={<div className="flex flex-wrap gap-2">
        {canEdit && <button type="button" onClick={() => setDialog('item')} className={addItemButtonClass}><Plus size={15} />Add item</button>}
        {canReceive && <button type="button" onClick={() => setDialog('receipt')} className={recordReceiptButtonClass}><Plus size={15} />Record receipt</button>}
      </div>}
    >
      {visibleItems.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: '26%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '12%' }} />
          </colgroup>
          <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black">
            <tr>{['Item', 'Category', 'On hand', 'Reorder at', 'Unit cost', 'Status'].map((cell) =>
              <th key={cell} className="whitespace-nowrap px-5 py-3.5 font-bold">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {visibleItems.map((item) => <tr key={item.id} className="transition-colors hover:bg-hover">
              <td className="px-5 py-4 align-middle">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand bg-white text-black" aria-hidden="true">
                    <Package size={16} strokeWidth={1.8} />
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words font-bold">{item.name}</span>
                    <span className="mt-1 block text-[10px] font-medium tracking-wide text-black">{item.sku}</span>
                  </span>
                </div>
              </td>
              <td className="break-words px-5 py-4 align-middle">{item.category}</td>
              <td className="whitespace-nowrap px-5 py-4 align-middle font-bold tabular-nums">{item.quantity} {item.unit}</td>
              <td className="whitespace-nowrap px-5 py-4 align-middle tabular-nums">{item.reorderLevel} {item.unit}</td>
              <td className="whitespace-nowrap px-5 py-4 align-middle font-semibold tabular-nums">{currency(item.unitCost)}</td>
              <td className="px-5 py-4 align-middle"><StatusBadge value={item.quantity <= item.reorderLevel ? 'Low stock' : 'Approved'} /></td>
            </tr>)}
          </tbody>
        </table>
      </div> : <EmptyState>
        <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand bg-white text-black">
            <Package size={22} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-sm font-bold text-black">
            {!items.length ? 'No inventory items yet' : lowStockOnly ? 'No matching items below reorder level' : 'No inventory items match your search'}
          </h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-black">
            {!items.length
              ? 'Items added to the inventory catalogue will appear here.'
              : lowStockOnly
                ? 'No items matching the current search are below their reorder threshold.'
                : 'Try another item name, SKU, or category.'}
          </p>
        </div>
      </EmptyState>}
    </PageCard>}
    {dialog === 'item' && <InventoryItemForm onClose={() => setDialog('')} onSubmit={onAddItem} />}
    {dialog === 'receipt' && <ReceiptForm items={items} onClose={() => setDialog('')} onSubmit={onReceive} />}
  </>;
}
