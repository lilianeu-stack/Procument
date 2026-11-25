import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';

function SupplierForm({ supplier, onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: supplier?.name || '',
    email: supplier?.email || '',
    phone: supplier?.phone || ''
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit(form); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title={supplier ? `Edit supplier · ${supplier.name}` : 'Add supplier'} onClose={onClose} dismissible={!busy}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Supplier name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" /></label>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs font-bold">Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" /></label>
      <label className="block text-xs font-bold">Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="field" /></label>
    </div>
    <ErrorMessage>{error}</ErrorMessage>
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
      <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-60">Cancel</button>
      <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
        {busy ? 'Saving…' : supplier ? 'Save changes' : 'Add supplier'}
      </button>
    </div>
  </form></Modal>;
}

export default function SuppliersPage({ suppliers, user, search, onCreate, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [deletingSupplier, setDeletingSupplier] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [error, setError] = useState('');
  const canCreate = ['admin', 'procurement'].includes(user.role);
  const activeSuppliers = suppliers.filter((supplier) => supplier.status === 'Active');
  const filtered = activeSuppliers.filter((supplier) => `${supplier.name} ${supplier.contactName || ''} ${supplier.email || ''} ${supplier.phone || ''}`.toLowerCase().includes(search.toLowerCase()));

  async function create(form) {
    try { await onCreate(form); setError(''); }
    catch (exception) { setError(exception.message); throw exception; }
  }

  async function update(form) {
    try { await onUpdate(editingSupplier.id, form); setError(''); setEditingSupplier(null); }
    catch (exception) { setError(exception.message); throw exception; }
  }

  async function deleteSupplier() {
    if (!deletingSupplier || deleteBusy) return;
    setDeleteBusy(true); setDeleteError('');
    try {
      await onDelete(deletingSupplier.id);
      setDeletingSupplier(null);
    } catch (exception) {
      setDeleteError(exception.message || 'The supplier could not be removed.');
    } finally { setDeleteBusy(false); }
  }

  return <>
    <PageCard title="Supplier directory" description={`${activeSuppliers.length} approved supplier partners`} action={canCreate && <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Add supplier</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Supplier', 'Contact', 'Email', 'Phone', ...(canCreate ? ['Actions'] : [])].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{filtered.map((supplier) => <tr key={supplier.id}><td className="px-5 py-4 font-bold">{supplier.name}</td><td className="px-5 py-4">{supplier.contactName || '—'}</td><td className="px-5 py-4">{supplier.email || '—'}</td><td className="px-5 py-4">{supplier.phone || '—'}</td>{canCreate && <td className="px-5 py-4"><div className="flex gap-2">
        <button type="button" onClick={() => setEditingSupplier(supplier)} aria-label={`Edit ${supplier.name}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50"><Pencil size={13} />Edit</button>
        <button type="button" onClick={() => { setDeletingSupplier(supplier); setDeleteError(''); }} aria-label={`Delete ${supplier.name}`} className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 font-bold text-red-600 hover:bg-red-50"><Trash2 size={13} />Delete</button>
      </div></td>}</tr>)}</tbody></table></div> : <EmptyState>{activeSuppliers.length ? 'No suppliers match your search.' : 'No approved suppliers have been added.'}</EmptyState>}
    </PageCard>
    {showForm && <SupplierForm onClose={() => setShowForm(false)} onSubmit={create} />}
    {editingSupplier && <SupplierForm key={editingSupplier.id} supplier={editingSupplier} onClose={() => setEditingSupplier(null)} onSubmit={update} />}
    {deletingSupplier && <Modal title={`Remove supplier · ${deletingSupplier.name}`} onClose={() => !deleteBusy && setDeletingSupplier(null)} dismissible={!deleteBusy}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">Remove <strong>{deletingSupplier.name}</strong> from the active supplier directory? RFQ and quotation history will be kept, and this supplier will no longer be available for new invitations.</p>
        <ErrorMessage>{deleteError}</ErrorMessage>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" disabled={deleteBusy} onClick={() => setDeletingSupplier(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-60">Cancel</button>
          <button type="button" disabled={deleteBusy} onClick={deleteSupplier} className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-60">{deleteBusy ? 'Removing…' : 'Remove supplier'}</button>
        </div>
      </div>
    </Modal>}
  </>;
}
