import {
  AlertTriangle, Archive, ArrowUpRight, Boxes, Check, CheckCircle2,
  ClipboardCheck, Clock3, FileEdit, FileText, Inbox, Loader2, ListChecks,
  Send, ShoppingCart, Truck, XCircle
} from 'lucide-react';
import {
  canAccessPage, PURCHASE_ORDERS_PAGE, RECEIVED_REQUESTS_PAGE
} from '../utils/access.js';

function formatCount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

function MetricCard({ label, value, icon: Icon, onClick }) {
  const content = <>
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-bold leading-4 text-black">{label}</span>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-brand bg-white text-black">
        <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      </span>
    </div>
    <div className="mt-5 flex items-end justify-between gap-3">
      <span className="display-font text-[30px] font-extrabold leading-none tracking-tight text-black">
        {formatCount(value)}
      </span>
      {onClick && <ArrowUpRight size={15} className="shrink-0 text-black" aria-hidden="true" />}
    </div>
  </>;
  const className = 'flex min-h-[112px] w-full flex-col justify-between rounded-xl border border-brand bg-white p-4 text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus sm:min-h-[120px] sm:p-5';

  return onClick
    ? <button type="button" onClick={onClick} className={`group ${className} hover:border-accent-border hover:bg-accent-tint`} aria-label={`${label}: ${formatCount(value)}`}>
      {content}
    </button>
    : <article className={className}>{content}</article>;
}

function DashboardSkeleton() {
  return <div role="status" aria-label="Loading overview statistics" className="space-y-7">
    {Array.from({ length: 6 }, (_value, index) => <section key={index} aria-hidden="true">
      <div className="mb-3 h-5 w-48 animate-pulse rounded bg-hover" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: index === 1 || index === 3 ? 6 : index === 0 ? 4 : index === 2 ? 3 : index === 4 ? 1 : 2 }, (_card, cardIndex) =>
          <div key={cardIndex} className="min-h-[120px] animate-pulse rounded-xl border border-brand bg-white p-5">
            <div className="h-3 w-2/3 rounded bg-hover" />
            <div className="mt-6 h-7 w-1/3 rounded bg-hover" />
          </div>)}
      </div>
    </section>)}
  </div>;
}

function Section({ title, description, metrics }) {
  if (!metrics.length) return null;
  return <section aria-label={title}>
    <header className="mb-3">
      <h2 className="display-font text-base font-extrabold tracking-tight text-black">{title}</h2>
      {description && <p className="mt-1 text-[11px] leading-4 text-black">{description}</p>}
    </header>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
    </div>
  </section>;
}

