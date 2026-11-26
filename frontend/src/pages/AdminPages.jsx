import { useRef, useState } from 'react';
import {
  AlertTriangle, Ban, Building2, CheckCircle2, ChevronLeft, Download, Eye,
  FileSpreadsheet, KeyRound, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw,
  Search, Trash2, Upload, Users, X
} from 'lucide-react';
import PageCard, { EmptyState, ErrorMessage } from '../components/ui/PageCard.jsx';
import Modal from '../components/ui/Modal.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { dateLabel } from '../utils/format.js';
import { csvRowsToUsers, downloadCsv, parseCsv } from '../utils/csv.js';
import { departmentDependencyText, requiresDepartmentReassignment } from '../utils/deletePolicy.js';

const ROLES = ['supervisor', 'requestor', 'approver', 'procurement', 'committee', 'storekeeper', 'finance', 'admin'];
const ROLE_LABELS = {
  supervisor: 'Department Supervisor',
  requestor: 'Requester',
  storekeeper: 'Stock Keeper',
  admin: 'Administrator'
};
const TEMPLATE_HEADERS = ['First Name', 'Last Name', 'Email', 'Role', 'Subdepartment', 'Phone Number'];
const USERS_PAGE_SIZE = 8;
const primaryActionClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-black bg-reference px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2';
const secondaryActionClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-brand bg-white px-3.5 py-2 text-xs font-semibold text-black transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';
const iconActionClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-brand bg-white text-black transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50';

function Notice({ notice, onClose }) {
  if (!notice) return null;
  return <div role="status" className={`fixed right-4 top-4 z-[60] flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 text-xs  ${notice.type === 'error' ? 'border-brand bg-white text-black' : 'border-brand bg-white text-black'}`}>
    <span className="flex-1">{notice.message}</span>
    <button onClick={onClose} aria-label="Dismiss" className="rounded p-0.5 hover:bg-white"><X size={14} /></button>
  </div>;
}

function UserForm({ departments, initial, defaultDepartmentId, onClose, onSubmit }) {
  const editing = Boolean(initial);
  const [form, setForm] = useState({
    name: initial?.name || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    password: '',
    role: initial?.role || 'requestor',
    departmentId: initial?.departmentId
      ? String(initial.departmentId)
      : defaultDepartmentId ? String(defaultDepartmentId) : '',
    replaceSupervisor: false
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const payload = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      role: form.role,
      departmentId: form.departmentId ? Number(form.departmentId) : null,
      replaceSupervisor: form.role === 'supervisor' ? form.replaceSupervisor : false
    };
    if (!editing) payload.password = form.password;
    try {
      await onSubmit(payload, initial?.id);
      onClose();
    } catch (exception) {
      setError(exception.message);
    } finally { setBusy(false); }
  }

  return <Modal title={editing ? `Edit account · ${initial.name}` : 'Add User'} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold">Full name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" /></label>
        <label className="block text-xs font-bold">Work email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="field" /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-bold">Phone number <span className="font-normal text-muted">(optional)</span><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className="field" /></label>
        <label className="block text-xs font-bold">Role<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className="field">{ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role] || role}</option>)}</select></label>
      </div>
      <label className="block text-xs font-bold">Subdepartment<select required={['supervisor', 'requestor', 'storekeeper'].includes(form.role)} value={form.departmentId} onChange={(event) => setForm({ ...form, departmentId: event.target.value })} className="field"><option value="">Select a subdepartment…</option>{Object.entries(departments.reduce((groups, department) => {
        const parent = department.parentName || 'Other';
        (groups[parent] ||= []).push(department);
        return groups;
      }, {})).map(([parent, children]) => <optgroup key={parent} label={parent}>{children.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</optgroup>)}</select></label>
      {['supervisor', 'requestor', 'storekeeper'].includes(form.role) && <p className="-mt-2 text-[11px] text-muted">
        {form.role === 'supervisor'
          ? 'Each subdepartment can have only one active Supervisor. The Supervisor must belong to the subdepartment they oversee.'
          : form.role === 'requestor'
            ? 'The Requester must belong to the subdepartment where they work.'
            : 'The Stock Keeper must be assigned to the subdepartment they support.'}
      </p>}
      {form.role === 'supervisor' && <label className="flex items-start gap-2 rounded-lg border border-brand bg-white p-3 text-[11px] text-black">
        <input type="checkbox" checked={form.replaceSupervisor} onChange={(event) => setForm({ ...form, replaceSupervisor: event.target.checked })} className="mt-0.5" />
        <span><span className="font-bold">Replace existing Supervisor</span> — deactivate the current Supervisor in this subdepartment when saving.</span>
      </label>}
      {!editing && <label className="block text-xs font-bold">Temporary password (12+ characters)<input required minLength="12" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className="field" /></label>}
      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold">Cancel</button>
        <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-60">{busy ? 'Saving…' : editing ? 'Save changes' : 'Create account'}</button>
      </div>
    </form>
  </Modal>;
}

