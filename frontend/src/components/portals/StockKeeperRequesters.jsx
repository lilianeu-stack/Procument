import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, Building2, CalendarDays, Check,
  ChevronLeft, ChevronRight, Clock3, Eye, History, IdCard, Mail, PackageSearch,
  Phone, RefreshCw, Search, UsersRound, UserCheck, UserRound, UserX, X
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import { dateTimeLabel } from '../../utils/format.js';
import {
  EmptyState, ErrorState, PortalBadge, StatCard, TableScroll
} from './PortalUi.jsx';

const EMPTY_DIRECTORY = {
  requesters: [],
  departments: [],
  stats: { totalRequesters: 0, activeRequesters: 0, inactiveRequesters: 0, departments: 0 },
  pagination: { page: 1, limit: 10, total: 0, pages: 1 }
};

const DEFAULT_FILTERS = {
  name: '',
  email: '',
  department: '',
  departmentId: '',
  status: '',
  sort: 'name',
  direction: 'asc',
  page: 1,
  limit: 10
};

const PAGE_SIZES = [10, 25, 50, 100];

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || '—';
}

function FilterInput({ label, value, onChange, placeholder, type = 'text', icon: Icon }) {
  return <label className="block min-w-0">
    <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
    <span className="relative mt-1 block">
      {Icon && <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`field ${Icon ? 'pl-9' : ''}`}
      />
    </span>
  </label>;
}

function SortButton({ label, field, sort, direction, onSort }) {
  const active = sort === field;
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return <button type="button" onClick={() => onSort(field)}
    className="inline-flex items-center gap-1 font-bold text-muted hover:text-ink"
    aria-label={`Sort by ${label}${active ? ` ${direction === 'asc' ? 'ascending' : 'descending'}` : ''}`}>
    {label}<Icon size={12} />
  </button>;
}

function RequesterAvatar({ requester, size = 'h-10 w-10' }) {
  return requester.profileImage
    ? <img src={requester.profileImage} alt="" className={`${size} shrink-0 rounded-full object-cover ring-1 ring-slate-200`} />
    : <span aria-hidden="true" className={`grid ${size} shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-extrabold text-emerald-800 ring-1 ring-emerald-100`}>
      {initials(requester.name)}
    </span>;
}

function RequesterTableSkeleton() {
  return <div role="status" aria-label="Loading Requesters" className="animate-pulse space-y-3 p-5">
    {Array.from({ length: 6 }, (_, index) => <div key={index} className="grid grid-cols-6 items-center gap-4">
      <span className="h-4 rounded bg-slate-100" />
      <span className="h-10 rounded-lg bg-slate-100" />
      <span className="h-8 rounded bg-slate-100" />
      <span className="h-8 rounded bg-slate-100" />
      <span className="h-7 w-20 rounded-full bg-slate-100" />
      <span className="h-8 rounded bg-slate-100" />
    </div>)}
    <span className="sr-only">Loading Requesters…</span>
  </div>;
}

function PageNavigation({ pagination, onPageChange, onPageSizeChange }) {
  const page = pagination?.page || 1;
  const limit = pagination?.limit || 10;
  const total = pagination?.total || 0;
  const pages = pagination?.pages || 1;
  const first = total ? (page - 1) * limit + 1 : 0;
  const last = Math.min(page * limit, total);
  return <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-[11px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
    <div className="flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-2">
        <span>Rows per page</span>
        <select value={limit} onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="field h-8 w-[78px] py-1 text-[11px]">
          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <span>Showing {first}–{last} of {total}</span>
    </div>
    <div className="flex items-center gap-2 self-end sm:self-auto">
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}
        aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white disabled:opacity-40">
        <ChevronLeft size={15} />
      </button>
      <span className="min-w-20 text-center font-semibold text-ink">Page {page} of {pages}</span>
      <button type="button" disabled={page >= pages} onClick={() => onPageChange(page + 1)}
        aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white disabled:opacity-40">
        <ChevronRight size={15} />
      </button>
    </div>
  </div>;
}

