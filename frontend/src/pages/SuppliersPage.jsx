import { useState } from 'react';
import { Building2, Mail, Plus, Star } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';

const addSupplierButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-black bg-reference px-4 py-2.5 text-xs font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';

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
    <PageCard
      className="shadow-dashboard"
      title="Supplier directory"
      description={`${filtered.length} of ${suppliers.length} registered suppliers`}
      action={canCreate && <button type="button" onClick={() => setShowForm(true)} className={addSupplierButtonClass}><Plus size={15} />Add supplier</button>}
    >
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {filtered.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: '21%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '15%' }} />
          </colgroup>
          <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black/55">
            <tr>{['Supplier', 'Contact', 'Email', 'Phone', 'Rating', 'Status'].map((cell) =>
              <th key={cell} className="whitespace-nowrap px-5 py-3.5 font-bold">{cell}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {filtered.map((supplier) => {
              const rating = Number(supplier.rating);
              const hasRating = supplier.rating !== null
                && supplier.rating !== undefined
                && String(supplier.rating).trim() !== ''
                && Number.isFinite(rating);
              return <tr key={supplier.id} className="transition-colors hover:bg-hover">
                <td className="px-5 py-4 align-middle">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand bg-white text-xs font-bold text-black" aria-hidden="true">
                      {supplier.name?.trim()?.charAt(0)?.toUpperCase() || <Building2 size={15} />}
                    </span>
                    <span className="break-words font-bold">{supplier.name}</span>
                  </div>
                </td>
                <td className="break-words px-5 py-4 align-middle">{supplier.contactName || '—'}</td>
                <td className="break-all px-5 py-4 align-middle">
                  {supplier.email
                    ? <span className="inline-flex items-center gap-2"><Mail size={13} className="shrink-0 text-black/45" aria-hidden="true" />{supplier.email}</span>
                    : '—'}
                </td>
                <td className="whitespace-nowrap px-5 py-4 align-middle">{supplier.phone || '—'}</td>
                <td className="whitespace-nowrap px-5 py-4 align-middle">
                  {hasRating
                    ? <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums"><Star size={13} fill="currentColor" aria-hidden="true" />{rating.toFixed(1)}</span>
                    : '—'}
                </td>
                <td className="px-5 py-4 align-middle">
                  <StatusBadge value={supplier.status === 'Active' ? 'Approved' : 'Rejected'} />
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div> : <EmptyState>
        <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10">
          <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand bg-white text-black">
            <Building2 size={22} strokeWidth={1.7} aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-sm font-bold text-black">
            {suppliers.length ? 'No suppliers match your search' : 'No suppliers registered yet'}
          </h3>
          <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
            {suppliers.length
              ? 'Try another supplier name, contact, or email address.'
              : 'Registered procurement partners will appear here.'}
          </p>
        </div>
      </EmptyState>}
    </PageCard>
    {showForm && <SupplierForm onClose={() => setShowForm(false)} onSubmit={create} />}
  </>;
}
