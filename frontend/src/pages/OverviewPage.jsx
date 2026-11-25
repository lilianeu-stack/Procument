import {
  AlertTriangle, ArrowUpRight, Boxes, Check, CheckCircle2, Clock3,
  FileText, ShoppingCart, Truck, XCircle
} from 'lucide-react';
import {
  canAccessPage, PURCHASE_ORDERS_PAGE, RECEIVED_REQUESTS_PAGE
} from '../utils/access.js';

function formatCount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

function MetricCard({ label, value, note, icon: Icon, onClick }) {
  const content = <>
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-bold uppercase leading-4 tracking-[.1em] text-black/60">{label}</span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-brand bg-white">
        <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
      </span>
    </div>
    <div className="mt-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="display-font text-[32px] font-extrabold leading-none tracking-[-0.02em]">{formatCount(value)}</div>
        <div className="mt-2 min-h-8 text-[11px] leading-4 text-black/50">{note}</div>
      </div>
      {onClick && <ArrowUpRight size={15} className="shrink-0 text-black/40 transition group-hover:text-accent-text" aria-hidden="true" />}
    </div>
  </>;
  const className = 'group flex h-full min-h-[148px] w-full flex-col justify-between rounded-2xl border border-brand bg-white p-5 text-left shadow-dashboard transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus';

  return onClick
    ? <button type="button" onClick={onClick} className={`${className} hover:bg-accent-tint hover:border-accent-border`} aria-label={`${label}: ${formatCount(value)}. ${note}`}>{content}</button>
    : <article className={className}>{content}</article>;
}

function DashboardSkeleton() {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" aria-busy="true">
    {Array.from({ length: 10 }, (_value, index) => <div key={index} className="h-[148px] animate-pulse rounded-2xl border border-brand bg-white p-5 shadow-dashboard">
      <div className="h-3 w-2/3 rounded bg-hover" />
      <div className="mt-7 h-8 w-1/2 rounded bg-hover" />
      <div className="mt-3 h-3 w-3/4 rounded bg-hover" />
    </div>)}
  </div>;
}

export default function OverviewPage({ dashboard, role, loading, onNavigate }) {
  const canViewRequests = canAccessPage(role, RECEIVED_REQUESTS_PAGE);
  const canViewSuppliers = canAccessPage(role, 'Suppliers');
  const canViewStock = canAccessPage(role, 'Stock overview');
  const canViewPurchaseOrders = canAccessPage(role, PURCHASE_ORDERS_PAGE);

  const requestNav = (query) => canViewRequests ? () => onNavigate(RECEIVED_REQUESTS_PAGE, query) : undefined;
  const openSuppliers = canViewSuppliers ? () => onNavigate('Suppliers') : undefined;
  const stockNav = (query) => canViewStock ? () => onNavigate('Stock overview', query) : undefined;
  const purchaseOrderNav = (query) => canViewPurchaseOrders ? () => onNavigate(PURCHASE_ORDERS_PAGE, query) : undefined;

  const metrics = [
    { label: 'Total requisitions', value: dashboard?.requisitions?.total, note: `${formatCount(dashboard?.requisitions?.pending)} waiting for review`, icon: FileText, onClick: requestNav() },
    { label: 'Awaiting approval', value: dashboard?.requisitions?.pending, note: "Needs your team's attention", icon: Clock3, onClick: requestNav({ statusGroup: 'underReview' }) },
    { label: 'Approved Requests', value: dashboard?.requisitions?.approved, note: 'Approved or in progress.', icon: CheckCircle2, onClick: requestNav({ statusGroup: 'new' }) },
    { label: 'Rejected Requests', value: dashboard?.requisitions?.rejected, note: 'Rejected during review.', icon: XCircle, onClick: requestNav({ statusGroup: 'rejected' }) },
    { label: 'Total Purchase Orders', value: dashboard?.purchaseOrders?.total, note: 'Orders created from awarded RFQs.', icon: ShoppingCart, onClick: purchaseOrderNav() },
    { label: 'Pending Purchase Orders', value: dashboard?.purchaseOrders?.pending, note: 'Awaiting internal approval.', icon: Clock3, onClick: purchaseOrderNav({ status: 'Pending approval' }) },
    { label: 'Approved Purchase Orders', value: dashboard?.purchaseOrders?.approved, note: 'Approved or fulfilled orders.', icon: Check, onClick: purchaseOrderNav({ status: 'Approved' }) },
    { label: 'Active suppliers', value: dashboard?.suppliers?.active, note: 'Approved supplier partners.', icon: Truck, onClick: openSuppliers },
    { label: 'Items in catalogue', value: dashboard?.inventory?.items, note: `${formatCount(dashboard?.inventory?.lowStock)} below reorder level`, icon: Boxes, onClick: stockNav() },
    { label: 'Low Stock Items', value: dashboard?.inventory?.lowStock, note: 'At or below reorder level.', icon: AlertTriangle, onClick: stockNav({ lowStock: 'true' }) }
  ];

  return loading && !dashboard
    ? <DashboardSkeleton />
    : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
    </div>;
}