function InformationBlock({ icon: Icon, label, children }) {
  return <div className="flex min-w-0 gap-3 rounded-xl border border-slate-100 bg-white p-4">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-600"><Icon size={16} /></span>
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-ink">{children ?? '—'}</dd>
    </div>
  </div>;
}

export default function StockKeeperRequesters({ portalApi, initial }) {
  const [directory, setDirectory] = useState(initial || EMPTY_DIRECTORY);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(!initial);
  const [listError, setListError] = useState('');
  const [reloadList, setReloadList] = useState(0);
  const listSequence = useRef(0);

  const [view, setView] = useState('list');
  const [selectedRequester, setSelectedRequester] = useState(null);
  const [requesterDetails, setRequesterDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const detailsSequence = useRef(0);

  const [historyFilters, setHistoryFilters] = useState({
    item: '', from: '', to: '', page: 1, limit: 10, sort: 'date', direction: 'desc'
  });
  const [historyData, setHistoryData] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [selectedMovement, setSelectedMovement] = useState(null);
  const historySequence = useRef(0);

  useEffect(() => {
    let active = true;
    const sequence = ++listSequence.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setListError('');
      try {
        const result = await portalApi.getStockKeeperRequesters(filters);
        if (active && sequence === listSequence.current) {
          setDirectory({
            ...EMPTY_DIRECTORY,
            ...result,
            stats: { ...EMPTY_DIRECTORY.stats, ...(result.stats || {}) },
            pagination: { ...EMPTY_DIRECTORY.pagination, ...(result.pagination || {}) }
          });
        }
      } catch (exception) {
        if (active && sequence === listSequence.current) {
          setListError(exception.message || 'Requester records could not be loaded.');
        }
      } finally {
        if (active && sequence === listSequence.current) setLoading(false);
      }
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, portalApi, reloadList]);

  useEffect(() => {
    if (view !== 'history' || !selectedRequester) return undefined;
    let active = true;
    const sequence = ++historySequence.current;
    const timer = window.setTimeout(async () => {
      setHistoryLoading(true);
      setHistoryError('');
      try {
        const result = await portalApi.getRequesterHistory(selectedRequester.id, historyFilters);
        if (active && sequence === historySequence.current) setHistoryData(result);
      } catch (exception) {
        if (active && sequence === historySequence.current) {
          setHistoryError(exception.message || 'Stock issue history could not be loaded.');
        }
      } finally {
        if (active && sequence === historySequence.current) setHistoryLoading(false);
      }
    }, 160);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [historyFilters, portalApi, selectedRequester, view]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }

  function clearFilters() {
    setFilters({ ...DEFAULT_FILTERS });
  }

  function sortBy(field) {
    setFilters((current) => ({
      ...current,
      sort: field,
      direction: current.sort === field && current.direction === 'asc' ? 'desc' : 'asc',
      page: 1
    }));
  }

  async function openDetails(requester) {
    const sequence = ++detailsSequence.current;
    setSelectedRequester(requester);
    setView('details');
    setRequesterDetails(null);
    setDetailsError('');
    setDetailsLoading(true);
    try {
      const result = await portalApi.getRequesterDetails(requester.id);
      if (sequence === detailsSequence.current) setRequesterDetails(result);
    } catch (exception) {
      if (sequence === detailsSequence.current) {
        setDetailsError(exception.message || 'Requester details could not be loaded.');
      }
    } finally {
      if (sequence === detailsSequence.current) setDetailsLoading(false);
    }
  }

  function openHistory(requester) {
    setSelectedRequester(requester);
    setHistoryData(null);
    setHistoryFilters({ item: '', from: '', to: '', page: 1, limit: 10, sort: 'date', direction: 'desc' });
    setHistoryError('');
    setView('history');
  }

  function backToList() {
    setView('list');
    setSelectedRequester(null);
    setRequesterDetails(null);
    setHistoryData(null);
    setSelectedMovement(null);
  }

  function updateHistoryFilter(key, value) {
    setHistoryFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }

  const listHeader = <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100">
        <UsersRound size={20} />
      </span>
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-brand">Stock operations · Directory</p>
        <h2 className="display-font mt-1 text-xl font-extrabold tracking-tight">List of Requesters</h2>
        <p className="mt-1 text-xs leading-5 text-muted">View and manage requester information across departments.</p>
      </div>
    </div>
    <div className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-ink">
      <UsersRound size={14} className="text-brand" />
      <span>{directory.stats?.totalRequesters ?? '—'} total Requesters</span>
    </div>
  </div>;

  if (view === 'details' && selectedRequester) {
    const detail = requesterDetails;
    const requester = detail?.requester || selectedRequester;
    const issueSummary = detail?.issueSummary || {};
    return <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={backToList} className="inline-flex items-center gap-2 text-xs font-bold text-muted hover:text-ink">
          <ArrowLeft size={15} />Back to Requesters
        </button>
        <button type="button" onClick={() => openHistory(requester)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-3.5 py-2.5 text-xs font-bold text-white hover:bg-brand/90">
          <History size={14} />View Stock Issue History
        </button>
      </div>
      <header className="flex flex-wrap items-center gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-card sm:p-6">
        <RequesterAvatar requester={requester} size="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-brand">Requester profile</p>
          <h2 className="display-font mt-1 truncate text-xl font-extrabold">{requester.name}</h2>
          <p className="mt-1 text-xs text-muted">Requester ID #{requester.id}</p>
        </div>
        <PortalBadge tone={requester.active ? 'emerald' : 'slate'}>{requester.active ? 'Active' : 'Inactive'}</PortalBadge>
      </header>
      <ErrorState message={detailsError} onRetry={() => openDetails(selectedRequester)} />
      {detailsLoading && !detail ? <div role="status" className="animate-pulse space-y-3">
        <div className="h-24 rounded-xl bg-slate-100" />
        <div className="h-48 rounded-xl bg-slate-100" />
      </div> : detailsError && !detail ? null : <div className="space-y-5">
        <PageCard title="Personal information" description="Read-only details from the Requester account">
          <dl className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4 sm:p-5">
            <InformationBlock icon={IdCard} label="Requester ID">#{requester.id}</InformationBlock>
            <InformationBlock icon={Mail} label="Email">{requester.email}</InformationBlock>
            <InformationBlock icon={Phone} label="Phone">{requester.phone || 'Not provided'}</InformationBlock>
            <InformationBlock icon={UserRound} label="Account status">
              <PortalBadge tone={requester.active ? 'emerald' : 'slate'}>{requester.active ? 'Active' : 'Inactive'}</PortalBadge>
            </InformationBlock>
          </dl>
        </PageCard>

        <div className="grid gap-5 xl:grid-cols-[1fr_1.15fr]">
          <PageCard title="Department information" description="Current department assignment and supervisor">
            <dl className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
              <InformationBlock icon={Building2} label="Assigned department">{requester.department || 'Not assigned'}</InformationBlock>
              <InformationBlock icon={UserCheck} label="Department supervisor">
                {requester.supervisorName
                  ? <>{requester.supervisorName}{requester.supervisorEmail && <span className="mt-1 block text-xs font-normal text-muted">{requester.supervisorEmail}</span>}</>
                  : 'No active supervisor assigned'}
              </InformationBlock>
              <InformationBlock icon={CalendarDays} label="Account created">
                {requester.createdAt ? dateTimeLabel(requester.createdAt) : '—'}
              </InformationBlock>
            </dl>
          </PageCard>

          <PageCard title="Stock issue summary" description="Recorded stock-out transactions linked to this Requester">
            <div className="grid gap-4 p-4 sm:grid-cols-[150px_1fr] sm:p-5">
              <div className="rounded-xl bg-emerald-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">Issues recorded</p>
                <p className="display-font mt-2 text-3xl font-extrabold text-emerald-950">{issueSummary.totalIssues ?? 0}</p>
                <p className="mt-1 text-[11px] text-emerald-800">{issueSummary.totalUnits ?? 0} total units issued</p>
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-ink">Most recent issues</h3>
                  <span className="text-[10px] text-muted">
                    {issueSummary.mostRecentIssueAt ? dateTimeLabel(issueSummary.mostRecentIssueAt) : 'No issue date'}
                  </span>
                </div>
                {detail?.recentIssues?.length ? <ul className="divide-y divide-slate-100">
                  {detail.recentIssues.map((issue) => <li key={issue.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{issue.itemName}</span>
                      <span className="text-[10px] text-muted">{issue.referenceNo || 'No reference'} · {dateTimeLabel(issue.movementAt)}</span>
                    </span>
                    <span className="shrink-0 rounded-lg bg-slate-50 px-2 py-1 text-xs font-bold">{issue.quantity} {issue.unit}</span>
                  </li>)}
                </ul> : <p className="rounded-lg bg-slate-50 px-3 py-4 text-xs text-muted">No stock issues recorded for this Requester.</p>}
              </div>
            </div>
          </PageCard>
        </div>
      </div>}
    </div>;
  }

  if (view === 'history' && selectedRequester) {
    const pagination = historyData?.pagination;
    const rows = historyData?.movements || [];
    return <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => openDetails(selectedRequester)}
          className="inline-flex items-center gap-2 text-xs font-bold text-muted hover:text-ink">
          <ArrowLeft size={15} />Back to requester details
        </button>
        <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-xs font-semibold text-ink">
          <UserRound size={14} />{selectedRequester.name} · #{selectedRequester.id}
        </span>
      </div>
      <PageCard title="Stock issue history" description={`Actual stock-out transactions recorded for ${selectedRequester.name}.`}>
        <div className="grid gap-3 border-b border-slate-100 bg-slate-50/40 p-4 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_auto] sm:p-5">
          <FilterInput label="Search item" value={historyFilters.item} onChange={(value) => updateHistoryFilter('item', value)}
            placeholder="Item name or SKU" icon={Search} />
          <FilterInput label="From date" type="date" value={historyFilters.from} onChange={(value) => updateHistoryFilter('from', value)} />
          <FilterInput label="To date" type="date" value={historyFilters.to} onChange={(value) => updateHistoryFilter('to', value)} />
          <button type="button" onClick={() => setHistoryFilters({ item: '', from: '', to: '', page: 1, limit: 10, sort: 'date', direction: 'desc' })}
            className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-ink hover:bg-slate-50">
            <X size={14} />Clear filters
          </button>
        </div>
        <ErrorState message={historyError} onRetry={() => setHistoryFilters((current) => ({ ...current }))} />
        {historyLoading ? <RequesterTableSkeleton /> : rows.length ? <TableScroll minWidth={1050}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-muted">
              <tr>{['Date', 'Reference No.', 'Item', 'Quantity Issued', 'Unit', 'Department', 'Issued By', 'Details'].map((column) =>
                <th key={column} className="whitespace-nowrap border-b border-slate-100 px-4 py-3 font-bold">{column}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((movement) => <tr key={movement.id} className="hover:bg-slate-50/70">
                <td className="whitespace-nowrap px-4 py-3">{dateTimeLabel(movement.movementAt)}</td>
                <td className="px-4 py-3 font-semibold">{movement.referenceNo || '—'}</td>
                <td className="px-4 py-3 font-semibold">{movement.itemName}<span className="ml-1 text-[10px] font-normal text-muted">{movement.sku}</span></td>
                <td className="px-4 py-3 font-bold">{movement.quantity}</td>
                <td className="px-4 py-3">{movement.unit || '—'}</td>
                <td className="px-4 py-3">{movement.department || '—'}</td>
                <td className="px-4 py-3">{movement.issuedBy || '—'}</td>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setSelectedMovement(movement)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold hover:bg-slate-50">
                    <Eye size={12} />View
                  </button>
                </td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll> : historyError ? null : <EmptyState
          title={pagination?.total === 0 && !historyFilters.item && !historyFilters.from && !historyFilters.to ? 'No stock issues recorded' : 'No matching stock issues'}
          description="Stock-out transactions linked to this Requester will appear here when recorded."
          action={<PackageSearch size={20} className="mx-auto text-muted" />}
        />}
        <PageNavigation pagination={pagination} onPageChange={(page) => updateHistoryFilter('page', page)}
          onPageSizeChange={(limit) => setHistoryFilters((current) => ({ ...current, page: 1, limit }))} />
      </PageCard>

      {selectedMovement && <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-4"
        role="dialog" aria-modal="true" aria-labelledby="stock-issue-dialog-title"
        onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMovement(null); }}>
        <section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-brand">Bin Card transaction</p>
              <h2 id="stock-issue-dialog-title" className="mt-1 text-base font-extrabold">Stock issue details</h2>
            </div>
            <button type="button" onClick={() => setSelectedMovement(null)} aria-label="Close transaction details"
              className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-slate-100"><X size={16} /></button>
          </header>
          <dl className="grid gap-3 p-5 sm:grid-cols-2">
            <InformationBlock icon={CalendarDays} label="Date">{dateTimeLabel(selectedMovement.movementAt)}</InformationBlock>
            <InformationBlock icon={IdCard} label="Reference number">{selectedMovement.referenceNo || '—'}</InformationBlock>
            <InformationBlock icon={PackageSearch} label="Item">{selectedMovement.itemName} · {selectedMovement.sku}</InformationBlock>
            <InformationBlock icon={ArrowDown} label="Quantity issued">{selectedMovement.quantity} {selectedMovement.unit}</InformationBlock>
            <InformationBlock icon={Building2} label="Department">{selectedMovement.department || '—'}</InformationBlock>
            <InformationBlock icon={UserCheck} label="Issued by">{selectedMovement.issuedBy || '—'}</InformationBlock>
            <InformationBlock icon={UserRound} label="Received by">{selectedMovement.receivedBy || 'Not recorded'}</InformationBlock>
            <InformationBlock icon={History} label="Store request">{selectedMovement.storeRequestReference || selectedMovement.source || '—'}</InformationBlock>
            <InformationBlock icon={Check} label="Balance after issue">{selectedMovement.balance}</InformationBlock>
          </dl>
          {selectedMovement.description && <div className="px-5 pb-5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Description</p>
            <p className="mt-1 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-ink">{selectedMovement.description}</p>
          </div>}
        </section>
      </div>}
    </div>;
  }

  const stats = directory.stats || EMPTY_DIRECTORY.stats;
  const requesters = directory.requesters || [];
  const pagination = directory.pagination || EMPTY_DIRECTORY.pagination;

  return <div className="space-y-5">
    {listHeader}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Total Requesters" value={stats.totalRequesters} note="Registered accounts" icon={UsersRound} tone="indigo" />
      <StatCard label="Active Requesters" value={stats.activeRequesters} note="Accounts enabled" icon={UserCheck} tone="emerald" />
      <StatCard label="Inactive Requesters" value={stats.inactiveRequesters} note="Accounts disabled" icon={UserX} tone="slate" />
      <StatCard label="Departments" value={stats.departments} note="Represented in the directory" icon={Building2} tone="blue" />
    </div>

    <PageCard title="Requester directory" description={`${pagination.total} matching account${pagination.total === 1 ? '' : 's'}`}>
      <div className="grid gap-3 border-b border-slate-100 bg-slate-50/40 p-4 sm:grid-cols-2 xl:grid-cols-[1.1fr_1.1fr_1.1fr_1fr_1fr_auto] sm:p-5">
        <FilterInput label="Requester name" value={filters.name} onChange={(value) => updateFilter('name', value)}
          placeholder="Search by name" icon={Search} />
        <FilterInput label="Email address" value={filters.email} onChange={(value) => updateFilter('email', value)}
          placeholder="Search by email" icon={Mail} />
        <FilterInput label="Department search" value={filters.department} onChange={(value) => updateFilter('department', value)}
          placeholder="Search department" icon={Building2} />
        <label className="block min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Filter department</span>
          <select value={filters.departmentId} onChange={(event) => updateFilter('departmentId', event.target.value)}
            className="field mt-1">
            <option value="">All departments</option>
            {(directory.departments || []).map((department) =>
              <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Account status</span>
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="field mt-1">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <button type="button" onClick={clearFilters}
          className="inline-flex h-10 items-center justify-center gap-2 self-end rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-ink hover:bg-slate-50">
          <X size={14} />Clear
        </button>
      </div>
      <ErrorState message={listError} onRetry={() => setReloadList((current) => current + 1)} />
      {loading ? <RequesterTableSkeleton /> : requesters.length ? <TableScroll minWidth={980}>
        <table className="w-full text-left text-xs">
          <thead className="bg-white text-[10px] uppercase text-muted">
            <tr>
              <th className="w-12 border-b border-slate-100 px-4 py-3">#</th>
              <th className="border-b border-slate-100 px-4 py-3">
                <SortButton label="Requester" field="name" sort={filters.sort} direction={filters.direction} onSort={sortBy} />
              </th>
              <th className="border-b border-slate-100 px-4 py-3">Contact information</th>
              <th className="border-b border-slate-100 px-4 py-3">
                <SortButton label="Department" field="department" sort={filters.sort} direction={filters.direction} onSort={sortBy} />
              </th>
              <th className="border-b border-slate-100 px-4 py-3">
                <SortButton label="Account status" field="status" sort={filters.sort} direction={filters.direction} onSort={sortBy} />
              </th>
              <th className="border-b border-slate-100 px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requesters.map((requester, index) => <tr key={requester.id} className="transition hover:bg-slate-50/70">
              <td className="px-4 py-3 text-muted">{(pagination.page - 1) * pagination.limit + index + 1}</td>
              <td className="px-4 py-3">
                <div className="flex min-w-48 items-center gap-3">
                  <RequesterAvatar requester={requester} />
                  <div className="min-w-0">
                    <p className="truncate font-bold text-ink">{requester.name}</p>
                    <p className="mt-0.5 text-[10px] text-muted">Requester ID #{requester.id}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3">
                <a href={`mailto:${requester.email}`} className="block max-w-56 truncate font-semibold text-ink hover:text-brand">{requester.email}</a>
                <p className="mt-1 text-[10px] text-muted">{requester.phone || 'Phone not provided'}</p>
              </td>
              <td className="px-4 py-3">{requester.department || 'Not assigned'}</td>
              <td className="px-4 py-3">
                <PortalBadge tone={requester.active ? 'emerald' : 'slate'}>
                  <span className={`h-1.5 w-1.5 rounded-full ${requester.active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  {requester.active ? 'Active' : 'Inactive'}
                </PortalBadge>
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => openDetails(requester)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-ink hover:border-brand/30 hover:text-brand">
                    <Eye size={13} />View details
                  </button>
                  <button type="button" onClick={() => openHistory(requester)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-ink hover:border-brand/30 hover:text-brand">
                    <History size={13} />Issue history
                  </button>
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <EmptyState
        title={listError ? 'Requester list is unavailable' : 'No Requesters match these filters'}
        description={listError ? 'Retry to load the latest requester records.' : 'Clear filters or try a different name, email, or department.'}
        action={<button type="button" onClick={clearFilters} className="text-xs font-bold text-brand hover:underline">Clear all filters</button>}
      />}
      <PageNavigation pagination={pagination}
        onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
        onPageSizeChange={(limit) => setFilters((current) => ({ ...current, limit, page: 1 }))} />
    </PageCard>
  </div>;
}