export default function OverviewPage({ dashboard, role, loading, onNavigate }) {
  if (loading && !dashboard) return <DashboardSkeleton />;

  const canViewReceived = canAccessPage(role, RECEIVED_REQUESTS_PAGE);
  const canViewRfqs = canAccessPage(role, 'RFQs');
  const canViewSuppliers = canAccessPage(role, 'Suppliers');
  const canViewStock = canAccessPage(role, 'Stock overview');
  const canViewPurchaseOrders = canAccessPage(role, PURCHASE_ORDERS_PAGE);
  const requisitions = dashboard?.requisitions || {};
  const received = dashboard?.receivedRequests || {};
  const purchaseOrders = dashboard?.purchaseOrders || {};
  const rfqs = dashboard?.rfqs || {};
  const inventory = dashboard?.inventory || {};
  const suppliers = dashboard?.suppliers || {};
  const openReceived = (statusGroup) => () => onNavigate(
    RECEIVED_REQUESTS_PAGE,
    statusGroup ? { statusGroup } : undefined
  );
  const openRfq = (status) => () => onNavigate('RFQs', status ? { status } : undefined);

  const sections = [
    {
      title: 'Procurement Requests',
      description: 'All purchase requests and their current workflow outcomes.',
      metrics: [
        { label: 'Total Purchase Requests', value: requisitions.total, icon: FileText },
        { label: 'Pending Requests', value: requisitions.pending, icon: Clock3 },
        { label: 'Approved Requests', value: requisitions.approved, icon: CheckCircle2 },
        { label: 'Rejected Requests', value: requisitions.rejected, icon: XCircle }
      ]
    },
    {
      title: 'Requests Received from Departments',
      description: 'Complete requests explicitly forwarded by Department Supervisors.',
      metrics: [
        { label: 'Total Requests Received', value: received.total, icon: ListChecks, onClick: canViewReceived ? openReceived('') : undefined },
        { label: 'New Requests', value: received.new, icon: Inbox, onClick: canViewReceived ? openReceived('new') : undefined },
        { label: 'Under Review', value: received.underReview, icon: ClipboardCheck, onClick: canViewReceived ? openReceived('underReview') : undefined },
        { label: 'Processing', value: received.processing, icon: Loader2, onClick: canViewReceived ? openReceived('processing') : undefined },
        { label: 'Completed', value: received.completed, icon: Check, onClick: canViewReceived ? openReceived('completed') : undefined },
        { label: 'Rejected', value: received.rejected, icon: XCircle, onClick: canViewReceived ? openReceived('rejected') : undefined }
      ]
    },
    {
      title: 'Purchase Orders',
      description: 'Purchase orders awaiting approval or already approved.',
      metrics: [
        { label: 'Total Purchase Orders', value: purchaseOrders.total, icon: ShoppingCart, onClick: canViewPurchaseOrders ? () => onNavigate(PURCHASE_ORDERS_PAGE) : undefined },
        { label: 'Pending Purchase Orders', value: purchaseOrders.pending, icon: Clock3, onClick: canViewPurchaseOrders ? () => onNavigate(PURCHASE_ORDERS_PAGE, { status: 'Pending approval' }) : undefined },
        { label: 'Approved Purchase Orders', value: purchaseOrders.approved, icon: CheckCircle2, onClick: canViewPurchaseOrders ? () => onNavigate(PURCHASE_ORDERS_PAGE, { status: 'Approved' }) : undefined }
      ]
    },
    {
      title: 'Request for Quotations (RFQs)',
      description: 'RFQs grouped by their actual lifecycle status.',
      metrics: [
        { label: 'Total RFQs', value: rfqs.total, icon: FileText, onClick: canViewRfqs ? openRfq('') : undefined },
        { label: 'Draft RFQs', value: rfqs.draft, icon: FileEdit, onClick: canViewRfqs ? openRfq('Draft') : undefined },
        { label: 'Sent RFQs', value: rfqs.sent, icon: Send, onClick: canViewRfqs ? openRfq('Sent') : undefined },
        { label: 'Evaluating RFQs', value: rfqs.evaluating, icon: ClipboardCheck, onClick: canViewRfqs ? openRfq('Evaluating') : undefined },
        { label: 'Awarded RFQs', value: rfqs.awarded, icon: CheckCircle2, onClick: canViewRfqs ? openRfq('Awarded') : undefined },
        { label: 'Closed RFQs', value: rfqs.closed, icon: Archive, onClick: canViewRfqs ? openRfq('Closed') : undefined }
      ]
    },
    {
      title: 'Suppliers',
      description: 'Suppliers registered in the procurement system.',
      metrics: [
        { label: 'Total Suppliers', value: suppliers.total, icon: Truck, onClick: canViewSuppliers ? () => onNavigate('Suppliers') : undefined }
      ]
    },
    {
      title: 'Stock Overview',
      description: 'Inventory catalogue and replenishment needs.',
      metrics: [
        { label: 'Total Stock Items', value: inventory.items, icon: Boxes, onClick: canViewStock ? () => onNavigate('Stock overview') : undefined },
        { label: 'Low Stock Items', value: inventory.lowStock, icon: AlertTriangle, onClick: canViewStock ? () => onNavigate('Stock overview', { lowStock: 'true' }) : undefined }
      ]
    }
  ];

  return <div className="space-y-7">
    {sections.filter((section) => {
      if (section.title === 'Requests Received from Departments') return canViewReceived;
      if (section.title === 'Purchase Orders') return canViewPurchaseOrders;
      if (section.title === 'Request for Quotations (RFQs)') return canViewRfqs;
      if (section.title === 'Suppliers') return canViewSuppliers;
      if (section.title === 'Stock Overview') return canViewStock;
      return true;
    }).map((section) => <Section key={section.title} {...section} />)}
  </div>;
}
