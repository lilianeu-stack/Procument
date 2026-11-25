import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUp, CheckCircle2, ClipboardCheck, Eye, Inbox,
  ListChecks, Loader2, RefreshCw, X, XCircle
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import DateRangeFilter from '../ui/DateRangeFilter.jsx';
import DownloadButton from '../ui/DownloadButton.jsx';
import PrintButton from '../ui/PrintButton.jsx';
import PrintHeader from '../ui/PrintHeader.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import {
  EmptyState, ErrorState, FilterField, LoadingState, Pagination, TableScroll, TextLink,
  secondaryButtonClass
} from './PortalUi.jsx';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';
import { RECEIVED_REQUESTS_PAGE } from '../../utils/access.js';
import { dateQueryForFilter, reportForPage } from '../../utils/reportFields.js';

const STATUS_OPTIONS = [
  'Forwarded to Procurement',
  'Under Procurement Review',
  'Procurement Approved',
  'Procurement Rejected',
  'Processing',
  'Completed',
  'Cancelled'
];

// Labels carry the exact status while dots keep each row easy to scan.
const RECEIVED_STATUS_DOT = {
  'Forwarded to Procurement': 'bg-black/45',
  'Under Procurement Review': 'bg-black/70',
  'Procurement Approved': 'bg-success',
  'Procurement Rejected': 'bg-reference',
  Processing: 'bg-black/60',
  Completed: 'bg-success',
  Cancelled: 'bg-black/25'
};

const SUMMARY_CARDS = [
  { key: 'total', label: 'Total Requests Received', icon: ListChecks, group: '', note: 'All forwarded requests' },
  { key: 'new', label: 'New Requests', icon: Inbox, group: 'new', note: 'Awaiting procurement review' },
  { key: 'underReview', label: 'Under Review', icon: ClipboardCheck, group: 'underReview', note: 'Actively being assessed' },
  { key: 'processing', label: 'Processing', icon: Loader2, group: 'processing', note: 'Procurement actions under way' },
  { key: 'completed', label: 'Completed', icon: CheckCircle2, group: 'completed', note: 'Fully processed requests' },
  { key: 'rejected', label: 'Rejected', icon: XCircle, group: 'rejected', note: 'Declined by procurement' }
];

const HEADER_CLASS = 'px-3 py-3.5 text-left font-bold';
const CELL_CLASS = 'px-3 py-3.5 align-middle';

function formatCount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '—';
}

