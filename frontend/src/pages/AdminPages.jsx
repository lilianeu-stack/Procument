import { useState } from 'react';
import { Plus } from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage, FormActions } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import { dateLabel } from '../utils/format.js';

function UserForm({ departments, onClose, onSubmit }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'requestor', departmentId: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSubmit({ ...form, departmentId: form.departmentId ? Number(form.departmentId) : null }); onClose(); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }
  return <Modal title="Create user account" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" /></label>
    <label className="block text-xs font-bold">Work email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" /></label>
    <label className="block text-xs font-bold">Temporary password (12+ characters)<input required minLength="12" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="field" /></label>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs font-bold">Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="field">{['requestor', 'approver', 'procurement', 'committee', 'storekeeper', 'finance', 'admin'].map((role) => <option key={role}>{role}</option>)}</select></label>
      <label className="block text-xs font-bold">Department<select value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })} className="field"><option value="">None</option>{departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label>
    </div>
    <ErrorMessage>{error}</ErrorMessage><FormActions busy={busy} close={onClose} label="Create account" />
  </form></Modal>;
}

function DepartmentForm({ onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    try { await onSubmit({ name }); onClose(); }
    catch (exception) { setError(exception.message); }
  }
  return <Modal title="Add department" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-xs font-bold">Department name<input required value={name} onChange={(event) => setName(event.target.value)} className="field" /></label>
    <ErrorMessage>{error}</ErrorMessage>
    <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-xs font-bold">Cancel</button><button className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white">Add department</button></div>
  </form></Modal>;
}

export function UsersPage({ users, departments, onCreateUser, onToggleUser, onCreateDepartment }) {
  const [dialog, setDialog] = useState('');
  const [error, setError] = useState('');
  async function toggle(id, active) {
    try { await onToggleUser(id, active); setError(''); }
    catch (exception) { setError(exception.message); }
  }
  return <>
    <PageCard title="User administration" description={`${users.length} accounts · Manage roles and departments`} action={<div className="flex gap-2">
      <button onClick={() => setDialog('department')} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-brand">Add department</button>
      <button onClick={() => setDialog('user')} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white"><Plus size={14} />Add user</button>
    </div>}>
      {error && <div className="p-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {users.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Name', 'Email', 'Department', 'Role', 'Status', ''].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{users.map((person) => <tr key={person.id}><td className="px-5 py-4 font-bold">{person.name}</td><td className="px-5 py-4">{person.email}</td><td className="px-5 py-4">{person.department || '—'}</td><td className="px-5 py-4 capitalize">{person.role}</td><td className="px-5 py-4">{person.active ? 'Active' : 'Inactive'}</td><td className="px-5 py-4"><button onClick={() => toggle(person.id, !person.active)} className="rounded border px-2.5 py-1.5 font-bold">{person.active ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table></div> : <EmptyState>No user accounts are available.</EmptyState>}
    </PageCard>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{departments.map((department) => <div key={department.id} className="rounded-xl border border-slate-100 bg-white px-4 py-3 text-xs font-bold shadow-card">{department.name}</div>)}</div>
    {dialog === 'user' && <UserForm departments={departments} onClose={() => setDialog('')} onSubmit={onCreateUser} />}
    {dialog === 'department' && <DepartmentForm onClose={() => setDialog('')} onSubmit={onCreateDepartment} />}
  </>;
}

export function AuditLogsPage({ auditLogs }) {
  return <PageCard title="Audit log" description="Recent administrative and workflow activity">
    {auditLogs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['When', 'Actor', 'Action', 'Record', 'Details'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{auditLogs.map((log) => <tr key={log.id}><td className="px-5 py-4">{dateLabel(log.createdAt)}</td><td className="px-5 py-4">{log.actor || 'System'}</td><td className="px-5 py-4 font-bold capitalize">{log.action}</td><td className="px-5 py-4">{log.entityType} · {log.entityId}</td><td className="max-w-[260px] truncate px-5 py-4 text-muted">{typeof log.details === 'string' ? log.details : JSON.stringify(log.details || {})}</td></tr>)}</tbody></table></div> : <EmptyState>No audit events have been recorded.</EmptyState>}
  </PageCard>;
}
