import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';

function SupplierForm({ onClose, onSubmit }) {
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit(form); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Add supplier" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Supplier name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" /></label>
    <label className="block text-xs font-bold">Contact person<input value={form.contactName} onChange={(event) => setForm({ ...form, contactName: event.target.value })} className="field" /></label>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs font-bold">Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" /></label>
      <label className="block text-xs font-bold">Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="field" /></label>
    </div>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Add supplier" />
  </form></Modal>;
}

export default function SuppliersPage({ suppliers, user, search, onCreate }) {
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const canCreate = ['admin', 'procurement'].includes(user.role);
  const filtered = suppliers.filter((supplier) => `${supplier.name} ${supplier.contactName} ${supplier.email}`.toLowerCase().includes(search.toLowerCase()));

  async function create(form) {
    try { await onCreate(form); setError(''); }
    catch (exception) { setError(exception.message); throw exception; }
  }

  return <>
    <PageCard title="Supplier directory" description={`${suppliers.length} approved supplier partners`} action={canCreate && <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Add supplier</button>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Supplier', 'Contact', 'Email', 'Phone', 'Rating', 'Status'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{filtered.map((supplier) => <tr key={supplier.id}><td className="px-5 py-4 font-bold">{supplier.name}</td><td className="px-5 py-4">{supplier.contactName || '—'}</td><td className="px-5 py-4">{supplier.email || '—'}</td><td className="px-5 py-4">{supplier.phone || '—'}</td><td className="px-5 py-4 font-bold">★ {supplier.rating}</td><td className="px-5 py-4"><StatusBadge value={supplier.status === 'Active' ? 'Approved' : 'Rejected'} /></td></tr>)}</tbody></table></div> : <EmptyState>No suppliers match your search.</EmptyState>}
    </PageCard>
    {showForm && <SupplierForm onClose={() => setShowForm(false)} onSubmit={create} />}
  </>;
}
