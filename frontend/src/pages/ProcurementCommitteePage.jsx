import { useRef, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';

function CommitteeMemberForm({ member, onClose, onSubmit }) {
  const [form, setForm] = useState({
    firstName: member?.firstName || '',
    lastName: member?.lastName || '',
    email: member?.email || '',
    phone: member?.phone || ''
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onSubmit(form);
      onClose();
    } catch (exception) {
      setError(exception.message || 'The committee member could not be saved.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <Modal
    title={member ? `Edit committee member · ${member.firstName} ${member.lastName}` : 'Add committee member'}
    onClose={() => !busy && onClose()}
    dismissible={!busy}
  >
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold">
          First name
          <input required maxLength={100} value={form.firstName}
            onChange={(event) => setForm({ ...form, firstName: event.target.value })} className="field" />
        </label>
        <label className="block text-xs font-bold">
          Last name
          <input required maxLength={100} value={form.lastName}
            onChange={(event) => setForm({ ...form, lastName: event.target.value })} className="field" />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold">
          Email
          <input required type="email" maxLength={190} value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" />
        </label>
        <label className="block text-xs font-bold">
          Phone number
          <input required type="tel" maxLength={50} value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })} className="field" />
        </label>
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" disabled={busy} onClick={onClose}
          className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-60">Cancel</button>
        <button type="submit" disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-60">
          {busy ? 'Saving…' : member ? 'Save changes' : 'Add member'}
        </button>
      </div>
    </form>
  </Modal>;
}

export default function ProcurementCommitteePage({ members = [], search = '', onCreate, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [deletingMember, setDeletingMember] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleting = useRef(false);
  const filteredMembers = members.filter((member) =>
    `${member.firstName} ${member.lastName} ${member.email} ${member.phone}`
      .toLowerCase().includes(search.trim().toLowerCase())
  );

  async function updateMember(form) {
    await onUpdate(editingMember.id, form);
    setEditingMember(null);
  }

  async function deleteMember() {
    if (!deletingMember || deleting.current) return;
    deleting.current = true;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      await onDelete(deletingMember.id);
      setDeletingMember(null);
    } catch (exception) {
      setDeleteError(exception.message || 'The committee member could not be deleted.');
    } finally {
      deleting.current = false;
      setDeleteBusy(false);
    }
  }

  return <>
    <PageCard
      title="Procurement Committee"
      description={`${members.length} committee contact${members.length === 1 ? '' : 's'}`}
      action={<button type="button" onClick={() => setShowForm(true)}
        className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black">
        <Plus size={14} />Add member
      </button>}
    >
      {filteredMembers.length ? <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase text-muted">
            <tr>{['First name', 'Last name', 'Email', 'Phone number', 'Actions'].map((heading) =>
              <th key={heading} className="px-5 py-3">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {filteredMembers.map((member) => <tr key={member.id}>
              <td className="px-5 py-4 font-bold">{member.firstName}</td>
              <td className="px-5 py-4">{member.lastName}</td>
              <td className="px-5 py-4">{member.email}</td>
              <td className="px-5 py-4">{member.phone}</td>
              <td className="px-5 py-4">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditingMember(member)}
                    aria-label={`Edit ${member.firstName} ${member.lastName}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-bold hover:bg-slate-50">
                    <Pencil size={13} />Edit
                  </button>
                  <button type="button" onClick={() => { setDeletingMember(member); setDeleteError(''); }}
                    aria-label={`Delete ${member.firstName} ${member.lastName}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 font-bold text-red-600 hover:bg-red-50">
                    <Trash2 size={13} />Delete
                  </button>
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </div> : <EmptyState>{members.length ? 'No committee members match your search.' : 'No committee members have been added.'}</EmptyState>}
    </PageCard>
    {showForm && <CommitteeMemberForm onClose={() => setShowForm(false)} onSubmit={onCreate} />}
    {editingMember && <CommitteeMemberForm key={editingMember.id} member={editingMember}
      onClose={() => setEditingMember(null)} onSubmit={updateMember} />}
    {deletingMember && <Modal
      title={`Delete committee member · ${deletingMember.firstName} ${deletingMember.lastName}`}
      onClose={() => !deleteBusy && setDeletingMember(null)}
      dismissible={!deleteBusy}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          Permanently delete <strong>{deletingMember.firstName} {deletingMember.lastName}</strong> from the committee contact directory?
        </p>
        <ErrorMessage>{deleteError}</ErrorMessage>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" disabled={deleteBusy} onClick={() => setDeletingMember(null)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-60">Cancel</button>
          <button type="button" disabled={deleteBusy} onClick={deleteMember}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-black disabled:opacity-60">
            {deleteBusy ? 'Deleting…' : 'Delete member'}
          </button>
        </div>
      </div>
    </Modal>}
  </>;
}