function DepartmentForm({ initial, parentId, parentName, onClose, onSubmit }) {
  const editing = Boolean(initial);
  const isSubdepartment = Boolean(parentId);
  const kind = isSubdepartment ? 'subdepartment' : 'department';
  const [form, setForm] = useState({ name: initial?.name || '', description: initial?.description || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ name: form.name.trim(), description: form.description.trim(), parentId: parentId || null }, initial?.id);
      onClose();
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  const title = editing
    ? `Edit ${kind} · ${initial.name}`
    : isSubdepartment ? `Add subdepartment in ${parentName}` : 'Add department';

  return <Modal title={title} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      {isSubdepartment && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">Inside <span className="font-bold text-slate-700">{parentName}</span></p>}
      <label className="block text-xs font-bold capitalize">{kind} name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="field" /></label>
      <label className="block text-xs font-bold">Description <span className="font-normal text-muted">(optional)</span><textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="field h-auto py-2" /></label>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold">Cancel</button>
        <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-60">{busy ? 'Saving…' : editing ? 'Save changes' : `Add ${kind}`}</button>
      </div>
    </form>
  </Modal>;
}

function ConfirmDialog({ title, message, confirmLabel = 'Confirm Delete', onClose, onConfirm, busy, error, disabled = false, children }) {
  return <Modal title={title} onClose={onClose} dismissible={!busy}>
    <div role="alertdialog" aria-modal="true" className="space-y-4">
      <p className="text-sm text-slate-600">{message}</p>
      {children}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" disabled={busy} onClick={onClose} aria-label="Cancel deletion" className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy || disabled} onClick={onConfirm} aria-label={confirmLabel} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-black disabled:cursor-not-allowed disabled:opacity-60">
          {busy && <LoaderCircle size={14} className="animate-spin" />}{busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </div>
  </Modal>;
}

function ResetPasswordDialog({ user, onClose, onSubmit }) {
  const [password, setPassword] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setResult(await onSubmit(user.id, password || undefined));
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  return <Modal title={`Reset password · ${user.name}`} onClose={onClose}>
    {result ? <div className="space-y-4">
      <p className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-black"><CheckCircle2 size={16} /> Password reset successfully. Hash and audit event were saved.</p>
      {result.temporaryPassword ? <>
        <p className="text-xs text-black">Copy this one-time temporary password and share it securely. It will not be shown again.</p>
        <div className="flex gap-2">
          <input readOnly value={result.temporaryPassword} className="field font-mono text-xs" />
          <button type="button" onClick={() => navigator.clipboard?.writeText(result.temporaryPassword)} className="rounded-lg border px-3 text-xs font-bold">Copy</button>
        </div>
      </> : <p className="text-xs text-black">The supplied password is now active.</p>}
      <div className="flex justify-end"><button onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black">Done</button></div>
    </div> : <form onSubmit={submit} className="space-y-4">
      <p className="text-xs text-black">Leave blank to generate a secure temporary password, or enter one of at least 12 characters.</p>
      <label className="block text-xs font-bold">Temporary password <span className="font-normal text-muted">(optional)</span><input type="password" minLength="12" value={password} onChange={(event) => setPassword(event.target.value)} className="field" /></label>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="flex justify-end gap-2 border-t border-subtle pt-4">
        <button type="button" onClick={onClose} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold">Cancel</button>
        <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-60">{busy ? 'Resetting…' : 'Reset password'}</button>
      </div>
    </form>}
  </Modal>;
}

function UserDetailsDialog({ data, onClose }) {
  const { account, activity } = data;
  return <Modal title={`Account details · ${account.name}`} onClose={onClose}>
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-xs">
        {[['Email', account.email], ['Role', account.role], ['Status', account.active ? 'Active' : 'Inactive'], ['Created', dateLabel(account.createdAt)]].map(([label, value]) => <div key={label} className="rounded-lg border border-brand bg-white p-3"><dt className="text-[10px] uppercase text-muted">{label}</dt><dd className="mt-1 font-bold">{value}</dd></div>)}
      </dl>
      <div>
        <h3 className="mb-2 text-xs font-bold">Recent activity</h3>
        <div className="max-h-56 space-y-2 overflow-y-auto">
          {activity.length ? activity.map((item) => <div key={item.id} className="flex items-center justify-between rounded-lg border border-brand px-3 py-2 text-xs"><span className="capitalize">{item.action.replace(/_/g, ' ')}</span><span className="text-muted">{dateLabel(item.createdAt)}</span></div>) : <EmptyState>No activity recorded.</EmptyState>}
        </div>
      </div>
      <div className="flex justify-end"><button onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black">Close</button></div>
    </div>
  </Modal>;
}

function BulkImportDialog({ departments, defaultDepartment, onValidate, onImport, onClose }) {
  const inputRef = useRef(null);
  const [report, setReport] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function downloadTemplate() {
    downloadCsv('procurement-users-template.csv', [
      TEMPLATE_HEADERS,
      ['Jane', 'Doe', 'jane.doe@example.org', 'requestor', defaultDepartment?.name || departments[0]?.name || 'Administration Office', '+250 700 000 000']
    ]);
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setSummary(null);
    setBusy(true);
    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) throw new Error('The file contains no user rows.');
      const parsed = csvRowsToUsers(rows);
      const users = defaultDepartment?.name
        ? parsed.map((user) => ({ ...user, department: String(user.department || '').trim() || defaultDepartment.name }))
        : parsed;
      setReport(await onValidate(users));
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  async function importValid() {
    setBusy(true);
    setError('');
    try {
      const result = await onImport(report.rows.map(({ name, email, role, department, phone }) => ({
        name, email, role, department, phone
      })));
      setSummary(result);
    } catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  function downloadErrors() {
    downloadCsv('procurement-users-import-errors.csv', [
      ['Row', 'Name', 'Email', 'Role', 'Subdepartment', 'Errors'],
      ...report.rows.filter((row) => !row.valid).map((row) => [row.row, row.name, row.email, row.role, row.department, row.errors.join('; ')])
    ]);
  }

  function downloadCredentials() {
    downloadCsv('procurement-users-credentials.csv', [
      ['Row', 'Name', 'Email', 'Temporary password'],
      ...summary.imported.map((row) => [row.row, row.name, row.email, row.temporaryPassword])
    ]);
  }

  return <Modal title="Add users by template" onClose={onClose}>
    <div className="space-y-4">
      {!summary && <>
        <div className="flex flex-wrap gap-2">
          <button onClick={downloadTemplate} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"><Download size={14} />Download CSV template</button>
          <button onClick={() => inputRef.current?.click()} className="flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black"><Upload size={14} />Choose completed file</button>
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="hidden" />
        </div>
        <p className="text-xs text-muted">CSV opens in Excel. Required columns: First Name, Last Name, Email, Role, Subdepartment. Phone Number is optional. A secure temporary password is generated for every imported account.{defaultDepartment?.name ? ` Rows with a blank Subdepartment will be assigned to ${defaultDepartment.name}.` : ''}</p>
        <ErrorMessage>{error}</ErrorMessage>
        {busy && <p className="text-xs text-muted">Validating file…</p>}
        {report && <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-xs font-bold">
            <span className="text-black">{report.validCount} valid</span>
            <span className="text-black">{report.invalidCount} invalid</span>
            {report.invalidCount > 0 && <button onClick={downloadErrors} className="flex items-center gap-1 text-black underline"><FileSpreadsheet size={13} />Download error report</button>}
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-brand">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Subdepartment</th><th className="px-3 py-2">Result</th></tr></thead>
              <tbody className="divide-y">{report.rows.map((row) => <tr key={row.row}><td className="px-3 py-2">{row.row}</td><td className="px-3 py-2"><div className="font-bold">{row.name || '—'}</div><div className="text-muted">{row.email}</div></td><td className="px-3 py-2">{row.role}</td><td className="px-3 py-2">{row.department}</td><td className="px-3 py-2">{row.valid ? <span className="text-emerald-700">Ready</span> : <span className="text-red-700">{row.errors.join(', ')}</span>}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2 border-t border-subtle pt-4">
            <button onClick={onClose} className="rounded-lg border px-4 py-2 text-xs font-bold">Cancel</button>
            <button disabled={!report.validCount || busy} onClick={importValid} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-60">{busy ? 'Importing…' : `Import ${report.validCount} user(s)`}</button>
          </div>
        </div>}
      </>}
      {summary && <div className="space-y-4">
        <div className="rounded-lg bg-white px-3 py-3 text-xs text-black"><strong>{summary.imported.length} user(s) imported.</strong> {summary.failed.length ? `${summary.failed.length} row(s) failed validation and were skipped.` : 'All rows were imported.'}</div>
        <div className="flex flex-wrap gap-2">
          {summary.imported.length > 0 && <button onClick={downloadCredentials} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"><Download size={14} />Download temporary passwords</button>}
          {summary.failed.length > 0 && <button onClick={downloadErrors} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold"><FileSpreadsheet size={14} />Download error report</button>}
        </div>
        {summary.failed.length > 0 && <div className="max-h-40 overflow-auto rounded-lg border border-brand text-xs">{summary.failed.map((row) => <div key={row.row} className="border-b px-3 py-2 last:border-0">Row {row.row} · {row.email || '—'} · {row.errors.join(', ')}</div>)}</div>}
        <div className="flex justify-end"><button onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black">Done</button></div>
      </div>}
    </div>
  </Modal>;
}

export function UsersPage({
  users, departments, onCreateUser, onToggleUser, onCreateDepartment, onDepartmentUsers,
  onUpdateDepartment, onDeleteDepartment, onUpdateUser, onDeleteUser,
  onResetPassword, onBulkValidate, onBulkImport, onUserActivity
}) {
  const [dialog, setDialog] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState(null);
  const [selectedSubdepartment, setSelectedSubdepartment] = useState(null);
  const [creatingSubdepartmentIn, setCreatingSubdepartmentIn] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedDepartmentForEdit, setSelectedDepartmentForEdit] = useState(null);
  const [selectedDepartmentForDelete, setSelectedDepartmentForDelete] = useState(null);
  const [requestedActive, setRequestedActive] = useState(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [reassignTo, setReassignTo] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [details, setDetails] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [departmentUsers, setDepartmentUsers] = useState(null);
  const [departmentMeta, setDepartmentMeta] = useState(null);
  const [departmentLoading, setDepartmentLoading] = useState(false);
  const [departmentError, setDepartmentError] = useState('');
  const [pageIndex, setPageIndex] = useState(1);
  const requestSequence = useRef(0);
  const dialogSubmitting = useRef(false);

  const topLevelDepartments = departments.filter((department) => department.parentId === null || department.parentId === undefined);
  const subdepartments = departments.filter((department) => department.parentId !== null && department.parentId !== undefined);
  const isAllUsersView = selectedDepartment === 'all';
  const isDepartmentView = typeof selectedDepartment === 'number';
  const isSubdepartmentView = typeof selectedSubdepartment === 'number';
  const currentSubdepartments = isDepartmentView
    ? subdepartments.filter((department) => department.parentId === selectedDepartment)
    : [];
  const parentOfSelected = departments.find((department) => department.id === selectedDepartment);
  const activeDepartment = isSubdepartmentView
    ? (departmentMeta || departments.find((department) => department.id === selectedSubdepartment))
    : isDepartmentView ? parentOfSelected : null;
  const sourceUsers = isAllUsersView ? users : (departmentUsers ?? []);
  const statusMatches = (person) => statusFilter === 'all'
    || (statusFilter === 'active' ? person.active : !person.active);
  const statusUsers = sourceUsers.filter(statusMatches);
  const visibleUsers = statusUsers
    .filter((person) => (!roleFilter || person.role === roleFilter))
    .filter((person) => `${person.name} ${person.email} ${person.role} ${person.department} ${person.phone || ''}`.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(visibleUsers.length / USERS_PAGE_SIZE));
  const safePage = Math.min(pageIndex, totalPages);
  const startIndex = (safePage - 1) * USERS_PAGE_SIZE;
  const pagedUsers = visibleUsers.slice(startIndex, startIndex + USERS_PAGE_SIZE);
  const activeAccountCount = users.filter((person) => person.active).length;
  const totalAccounts = isAllUsersView
    ? (statusFilter === 'all' ? users.length : statusUsers.length)
    : (departmentUsers ? statusUsers.length : (departmentMeta?.userCount ?? activeDepartment?.userCount ?? 0));

  function notify(message, type = 'success') { setNotice({ message, type }); }
  function closeDialog(force = false) {
    if (dialogSubmitting.current && !force) return;
    setDialog('');
    setDialogError('');
    setSelectedUser(null);
    setCreatingSubdepartmentIn(null);
    setSelectedDepartmentForEdit(null);
    setSelectedDepartmentForDelete(null);
    setRequestedActive(null);
    setReassignTo('');
  }

  // Confirmation dialogs use their own single-flight guard so a double click
  // cannot issue two DELETE/PATCH requests before React re-renders.
  async function runConfirmed(action, successMessage, onSuccess) {
    if (dialogSubmitting.current) return;
    dialogSubmitting.current = true;
    setDialogBusy(true);
    setDialogError('');
    try {
      const result = await action();
      notify(successMessage);
      if (onSuccess) onSuccess(result);
      closeDialog(true);
    } catch (exception) {
      const message = exception?.message || 'The action could not be completed.';
      setDialogError(message);
      notify(message, 'error');
    } finally {
      dialogSubmitting.current = false;
      setDialogBusy(false);
    }
  }

  function updateDepartmentUser(userId, changes) {
    setDepartmentUsers((current) => current
      ? current.map((person) => person.id === userId ? { ...person, ...changes } : person)
      : current);
    if (typeof changes.active === 'boolean') {
      setDepartmentMeta((current) => current ? {
        ...current,
        activeUserCount: Math.max(0, Number(current.activeUserCount || 0) + (changes.active ? 1 : -1))
      } : current);
    }
  }

  function removeDepartmentUser(userId) {
    setDepartmentUsers((current) => current ? current.filter((person) => person.id !== userId) : current);
    setDepartmentMeta((current) => current ? {
      ...current,
      userCount: Math.max(0, Number(current.userCount || 0) - 1),
      activeUserCount: Math.max(0, Number(current.activeUserCount || 0) - 1)
    } : current);
  }

  function resetView() {
    requestSequence.current += 1;
    setSelectedDepartment(null);
    setSelectedSubdepartment(null);
    setDepartmentUsers(null);
    setDepartmentMeta(null);
    setDepartmentError('');
    setDepartmentLoading(false);
    setSearch('');
    setRoleFilter('');
    setStatusFilter('active');
    setPageIndex(1);
    setMenuFor(null);
  }

  // Opening a top-level department shows its subdepartments. No user fetch is
  // needed here because each subdepartment already carries its own user counts.
  function openDepartment(id) {
    requestSequence.current += 1;
    setSelectedDepartment(id);
    setSelectedSubdepartment(null);
    setDepartmentUsers(null);
    setDepartmentMeta(null);
    setDepartmentError('');
    setDepartmentLoading(false);
    setSearch('');
    setRoleFilter('');
    setStatusFilter('active');
    setPageIndex(1);
    setMenuFor(null);
  }

  async function openSubdepartment(id) {
    const sequence = ++requestSequence.current;
    setSelectedSubdepartment(id);
    setSearch('');
    setRoleFilter('');
    setStatusFilter('active');
    setPageIndex(1);
    setMenuFor(null);
    setDepartmentUsers(null);
    setDepartmentMeta(null);
    setDepartmentError('');
    setDepartmentLoading(true);
    try {
      const result = await onDepartmentUsers(id);
      if (sequence !== requestSequence.current) return;
      setDepartmentUsers(result.users);
      setDepartmentMeta(result.department);
    } catch (exception) {
      if (sequence !== requestSequence.current) return;
      setDepartmentError(exception.message || 'Unable to load users for this subdepartment.');
      setDepartmentUsers([]);
    } finally {
      if (sequence === requestSequence.current) setDepartmentLoading(false);
    }
  }

  function refreshCurrentDepartment() {
    if (typeof selectedSubdepartment === 'number') openSubdepartment(selectedSubdepartment);
  }

  async function run(action, successMessage) {
    setBusy(true);
    try {
      const result = await action();
      notify(successMessage);
      return result;
    } catch (exception) {
      notify(exception.message, 'error');
      throw exception;
    } finally { setBusy(false); }
  }

  async function viewDetails(person) {
    try {
      setDetails(await onUserActivity(person.id));
      setDialog('details');
    } catch (exception) { notify(exception.message, 'error'); }
  }

  return <>
    <Notice notice={notice} onClose={() => setNotice(null)} />

    {selectedDepartment === null ? <PageCard
      title="Users Management"
      description={`${topLevelDepartments.length} departments · ${subdepartments.length} subdepartments · ${activeAccountCount} active accounts`}
      className="shadow-dashboard"
      action={<div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDialog('department')} className={secondaryActionClass}><Building2 size={14} />Add department</button>
        <button type="button" onClick={() => setDialog('user')} className={primaryActionClass}><Plus size={14} />Add user</button>
        <button type="button" onClick={() => setDialog('bulk')} className={secondaryActionClass}><FileSpreadsheet size={14} />Add users by template</button>
      </div>}
    >
      <div className="overflow-x-auto p-5">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Department</th>
              <th className="px-4 py-3">Subdepartments</th>
              <th className="px-4 py-3">Active users</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr
              key="all-users"
              role="button"
              tabIndex={0}
              onClick={() => openDepartment('all')}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDepartment('all'); } }}
              className="cursor-pointer transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand/30"
            >
              <td className="px-4 py-3 font-extrabold text-brand">All Users</td>
              <td className="px-4 py-3 text-muted">All subdepartments</td>
              <td className="px-4 py-3 font-bold">{activeAccountCount}</td>
              <td className="px-4 py-3 text-muted">Accounts across every subdepartment</td>
              <td className="px-4 py-3 text-right"><button onClick={(event) => { event.stopPropagation(); openDepartment('all'); }} className="rounded-lg bg-brand px-3 py-1.5 font-bold text-black">Manage users</button></td>
            </tr>
            {topLevelDepartments.map((department) => {
              const children = subdepartments.filter((item) => item.parentId === department.id);
              const childUsers = children.reduce((total, child) => total + Number(child.activeUserCount || 0), 0);
              return <tr
                key={department.id}
                role="button"
                tabIndex={0}
                onClick={() => openDepartment(department.id)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDepartment(department.id); } }}
                className="cursor-pointer transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand/30"
              >
                <td className="px-4 py-3"><div className="flex items-center gap-2"><Building2 size={14} className="text-muted" /><span className="font-extrabold">{department.name}</span></div></td>
                <td className="px-4 py-3 font-bold">{children.length}</td>
                <td className="px-4 py-3 font-bold">{childUsers}</td>
                <td className="px-4 py-3 text-muted">{department.description || 'No description provided.'}</td>
                <td className="px-4 py-3 text-right"><div className="flex justify-end gap-1">
                  <button onClick={(event) => { event.stopPropagation(); openDepartment(department.id); }} className="rounded-lg bg-slate-900 px-3 py-1.5 font-bold text-black">View subdepartments</button>
                  <button disabled={busy || dialogBusy} onClick={(event) => { event.stopPropagation(); setSelectedDepartmentForDelete(department); setReassignTo(''); setDialog('delete-department'); }} aria-label={`Delete ${department.name}`} className="rounded-lg border px-2.5 py-1.5 font-bold text-red-600 disabled:opacity-50"><Trash2 size={14} /></button>
                  <button onClick={(event) => { event.stopPropagation(); setSelectedDepartmentForEdit(department); setDialog('department'); }} aria-label={`Edit ${department.name}`} className="rounded-lg border px-2.5 py-1.5 font-bold"><Pencil size={14} /></button>
                </div></td>
              </tr>;
            })}
            {!topLevelDepartments.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">No departments have been created yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </PageCard> : (isDepartmentView && !isSubdepartmentView) ? <PageCard
      title={`${parentOfSelected?.name || 'Department'} · Subdepartments`}
      description="Create a subdepartment inside this department, then add users inside that subdepartment."
      action={<div className="flex flex-wrap gap-2">
        <button onClick={resetView} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold"><ChevronLeft size={14} />Back to Departments</button>
        <button onClick={() => { setCreatingSubdepartmentIn(parentOfSelected); setDialog('department'); }} className="flex items-center gap-1 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black"><Plus size={14} />Add subdepartment</button>
      </div>}
    >
      <div className="overflow-x-auto p-5">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Subdepartment</th>
              <th className="px-4 py-3">Active users</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {currentSubdepartments.map((department) => <tr
              key={department.id}
              role="button"
              tabIndex={0}
              onClick={() => openSubdepartment(department.id)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSubdepartment(department.id); } }}
              className="cursor-pointer transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand/30"
            >
              <td className="px-4 py-3"><div className="flex items-center gap-2"><Users size={14} className="text-muted" /><span className="font-extrabold">{department.name}</span></div></td>
              <td className="px-4 py-3 font-bold">{department.activeUserCount ?? department.userCount ?? 0}</td>
              <td className="px-4 py-3 text-muted">{department.description || 'No description provided.'}</td>
              <td className="px-4 py-3 text-right"><div className="flex justify-end gap-1">
                <button onClick={(event) => { event.stopPropagation(); openSubdepartment(department.id); }} className="rounded-lg bg-slate-900 px-3 py-1.5 font-bold text-black">Manage users</button>
                <button disabled={busy || dialogBusy} onClick={(event) => { event.stopPropagation(); setSelectedDepartmentForDelete(department); setReassignTo(''); setDialog('delete-department'); }} aria-label={`Delete ${department.name}`} className="rounded-lg border px-2.5 py-1.5 font-bold text-red-600 disabled:opacity-50"><Trash2 size={14} /></button>
                <button onClick={(event) => { event.stopPropagation(); setSelectedDepartmentForEdit(department); setDialog('department'); }} aria-label={`Edit ${department.name}`} className="rounded-lg border px-2.5 py-1.5 font-bold"><Pencil size={14} /></button>
              </div></td>
            </tr>)}
            {!currentSubdepartments.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">No subdepartments yet. Add one to start adding users.</td></tr>}
          </tbody>
        </table>
      </div>
    </PageCard> : <section className="overflow-hidden rounded-xl border border-brand bg-white shadow-dashboard">
      <div className="flex flex-col gap-5 border-b border-subtle px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          {isSubdepartmentView ? <button onClick={() => openDepartment(selectedDepartment)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold"><ChevronLeft size={14} />Back to {parentOfSelected?.name || 'subdepartments'}</button>
            : <button onClick={resetView} className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold"><ChevronLeft size={14} />Back to Departments</button>}
          <h2 className="mt-4 text-xl font-extrabold tracking-tight">{isAllUsersView ? 'All Users' : activeDepartment?.name || 'Subdepartment'}</h2>
          {!isAllUsersView && activeDepartment?.description && <p className="mt-1 max-w-2xl text-xs text-muted">{activeDepartment.description}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-brand/10 px-3 py-1 font-bold text-brand">{totalAccounts} total user(s)</span>
            <span className="text-muted">{isAllUsersView ? 'Accounts from every subdepartment' : `${parentOfSelected?.name || 'Department'} → ${activeDepartment?.name || 'Subdepartment'}`}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDialog('user')} className={primaryActionClass}><Plus size={14} />Add user</button>
          <button type="button" onClick={() => setDialog('bulk')} className={secondaryActionClass}><FileSpreadsheet size={14} />Add users by template</button>
          {!isAllUsersView && <button type="button" onClick={() => openDepartment('all')} className={secondaryActionClass}>All users</button>}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-subtle px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPageIndex(1); }} placeholder="Search name, email, role…" className="field w-full pl-8 sm:w-64" />
          </div>
          <select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value); setPageIndex(1); }} aria-label="Filter by role" className="field w-40"><option value="">All roles</option>{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select>
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPageIndex(1); }} aria-label="Filter by status" className="field w-40"><option value="active">Active accounts</option><option value="inactive">Inactive accounts</option><option value="all">All accounts</option></select>
        </div>
        <p className="text-xs text-muted">{departmentLoading ? 'Loading users…' : `${visibleUsers.length} account(s) shown · page ${safePage} of ${totalPages}`}</p>
      </div>

      {departmentLoading ? <div role="status" className="grid min-h-40 place-items-center gap-2 text-xs text-muted"><LoaderCircle size={20} className="animate-spin text-black" />Loading users…</div>
        : departmentError ? <div role="alert" className="m-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand bg-white px-4 py-3 text-xs text-black">
          <span>{departmentError}</span>
          <button onClick={() => openDepartment(selectedDepartment)} className="flex items-center gap-1 rounded-lg border border-brand bg-white px-3 py-1.5 font-bold"><RefreshCw size={13} />Retry</button>
        </div>
        : pagedUsers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1100px] table-fixed text-left text-xs">
          <colgroup>
            <col style={{ width: '13%' }} /><col style={{ width: '16%' }} />
            <col style={{ width: '12%' }} /><col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} /><col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} /><col style={{ width: '18%' }} />
          </colgroup>
          <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black/55"><tr>{['Full Name', 'Email', 'Role', 'Subdepartment', 'Phone Number', 'Account Status', 'Date Created', 'Actions'].map((cell) => <th key={cell} className="whitespace-nowrap px-4 py-3.5 font-bold">{cell}</th>)}</tr></thead>
          <tbody className="divide-y divide-subtle">{pagedUsers.map((person) => <tr key={person.id} className="transition-colors hover:bg-hover">
            <td className="break-words px-4 py-4 align-middle font-semibold">{person.name}</td>
            <td className="break-all px-4 py-4 align-middle">{person.email}</td>
            <td className="px-4 py-4 align-middle capitalize">{ROLE_LABELS[person.role] || person.role}</td>
            <td className="break-words px-4 py-4 align-middle">{person.department || <span className="text-muted">Unassigned</span>}</td>
            <td className="px-4 py-4 align-middle">{person.phone || '—'}</td>
            <td className="px-4 py-4 align-middle"><StatusBadge value={person.active ? 'Active' : 'Inactive'} /></td>
            <td className="whitespace-nowrap px-4 py-4 align-middle text-muted">{dateLabel(person.createdAt)}</td>
            <td className="px-4 py-4 align-middle"><div className="flex items-center gap-1.5">
              <button type="button" onClick={() => viewDetails(person)} title="View account details" aria-label="View account details" className={iconActionClass}><Eye size={15} /></button>
              <button type="button" onClick={() => { setSelectedUser(person); setDialog('user'); }} title="Edit account" aria-label="Edit account" className={iconActionClass}><Pencil size={15} /></button>
              <button type="button" onClick={() => { setSelectedUser(person); setDialog('reset'); }} title="Reset password" aria-label="Reset password" className={iconActionClass}><KeyRound size={15} /></button>
              <div className="relative">
                <button type="button" onClick={() => setMenuFor(menuFor === person.id ? null : person.id)} title="More actions" aria-label="More actions" className={iconActionClass}><MoreHorizontal size={15} /></button>
                {menuFor === person.id && <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-strong bg-white p-1">
                  <button type="button" disabled={busy || dialogBusy} onClick={() => { setMenuFor(null); setSelectedUser(person); setRequestedActive(!person.active); setDialog('toggle-user'); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-hover disabled:opacity-50"><Ban size={13} />{person.active ? 'Deactivate' : 'Activate'}</button>
                  <button type="button" disabled={busy || dialogBusy} onClick={() => { setMenuFor(null); setSelectedUser(person); setDialog('delete-user'); }} className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-black hover:bg-hover disabled:opacity-50"><Trash2 size={13} />Delete account</button>
                </div>}
              </div>
            </div></td>
          </tr>)}</tbody>
        </table></div>
        : <EmptyState>{isAllUsersView || (departmentUsers ?? []).length > 0 ? 'No accounts match the current search or filter.' : 'No users found in this subdepartment'}</EmptyState>}

      {!departmentLoading && !departmentError && visibleUsers.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-subtle px-5 py-3 text-xs">
        <span className="text-muted">Showing {startIndex + 1}–{Math.min(startIndex + USERS_PAGE_SIZE, visibleUsers.length)} of {visibleUsers.length}</span>
        <div className="flex items-center gap-2">
          <button disabled={safePage <= 1} onClick={() => setPageIndex(safePage - 1)} className="rounded-lg border border-brand px-3 py-1.5 font-bold disabled:opacity-40">Previous</button>
          <span className="font-bold">Page {safePage} of {totalPages}</span>
          <button disabled={safePage >= totalPages} onClick={() => setPageIndex(safePage + 1)} className="rounded-lg border border-brand px-3 py-1.5 font-bold disabled:opacity-40">Next</button>
        </div>
      </div>}
    </section>}

    {dialog === 'user' && <UserForm departments={subdepartments} initial={selectedUser?.email ? selectedUser : null} defaultDepartmentId={isSubdepartmentView ? selectedSubdepartment : null} onClose={closeDialog} onSubmit={async (payload, id) => {
      await run(() => id ? onUpdateUser(id, payload) : onCreateUser(payload), id ? 'Account updated.' : 'Account created.');
      refreshCurrentDepartment();
    }} />}
    {dialog === 'department' && <DepartmentForm
      initial={selectedDepartmentForEdit}
      parentId={selectedDepartmentForEdit ? selectedDepartmentForEdit.parentId : (creatingSubdepartmentIn?.id || null)}
      parentName={departments.find((department) => department.id === (selectedDepartmentForEdit?.parentId ?? creatingSubdepartmentIn?.id))?.name || creatingSubdepartmentIn?.name}
      onClose={closeDialog}
      onSubmit={async (payload, id) => {
        await run(() => id ? onUpdateDepartment(id, payload) : onCreateDepartment(payload),
          id ? 'Department updated.' : payload.parentId ? 'Subdepartment created.' : 'Department created.');
      }}
    />}
    {dialog === 'reset' && <ResetPasswordDialog user={selectedUser} onClose={closeDialog} onSubmit={(id, password) => onResetPassword(id, password)} />}
    {dialog === 'details' && details && <UserDetailsDialog data={details} onClose={closeDialog} />}
    {dialog === 'bulk' && <BulkImportDialog departments={subdepartments} defaultDepartment={isSubdepartmentView ? activeDepartment : null} onValidate={onBulkValidate} onImport={async (rows) => {
      const result = await onBulkImport(rows);
      refreshCurrentDepartment();
      return result;
    }} onClose={closeDialog} />}
    {dialog === 'toggle-user' && selectedUser && <ConfirmDialog
      title={`${requestedActive ? 'Activate' : 'Deactivate'} account · ${selectedUser.name}`}
      message={`${requestedActive ? 'Activate' : 'Deactivate'} ${selectedUser.name} (${selectedUser.email})? Confirm only if this status change is intended.`}
      confirmLabel={requestedActive ? 'Confirm Activate' : 'Confirm Deactivate'}
      busy={dialogBusy}
      error={dialogError}
      onClose={() => closeDialog()}
      onConfirm={() => {
        const person = selectedUser;
        const nextActive = requestedActive;
        return runConfirmed(
          () => onToggleUser(person.id, nextActive),
          `Account ${nextActive ? 'activated' : 'deactivated'}.`,
          () => {
            updateDepartmentUser(person.id, { active: nextActive });
            refreshCurrentDepartment();
          }
        );
      }}
    >
      <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"><AlertTriangle size={14} />{requestedActive ? 'The account will be able to sign in again. Activation is blocked if this Department already has an active Supervisor.' : 'The account will no longer be able to sign in. This status change is reversible; historical records remain intact.'}</p>
    </ConfirmDialog>}
    {dialog === 'delete-user' && selectedUser && <ConfirmDialog
      title={`Delete account · ${selectedUser.name}`}
      message={`Delete ${selectedUser.name} (${selectedUser.email})? This action may be irreversible from this screen. The account will be deactivated instead of permanently removed so historical transactions and audit records remain intact.`}
      confirmLabel="Confirm Delete"
      busy={dialogBusy}
      error={dialogError}
      onClose={() => closeDialog()}
      onConfirm={() => {
        const person = selectedUser;
        return runConfirmed(
          () => onDeleteUser(person.id),
          'Account deactivated.',
          () => {
            removeDepartmentUser(person.id);
            refreshCurrentDepartment();
          }
        );
      }}
    >
      <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"><AlertTriangle size={14} />The record will disappear from this list immediately after the server confirms the deactivation. Purchase, approval, stock, and audit history is preserved.</p>
    </ConfirmDialog>}
    {dialog === 'delete-department' && selectedDepartmentForDelete && <ConfirmDialog
      title={`Delete ${selectedDepartmentForDelete.parentId ? 'subdepartment' : 'department'} · ${selectedDepartmentForDelete.name}`}
      message={`Delete ${selectedDepartmentForDelete.name}? This action may be irreversible and must be confirmed explicitly.`}
      confirmLabel="Confirm Delete"
      busy={dialogBusy}
      error={dialogError}
      disabled={requiresDepartmentReassignment(selectedDepartmentForDelete) && !reassignTo}
      onClose={() => closeDialog()}
      onConfirm={() => {
        const department = selectedDepartmentForDelete;
        return runConfirmed(
          () => onDeleteDepartment(department.id, reassignTo ? Number(reassignTo) : null),
          'Department deleted.',
          () => {
            if (selectedDepartment === department.id) resetView();
          }
        );
      }}
    >
      {requiresDepartmentReassignment(selectedDepartmentForDelete) && <label className="block text-xs font-bold">Reassign users and historical records to a subdepartment
        <select value={reassignTo} onChange={(event) => setReassignTo(event.target.value)} className="field" aria-label="Reassign department records to">
          <option value="">Choose a subdepartment…</option>
          {subdepartments.filter((department) => department.id !== selectedDepartmentForDelete.id).map((department) => <option key={department.id} value={department.id}>{departments.find((parent) => parent.id === department.parentId)?.name} → {department.name}</option>)}
        </select>
      </label>}
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" /><span>{departmentDependencyText(selectedDepartmentForDelete)} Choose a destination subdepartment to enable deletion.</span></p>
    </ConfirmDialog>}
  </>;
}
