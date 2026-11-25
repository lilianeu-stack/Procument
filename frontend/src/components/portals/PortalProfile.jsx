import { Building2, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import SharedUserProfile from './SharedUserProfile.jsx';
import { KeyValue, PageHeader } from './PortalUi.jsx';
import { dateLabel } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';

export default function PortalProfile({ user, summary, portal }) {
  const department = summary?.department || {};
  return <>
    <PageHeader
      eyebrow="Account"
      title="My profile"
      description="Your account details and Department assignment. Profile information is managed by an Administrator."
    />
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <PageCard title="Profile">
        <div className="p-5 text-center">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-white text-2xl font-extrabold text-black">
            {user?.initials || 'HH'}
          </div>
          <h3 className="display-font mt-4 text-lg font-extrabold">{user?.name || 'User'}</h3>
          <p className="mt-1 text-xs text-muted">{roleLabel(user?.role)}</p>
          <div className="mt-4 flex justify-center"><SharedUserProfile user={user} portal={portal} /></div>
        </div>
      </PageCard>
      <div className="space-y-5">
        <PageCard title="Account details">
          <dl className="grid gap-5 p-5 sm:grid-cols-2">
            <KeyValue label="Full name">{user?.name}</KeyValue>
            <KeyValue label="Email"><span className="flex items-center gap-1.5"><Mail size={12} className="text-muted" />{user?.email}</span></KeyValue>
            <KeyValue label="Role">{roleLabel(user?.role)}</KeyValue>
            <KeyValue label="Username">{user?.username || user?.email || '—'}</KeyValue>
            <KeyValue label="Phone"><span className="flex items-center gap-1.5"><Phone size={12} className="text-muted" />{user?.phone || '—'}</span></KeyValue>
            <KeyValue label="Account status"><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-black">Active</span></KeyValue>
          </dl>
        </PageCard>
        <PageCard title="Department assignment">
          <dl className="grid gap-5 p-5 sm:grid-cols-2">
            <KeyValue label="Department"><span className="flex items-center gap-1.5"><Building2 size={12} className="text-muted" />{department.name || user?.department || '—'}</span></KeyValue>
            <KeyValue label="Department ID">{department.id ?? user?.departmentId ?? '—'}</KeyValue>
            <KeyValue label="Description" className="sm:col-span-2">{department.description || 'No description supplied.'}</KeyValue>
            <KeyValue label="Department users">{department.userCount ?? '—'}</KeyValue>
            <KeyValue label="Active Requesters">{department.requesterCount ?? '—'}</KeyValue>
          </dl>
        </PageCard>
        <div className="flex items-start gap-3 rounded-xl border border-brand bg-white p-5 text-xs leading-5 text-muted">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-black" />
          <p>Your access is determined by your assigned role and Department. Contact an Administrator if any of the details above need correction.</p>
        </div>
      </div>
    </div>
    <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted"><UserRound size={12} />Signed in as {user?.email || 'your account'}</p>
    {user?.createdAt && <p className="mt-1 text-[11px] text-muted">Account created {dateLabel(user.createdAt)}</p>}
  </>;
}
