import { useEffect, useState } from 'react';
import {
  ArrowRight, Boxes, Building2, ClipboardCheck, ClipboardList,
  MessageSquare, PackageSearch, UsersRound
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import {
  EmptyState, ErrorState, LoadingState, PageHeader, PortalBadge,
  TableScroll, TextLink, secondaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';

function useDepartmentExtras(portalApi, includeRequests = true) {
  const [state, setState] = useState({ requests: [], stock: [], requesters: [], departmentUsers: [], loading: true, error: '' });
  useEffect(() => {
    let active = true;
    Promise.all([
      includeRequests ? portalApi.getSupervisorRequests({ page: 1, limit: 6, status: '' }) : Promise.resolve({ requisitions: [] }),
      portalApi.getStock({}),
      portalApi.getRequesters(),
      includeRequests ? Promise.resolve({ users: [] }) : portalApi.getDepartmentUsers()
    ]).then(([requests, stock, requesters, departmentUsers]) => {
      if (!active) return;
      setState({
        requests: requests.requisitions || [],
        stock: stock.items || [],
        requesters: requesters.requesters || [],
        departmentUsers: departmentUsers.users || [],
        loading: false, error: ''
      });
    }).catch((exception) => {
      if (!active) return;
      setState({ requests: [], stock: [], requesters: [], departmentUsers: [], loading: false, error: exception.message || 'Department data could not be loaded.' });
    });
    return () => { active = false; };
  }, [portalApi, includeRequests]);
  return state;
}

export default function SupervisorOverview({ mode = 'overview', summary, portalApi, navigate }) {
  const department = summary?.department || {};
  const stats = summary?.stats || {};
  const extras = useDepartmentExtras(portalApi, mode === 'overview');

  const cards = [
    { label: 'Active Requesters', value: stats.requesters ?? department.requesterCount ?? '—', note: 'In your Department', icon: UsersRound, tone: 'emerald', page: 'Requesters' },
    { label: 'Pending approvals', value: stats.pending ?? '—', note: 'Awaiting your decision', icon: ClipboardCheck, tone: 'amber', page: 'Approvals' },
    { label: 'Forwarded', value: stats.forwarded ?? '—', note: 'Sent to Procurement', icon: ClipboardList, tone: 'indigo', page: 'Procurement Requests' },
    { label: 'Stock items', value: stats.stockItems ?? '—', note: `${stats.lowStock ?? 0} low · ${stats.outOfStock ?? 0} out`, icon: Boxes, tone: 'blue', page: 'Stock Overview' }
  ];

  if (mode === 'department') return <>
    <PageHeader
      eyebrow="Department"
      title="My Department"
      description={`All users assigned to ${department.name || 'your Department'}.`}
      actions={<span className="text-xs font-semibold text-muted">{extras.departmentUsers.length} user{extras.departmentUsers.length === 1 ? '' : 's'}</span>}
    />
    <PageCard title={`Users in ${department.name || 'your Department'}`} description="Everyone assigned to your Department.">
      {extras.loading ? <LoadingState label="Loading department users…" /> : extras.error ? <ErrorState message={extras.error} /> :
        !extras.departmentUsers.length ? <EmptyState title="No users assigned" description="Ask an Administrator to assign users to this Department." /> :
          <TableScroll minWidth={760}>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                <tr>{['Name', 'Role', 'Email', 'Phone', 'Requests', 'Status', 'Action'].map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {extras.departmentUsers.map((member) => <tr key={member.id}>
                  <td className="whitespace-nowrap px-4 py-3 font-bold">{member.name}</td>
                  <td className="whitespace-nowrap px-4 py-3"><PortalBadge tone="indigo">{roleLabel(member.role)}</PortalBadge></td>
                  <td className="whitespace-nowrap px-4 py-3">{member.email}</td>
                  <td className="whitespace-nowrap px-4 py-3">{member.phone || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{member.requestCount || 0}</td>
                  <td className="whitespace-nowrap px-4 py-3"><PortalBadge tone="emerald">Active</PortalBadge></td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {member.id !== summary?.user?.id
                      ? <button type="button" onClick={() => navigate('Department Messages', { userId: member.id })} className={secondaryButtonClass()}>
                          <MessageSquare size={13} />Message
                        </button>
                      : <span className="text-muted">You</span>}
                  </td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll>}
    </PageCard>
  </>;

  return <>
    <PageHeader
      eyebrow="Department overview"
      title={department.name || 'Your Department'}
      description="A live snapshot of request activity, approval workload and stock in your Department."
      actions={<button type="button" onClick={() => navigate('Procurement Requests')} className={secondaryButtonClass()}>
        All requests <ArrowRight size={14} />
      </button>}
    />

    <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => <button key={card.label} type="button" onClick={() => navigate(card.page)}
        className="rounded-xl border border-slate-100 bg-white p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lg">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[12px] font-semibold text-muted">{card.label}</span>
          <span className={`grid h-9 w-9 place-items-center rounded-lg ${card.tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' : card.tone === 'amber' ? 'bg-amber-50 text-amber-700' : card.tone === 'indigo' ? 'bg-indigo-50 text-indigo-700' : 'bg-blue-50 text-blue-700'}`}>
            <card.icon size={17} />
          </span>
        </div>
        <div className="display-font mt-3 text-[26px] font-extrabold">{card.value}</div>
        <div className="mt-1 text-[11px] text-muted">{card.note}</div>
      </button>)}
    </div>

    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <PageCard title="Recent Department requests" description="Latest submissions from your Requesters."
        action={<TextLink onClick={() => navigate('Procurement Requests')}>View all</TextLink>}>
        {extras.loading ? <LoadingState label="Loading requests…" /> : extras.error ? <ErrorState message={extras.error} /> :
          !extras.requests.length ? <EmptyState title="No requests yet" description="Department requests will appear here." /> :
            <TableScroll minWidth={620}>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                  <tr>{['Reference', 'Requester', 'Title', 'Date', 'Cost', 'Status'].map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {extras.requests.slice(0, 6).map((request) => <tr key={request.id}>
                    <td className="whitespace-nowrap px-4 py-3 font-bold text-brand">
                      <TextLink onClick={() => navigate('Procurement Requests', { request: request.id })}>{request.reference}</TextLink>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{request.requester}</td>
                    <td className="max-w-[200px] truncate px-4 py-3">{request.title}</td>
                    <td className="whitespace-nowrap px-4 py-3">{dateLabel(request.submittedAt || request.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-bold">{currency(request.total)}</td>
                    <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={request.status} /></td>
                  </tr>)}
                </tbody>
              </table>
            </TableScroll>}
      </PageCard>

      <div className="space-y-5">
        <PageCard title="Stock snapshot" description="Read-only stock position for your Department."
          action={<TextLink onClick={() => navigate('Stock Overview')}>Open stock</TextLink>}>
          <dl className="grid grid-cols-3 gap-3 p-5">
            {[
              { label: 'Items', value: stats.stockItems ?? '—', tone: 'slate' },
              { label: 'Low stock', value: stats.lowStock ?? '—', tone: 'amber' },
              { label: 'Out of stock', value: stats.outOfStock ?? '—', tone: 'red' }
            ].map((item) => <div key={item.label} className="rounded-lg bg-slate-50 p-3 text-center">
              <div className="display-font text-xl font-extrabold">{item.value}</div>
              <div className="mt-1"><PortalBadge tone={item.tone}>{item.label}</PortalBadge></div>
            </div>)}
          </dl>
          {extras.stock.length > 0 && <div className="border-t border-slate-100 px-5 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted"><PackageSearch size={12} />Needs attention</div>
            {extras.stock.filter((item) => item.stockStatus !== 'Available').slice(0, 3).map((item) =>
              <div key={item.id} className="flex items-center justify-between gap-2 py-1.5 text-[11px]">
                <span className="truncate font-semibold">{item.name}</span>
                <PortalBadge tone={item.stockStatus === 'Low Stock' ? 'amber' : 'red'}>{item.stockStatus} · {item.quantity}</PortalBadge>
              </div>)}
          </div>}
        </PageCard>

        <PageCard title="Quick links" description="Jump straight to the work you need to do.">
          <div className="grid gap-2 p-5 sm:grid-cols-2">
            {[
              { label: 'Approvals', icon: ClipboardCheck, page: 'Approvals' },
              { label: 'Department requests', icon: ClipboardList, page: 'Procurement Requests' },
              { label: 'My Department', icon: Building2, page: 'My Department' },
              { label: 'Department messages', icon: MessageSquare, page: 'Department Messages' }
            ].map(({ label, icon: Icon, page }) => <button key={page} type="button" onClick={() => navigate(page)}
              className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-3 text-left text-xs font-bold hover:border-brand hover:text-brand">
              <Icon size={15} />{label}
            </button>)}
          </div>
        </PageCard>
      </div>
    </div>
  </>;
}