function SortHeader({ label, sortKey, filters, onSort }) {
  const active = filters.sort === sortKey;
  return <th scope="col" className={`${HEADER_CLASS} whitespace-nowrap text-[11px] font-extrabold uppercase tracking-[.08em] text-black/50`}
    aria-sort={active ? (filters.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick={() => onSort(sortKey)}
      className="inline-flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus hover:text-accent-text">
      {label}
      {active && (filters.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  </th>;
}

export default function ReceivedRequests({
  portalApi, query = {}, navigate, initial = null, dateFilter = {}, onDateFilterChange
}) {
  const report = reportForPage(RECEIVED_REQUESTS_PAGE);
  const [filters, setFilters] = useState({
    reference: query.reference || '',
    requester: query.requester || '',
    departmentQuery: query.departmentQuery || '',
    department: query.department || '',
    status: query.status || '',
    statusGroup: query.statusGroup || '',
    sort: query.sort || 'submittedAt',
    direction: query.direction || 'desc',
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 10
  });
  const [result, setResult] = useState(initial);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [statsError, setStatsError] = useState('');
  const [printRows, setPrintRows] = useState([]);
  const [printing, setPrinting] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString());
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => new Date().toISOString());

  const dateQuery = dateQueryForFilter(dateFilter);
  const dateParams = {
    from: dateQuery.from || '',
    to: dateQuery.to || '',
    dateField: dateQuery.dateField || report.defaultField
  };
  const listParams = {
    reference: filters.reference,
    requester: filters.requester,
    departmentQuery: filters.departmentQuery,
    department: filters.department,
    status: filters.status,
    statusGroup: filters.statusGroup,
    sort: filters.sort,
    direction: filters.direction,
    ...dateParams
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getReceivedRequests({ ...filters, ...dateQuery });
      setResult(response);
      setLastRefreshedAt(new Date().toISOString());
    } catch (exception) {
      setError(exception.message || 'Received requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, filters, dateQuery.from, dateQuery.to, dateQuery.dateField]);

  const loadStats = useCallback(async () => {
    if (!portalApi.getReceivedRequestStats) return;
    setStatsError('');
    try {
      const response = await portalApi.getReceivedRequestStats();
      setStats(response.stats || null);
    } catch (exception) {
      setStatsError(exception.message || 'Statistics could not be loaded.');
    }
  }, [portalApi]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => { loadStats(); }, [loadStats]);

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? value : 1
    }));
  }

  function applyCardGroup(group) {
    setFilters((current) => ({ ...current, status: '', statusGroup: group, page: 1 }));
  }

  function toggleSort(key) {
    setFilters((current) => ({
      ...current,
      sort: key,
      direction: current.sort === key && current.direction === 'asc' ? 'desc' : 'asc',
      page: 1
    }));
  }

  function clearFilters() {
    setFilters((current) => ({
      ...current,
      reference: '', requester: '', departmentQuery: '', department: '', status: '', statusGroup: '',
      page: 1
    }));
    onDateFilterChange?.({ preset: '', from: '', to: '', dateField: report.defaultField });
    loadStats();
  }

  function openDocument(id) {
    navigate(RECEIVED_REQUESTS_PAGE, { ...query, view: id });
  }

  // The print register must match the filtered register dataset on every page,
  // not only the rows currently visible in the table.
  async function fetchAllMatchingRows() {
    const collected = [];
    let page = 1;
    let total = 0;
    do {
      const response = await portalApi.getReceivedRequests({ ...listParams, page, limit: 100 });
      const rows = response?.requisitions || [];
      total = Number(response?.pagination?.total) || 0;
      collected.push(...rows);
      page += 1;
      if (rows.length === 0 || collected.length >= total || page > 100) break;
    } while (true);
    return collected;
  }

  async function handlePrint() {
    setPrinting(true); setError('');
    try {
      const rows = await fetchAllMatchingRows();
      setPrintRows(rows);
      setGeneratedAt(new Date().toISOString());
      await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
      window.print();
    } catch (exception) {
      setError(exception.message || 'The print register could not be prepared.');
    } finally {
      setPrinting(false);
    }
  }

  const requisitions = result?.requisitions || [];
  const pagination = result?.pagination;
  const dateFieldChanged = Boolean(dateFilter?.dateField && dateFilter.dateField !== report.defaultField);
  const hasFilters = Boolean(filters.reference || filters.requester || filters.departmentQuery || filters.department
    || filters.status || filters.statusGroup || dateFilter?.preset || dateQuery.from || dateQuery.to || dateFieldChanged);
  const scopeLabel = hasFilters ? 'records matching the active filters' : 'forwarded requests';
  const exportedTotal = pagination?.total ?? 0;

  return <>
    <PrintHeader title={report.title} reference="" dates={`Generated ${dateTimeLabel(generatedAt)}`} />
    <section className="no-print mb-6 overflow-hidden rounded-xl border border-brand bg-white">
      <div className="border-b border-subtle bg-white px-6 py-6">
        <h1 className="display-font text-[28px] font-extrabold leading-tight tracking-[-0.02em]">Requests Received from Departments</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Review and manage procurement requests formally forwarded by Department Supervisors.
        </p>
      </div>
    </section>

    <div className="no-print mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" aria-label="Received request summary">
      {SUMMARY_CARDS.map((card) => {
        const active = !filters.status && filters.statusGroup === card.group;
        return <button key={card.key} type="button" aria-pressed={active}
          aria-label={`${card.label}: ${formatCount(stats?.[card.key])}. ${card.note}`}
          onClick={() => applyCardGroup(card.group)}
          className={`group flex min-h-[148px] flex-col justify-between rounded-2xl border bg-white p-5 text-left shadow-dashboard transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus hover:bg-accent-tint hover:border-accent-border ${active ? 'border-black ring-1 ring-black' : 'border-brand'}`}>
          <div className="flex items-start justify-between gap-3">
            <span className="text-[11px] font-bold uppercase leading-4 tracking-[.08em] text-black/60">{card.label}</span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-brand bg-white">
              <card.icon size={16} strokeWidth={1.8} aria-hidden="true" />
            </span>
          </div>
          <div className="mt-5">
            <div className="display-font text-[32px] font-extrabold leading-none tracking-[-0.02em]">{formatCount(stats?.[card.key])}</div>
            <div className="mt-2 min-h-8 text-[11px] leading-4 text-black/50">{card.note}</div>
          </div>
        </button>;
      })}
    </div>
    {statsError && <p role="alert" className="no-print mb-4 rounded-lg border border-brand bg-white px-3 py-2 text-xs text-black">{statsError}</p>}

    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="display-font text-sm font-extrabold">Received requests register</h2>
        <p className="text-[11px] text-muted">
          Print or download all {exportedTotal.toLocaleString('en-US')} {scopeLabel} — not just the current page.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PrintButton label={printing ? 'Preparing…' : 'Print Register'} tone="toolbar" disabled={printing} onClick={handlePrint} />
        <DownloadButton exportKey={report.exportKey} format="pdf" params={listParams} label="PDF" tone="toolbar" />
        <DownloadButton exportKey={report.exportKey} format="xlsx" params={listParams} label="Excel" tone="toolbar" />
        <DownloadButton exportKey={report.exportKey} format="csv" params={listParams} label="CSV" tone="toolbar" />
      </div>
    </div>

    <section className="print-only" aria-label="Print-ready requests received register">
      <table className="w-full text-left text-[9pt]">
        <thead>
          <tr>
            {['#', 'Request Reference', 'Requester', 'Department', 'Date Submitted', 'Number of Items', 'Status'].map((cell) => <th key={cell}>{cell}</th>)}
          </tr>
        </thead>
        <tbody>
          {printRows.map((request, index) => <tr key={request.id}>
            <td>{index + 1}</td>
            <td>{request.reference}</td>
            <td>{request.requester || '—'}</td>
            <td>{request.department || '—'}</td>
            <td>{dateLabel(request.submittedAt || request.createdAt)}</td>
            <td>{request.itemCount ?? 0}</td>
            <td>{request.status || '—'}</td>
          </tr>)}
        </tbody>
      </table>
      <p className="mt-3 text-[9pt]">
        {printRows.length.toLocaleString('en-US')} {scopeLabel} · Generated {dateTimeLabel(generatedAt)} · Supervisor approval alone never forwards a request to Procurement.
      </p>
    </section>

    <PageCard
      className="no-print"
      title="Requests register"
      description="Only complete requests explicitly forwarded by a Department Supervisor appear here."
      action={<button type="button" onClick={() => { load(); loadStats(); }}
        className={secondaryButtonClass('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand')}>
        <RefreshCw size={13} />Refresh
      </button>}>
      <div className="border-b border-subtle bg-white px-4 py-4 sm:px-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Request reference" className="w-full">
            <input value={filters.reference} onChange={(event) => updateFilter('reference', event.target.value)}
              placeholder="e.g. PR-2026-ABC123" aria-label="Request reference" className="field" />
          </FilterField>
          <FilterField label="Requester name" className="w-full">
            <input value={filters.requester} onChange={(event) => updateFilter('requester', event.target.value)}
              placeholder="Search requester" aria-label="Requester name" className="field" />
          </FilterField>
          <FilterField label="Department" className="w-full">
            <input value={filters.departmentQuery} onChange={(event) => updateFilter('departmentQuery', event.target.value)}
              placeholder="Search department" aria-label="Department" className="field" />
          </FilterField>
          <FilterField label="Request status" className="w-full">
            <select value={filters.status} onChange={(event) => setFilters((current) => ({
              ...current, status: event.target.value, statusGroup: '', page: 1
            }))} aria-label="Request status" className="field">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </FilterField>
        </div>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-subtle pt-4">
          <DateRangeFilter
            value={{ ...dateFilter, dateField: dateFilter.dateField || report.defaultField }}
            fields={report.fields}
            onChange={onDateFilterChange}
            label="Submission / forwarding"
            className="w-full"
          />
          <button type="button" onClick={clearFilters} disabled={!hasFilters}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand bg-white px-3 text-[11px] font-bold text-black transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40">
            <X size={12} />Clear Filters
          </button>
        </div>
      </div>

      <ErrorState message={error} onRetry={load} />
      {loading && !result ? <LoadingState label="Loading received requests…" /> : !requisitions.length ?
        <EmptyState
          title="No requests received"
          description="Department requests appear here only after their Supervisor explicitly forwards them to Procurement."
          action={<span className="mx-auto inline-flex items-center gap-2 rounded-lg border border-brand bg-white px-3 py-2 text-[11px] font-bold text-black"><Inbox size={14} />Awaiting Supervisor forwarding</span>}
        /> :
        <>
          <div className="overflow-hidden rounded-xl border border-brand bg-white shadow-dashboard">
            <TableScroll minWidth={1280} label="Requests register table">
              <table className="w-full table-fixed border-collapse text-left text-[13px] text-ink">
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '19%' }} />
                  <col style={{ width: '8%' }} />
                </colgroup>
                <thead className="bg-white">
                  <tr className="border-b border-subtle">
                    <th scope="col" className={`${HEADER_CLASS} whitespace-nowrap text-[11px] font-extrabold uppercase tracking-[.08em] text-black/50`}>#</th>
                    <th scope="col" className={`${HEADER_CLASS} whitespace-nowrap text-[11px] font-extrabold uppercase tracking-[.08em] text-black/50`}>Request Reference</th>
                    <th scope="col" className={`${HEADER_CLASS} whitespace-nowrap text-[11px] font-extrabold uppercase tracking-[.08em] text-black/50`}>Requester</th>
                    <SortHeader label="Department" sortKey="department" filters={filters} onSort={toggleSort} />
                    <SortHeader label="Date Submitted" sortKey="submittedAt" filters={filters} onSort={toggleSort} />
                    <th scope="col" className={`${HEADER_CLASS} whitespace-nowrap px-2 text-center text-[10px] font-extrabold uppercase tracking-[.06em] text-black/50`}>Number of Items</th>
                    <SortHeader label="Status" sortKey="status" filters={filters} onSort={toggleSort} />
                    <th scope="col" className={`${HEADER_CLASS} sticky right-0 z-10 whitespace-nowrap border-l border-subtle bg-white text-center text-[11px] font-extrabold uppercase tracking-[.08em] text-black/50`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requisitions.map((request, index) => <tr key={request.id} className="border-b border-subtle transition-colors last:border-b-0 hover:bg-hover">
                    <td className={`${CELL_CLASS} whitespace-nowrap text-[11px] tabular-nums text-black/40`}>
                      {((pagination?.page || 1) - 1) * filters.limit + index + 1}
                    </td>
                    <td className={`${CELL_CLASS} min-w-0`}>
                      <div className="flex min-w-0 flex-col gap-1">
                        <TextLink onClick={() => openDocument(request.id)} className="truncate !font-semibold">
                          {request.reference}
                        </TextLink>
                        <span className="block max-w-[280px] truncate text-[11px] font-normal leading-4 text-black/50"
                          title={request.title || ''}>
                          {request.title || '—'}
                        </span>
                      </div>
                    </td>
                    <td className={`${CELL_CLASS} truncate`} title={request.requester || ''}>{request.requester || '—'}</td>
                    <td className={`${CELL_CLASS} truncate`} title={request.department || ''}>{request.department || '—'}</td>
                    <td className={`${CELL_CLASS} whitespace-nowrap tabular-nums text-black/70`}
                      title={request.submittedAt ? dateTimeLabel(request.submittedAt) : ''}>
                      {request.submittedAt ? dateLabel(request.submittedAt) : '—'}
                    </td>
                    <td className={`${CELL_CLASS} text-center`}>
                      <span className="inline-flex min-w-[30px] justify-center rounded-md border border-brand bg-white px-2 py-1 text-[11px] font-bold tabular-nums"
                        aria-label={`${request.itemCount ?? 0} items`}>
                        {request.itemCount ?? 0}
                      </span>
                    </td>
                    <td className={CELL_CLASS}>
                      <StatusBadge value={request.status} className="whitespace-nowrap"
                        dotClassName={RECEIVED_STATUS_DOT[request.status] || 'bg-black/40'} />
                    </td>
                    <td className={`${CELL_CLASS} sticky right-0 z-10 whitespace-nowrap border-l border-subtle bg-white text-center`}>
                      <button type="button" onClick={() => openDocument(request.id)}
                        aria-label="View" title={`View request ${request.reference}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand bg-white px-2.5 text-[11px] font-bold text-black transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                        <Eye size={13} aria-hidden="true" />View
                      </button>
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </TableScroll>
          </div>
          <div className="mt-4 rounded-xl border border-brand bg-white px-4 py-3.5 shadow-dashboard sm:px-5">
            <Pagination
              pagination={pagination}
              onChange={(value) => updateFilter('page', value)}
              limit={filters.limit}
              onLimitChange={(value) => updateFilter('limit', value)}
              limitOptions={[10, 25, 50, 100]}
              tone="register"
            />
          </div>
        </>}
    </PageCard>

    <footer className="no-print mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand bg-white px-4 py-3 text-[11px] text-muted">
      <span className="inline-flex items-center gap-2">
        <RefreshCw size={13} aria-hidden="true" />
        <span>Refreshed <time dateTime={lastRefreshedAt}>{dateTimeLabel(lastRefreshedAt)}</time></span>
      </span>
      <span>Supervisor approval alone never forwards a request to Procurement.</span>
    </footer>
  </>;
}
