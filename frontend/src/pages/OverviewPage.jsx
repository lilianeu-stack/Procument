import { Boxes, ClipboardCheck, FileText, Truck } from 'lucide-react';

function Metric({ label, value, note, icon: Icon, tone = 'green' }) {
  const tones = { green: 'bg-brand-light text-brand', blue: 'bg-blue-50 text-blue-600', amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600' };
  return <article className="rounded-xl border border-slate-100 bg-white p-5 shadow-card">
    <div className="flex items-start justify-between"><span className="text-[13px] font-semibold text-muted">{label}</span><span className={`grid h-9 w-9 place-items-center rounded-lg ${tones[tone]}`}><Icon size={17} /></span></div>
    <div className="mt-4 display-font text-[27px] font-extrabold tracking-tight">{value}</div>
    <div className="mt-1 text-xs text-muted">{note}</div>
  </article>;
}

export default function OverviewPage({ dashboard }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <Metric label="Total requisitions" value={dashboard?.requisitions?.total ?? '—'} note={`${dashboard?.requisitions?.pending ?? 0} waiting for review`} icon={FileText} />
    <Metric label="Awaiting approval" value={dashboard?.requisitions?.pending ?? '—'} note="Needs your team's attention" icon={ClipboardCheck} tone="amber" />
    <Metric label="Items in catalogue" value={dashboard?.inventory?.items ?? '—'} note={`${dashboard?.inventory?.lowStock ?? 0} below reorder level`} icon={Boxes} tone="blue" />
    <Metric label="Active suppliers" value={dashboard?.suppliers?.active ?? '—'} note="Approved supplier partners" icon={Truck} tone="violet" />
  </div>;
}
