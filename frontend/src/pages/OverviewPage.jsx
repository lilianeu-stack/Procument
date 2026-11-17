import { ArrowRight, Boxes, Check, ClipboardCheck, FileText, Sparkles, Truck } from 'lucide-react';
import PageCard, { EmptyState } from '../components/ui/PageCard.jsx';
import StatusBadge from '../components/ui/StatusBadge.jsx';
import { currency, dateLabel } from '../utils/format.js';

function Metric({ label, value, note, icon: Icon, tone = 'green' }) {
  const tones = { green: 'bg-brand-light text-brand', blue: 'bg-blue-50 text-blue-600', amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600' };
  return <article className="rounded-xl border border-slate-100 bg-white p-5 shadow-card">
    <div className="flex items-start justify-between"><span className="text-[13px] font-semibold text-muted">{label}</span><span className={`grid h-9 w-9 place-items-center rounded-lg ${tones[tone]}`}><Icon size={17} /></span></div>
    <div className="mt-4 display-font text-[27px] font-extrabold tracking-tight">{value}</div>
    <div className="mt-1 text-xs text-muted">{note}</div>
  </article>;
}

export default function OverviewPage({ dashboard, onNavigate }) {
  const requests = dashboard?.recent || [];
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Total requisitions" value={dashboard?.requisitions?.total ?? '—'} note={`${dashboard?.requisitions?.pending ?? 0} waiting for review`} icon={FileText} />
      <Metric label="Awaiting approval" value={dashboard?.requisitions?.pending ?? '—'} note="Needs your team's attention" icon={ClipboardCheck} tone="amber" />
      <Metric label="Items in catalogue" value={dashboard?.inventory?.items ?? '—'} note={`${dashboard?.inventory?.lowStock ?? 0} below reorder level`} icon={Boxes} tone="blue" />
      <Metric label="Active suppliers" value={dashboard?.suppliers?.active ?? '—'} note="Approved supplier partners" icon={Truck} tone="violet" />
    </div>
    <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <PageCard title="Recent requisitions" description="Latest requests across your organization" action={<button onClick={() => onNavigate('Requisitions')} className="text-xs font-bold text-brand">View all <ArrowRight size={14} className="inline" /></button>}>
        {requests.length ? <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Request', 'Requester', 'Date', 'Amount', 'Status'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{requests.map((request) => <tr key={request.id}><td className="px-5 py-3 font-bold">{request.reference}</td><td className="px-5 py-3">{request.requester}</td><td className="px-5 py-3">{dateLabel(request.createdAt)}</td><td className="px-5 py-3">{currency(request.total)}</td><td className="px-5 py-3"><StatusBadge value={request.status} /></td></tr>)}</tbody></table></div> : <EmptyState>No requisitions yet.</EmptyState>}
      </PageCard>
      <PageCard title="Inventory health" description={`${dashboard?.inventory?.items ?? 0} catalogue items`}>
        <div className="p-5">
          <div className="rounded-xl bg-[#f7faf9] p-4"><div className="flex justify-between text-xs"><span className="font-semibold">Low-stock items</span><span className="font-bold text-amber-700">{dashboard?.inventory?.lowStock ?? 0}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-brand" style={{ width: `${dashboard?.inventory?.items ? Math.max(4, 100 - dashboard.inventory.lowStock / dashboard.inventory.items * 100) : 0}%` }} /></div><p className="mt-2 text-[10px] text-muted">Stock updates as receipts and issues are recorded.</p></div>
          <button onClick={() => onNavigate('Stock overview')} className="mt-4 flex w-full items-center justify-between rounded-lg border border-slate-100 p-3 text-xs font-bold"><span className="flex items-center gap-2"><Check size={15} className="text-brand" />View inventory</span><ArrowRight size={15} /></button>
        </div>
      </PageCard>
    </div>
    <div className="rounded-xl bg-[#1d4441] p-5 text-white sm:flex sm:items-center sm:justify-between sm:px-7">
      <div className="flex items-center gap-4"><span className="grid h-11 w-11 place-items-center rounded-xl bg-white/10"><Sparkles size={20} className="text-emerald-300" /></span><div><h3 className="font-bold">Keep every request moving.</h3><p className="mt-1 text-xs text-emerald-100/70">Create a request and track its approvals in one place.</p></div></div>
      <button onClick={() => onNavigate('Requisitions')} className="mt-4 rounded-lg bg-white px-4 py-2.5 text-xs font-bold text-[#1d4441] sm:mt-0">Start a requisition</button>
    </div>
  </div>;
}
