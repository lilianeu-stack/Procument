import { useCallback, useEffect, useState } from 'react';
import { Eye, FilePlus2, MessageSquare, Pencil, X } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import ReportToolbar from '../ui/ReportToolbar.jsx';
import RequestDetail from './RequestDetail.jsx';
import {
  EmptyState, ErrorState, FilterField, LoadingState, Pagination,
  SearchField, TableScroll, TextLink, primaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel, dateTimeLabel, formatDate } from '../../utils/format.js';
import { validateDateRange } from '../../utils/dates.js';
import { roleLabel } from '../../utils/access.js';
import {
  APPROVED_STATUS_FILTER, decisionLabel, normalizeStatus, statusLabel
} from '../../utils/status.js';

const REPORT = {
  exportKey: 'portalRequisitions',
  title: 'My purchase requisitions',
  defaultField: 'submitted',
  fields: [
    { key: 'submitted', label: 'Date submitted' },
    { key: 'created', label: 'Date created' },
    { key: 'approved', label: 'Supervisor decision' },
    { key: 'forwarded', label: 'Date forwarded' },
    { key: 'required', label: 'Required by' }
  ]
};

const PROCUREMENT_STATUSES = [
  'Forwarded to Procurement', 'Under Procurement Review', 'Procurement Approved',
  'Procurement Rejected', 'Processing', 'Completed'
];

// Values remain the exact statuses stored by the backend; labels are the
// familiar wording used across the Requester Portal.
const REQUESTER_STATUS_OPTIONS = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'Pending Supervisor Approval', label: 'Pending approval' },
  { value: 'Information Required', label: 'Information required' },
  { value: 'Approved by Supervisor', label: 'Approved' },
  { value: 'Rejected by Supervisor', label: 'Rejected' },
  { value: 'Forwarded to Procurement', label: 'Forwarded to Procurement' },
  { value: 'Under Procurement Review', label: 'Under Procurement Review' },
  { value: 'Procurement Approved', label: 'Procurement approved' },
  { value: 'Procurement Rejected', label: 'Procurement rejected' },
  { value: 'Processing', label: 'Processing' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Cancelled', label: 'Cancelled' }
];

const HEADER_CLASS = 'px-3 py-3.5 text-left text-[10px] font-extrabold uppercase tracking-[.08em] text-black';
const CELL_CLASS = 'px-3 py-3.5 align-middle';

function procurementStatus(request) {
  return PROCUREMENT_STATUSES.includes(request.status) ? request.status : '—';
}

function selectedStatusLabel(value) {
  if (!value) return 'All statuses';
  if (value === APPROVED_STATUS_FILTER) return 'Approved or forwarded';
  return REQUESTER_STATUS_OPTIONS.find((option) => option.value === value)?.label || statusLabel(value);
}

function filterSummary(filters, rangeError = '') {
  const summary = [];
  if (filters.search) summary.push(`Search: ${filters.search}`);
  if (filters.status) summary.push(`Status: ${selectedStatusLabel(filters.status)}`);
  if (rangeError) summary.push('Invalid date range (not applied)');
  else if (filters.from || filters.to) {
    const field = REPORT.fields.find((item) => item.key === filters.dateField)?.label || 'Date submitted';
    const from = filters.from ? formatDate(filters.from) : 'Beginning';
    const to = filters.to ? formatDate(filters.to) : 'Today';
    summary.push(`${field}: ${from} – ${to}`);
  }
  return summary.length ? summary.join(' · ') : 'None';
}

export default function RequesterRequests({
  portalApi, query = {}, navigate, history = false, initial = null, user = null, summary = null
}) {
  const pageName = history ? 'My Request History' : 'My Procurement Requests';
  const roleName = user?.roleLabel || roleLabel(user?.role);
  const departmentName = summary?.department?.name || user?.department || 'No Department assigned';
  const requesterName = user?.name || 'Requester';
  const [filters, setFilters] = useState({
    search: query.search || '',
    status: normalizeStatus(query.status) || (history ? 'Completed' : ''),
    preset: '',
    from: query.from || '',
    to: query.to || '',
    dateField: query.dateField || REPORT.defaultField,
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 10
  });
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [printRows, setPrintRows] = useState([]);
  const [printing, setPrinting] = useState(false);
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString());

  const requestId = query.request;
  const rangeError = validateDateRange(filters.from, filters.to);
  const listParams = {
    search: filters.search,
    status: filters.status,
    from: rangeError ? '' : filters.from,
    to: rangeError ? '' : filters.to,
    dateField: filters.dateField
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getRequesterRequests({
        ...listParams,
        page: filters.page,
        limit: filters.limit
      });
      setResult(response);
    } catch (exception) {
      setError(exception.message || 'Requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, listParams.search, listParams.status, listParams.from, listParams.to,
    listParams.dateField, filters.page, filters.limit]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!requestId) { setDetail(null); return; }
    setDetailLoading(true); setDetailError('');
    try {
      const response = await portalApi.getRequesterRequest(requestId);
      setDetail(response.requisition);
    } catch (exception) {
      setDetailError(exception.message || 'Request details could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }, [portalApi, requestId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? value : 1
    }));
  }

  function updateDateFilter(next) {
    setFilters((current) => ({
      ...current,
      preset: next.preset || '',
      from: next.from || '',
      to: next.to || '',
      dateField: next.dateField || REPORT.defaultField,
      page: 1
    }));
  }

  function clearFilters() {
    setFilters({
      search: '', status: history ? 'Completed' : '', preset: '', from: '', to: '',
      dateField: REPORT.defaultField, page: 1, limit: filters.limit
    });
  }

  function openRequest(id) {
    navigate(pageName, { ...query, request: id });
  }

  function closeRequest() {
    const next = { ...query };
    delete next.request;
    navigate(pageName, next);
  }

  // Printing must include every row matching the filters, not just the current
  // table page. Each page is fetched with the same predicates as the downloads.
  async function fetchAllMatchingRows() {
    const collected = [];
    let page = 1;
    let total = 0;
    do {
      const response = await portalApi.getRequesterRequests({ ...listParams, page, limit: 100 });
      const rows = response?.requisitions || [];
      total = Number(response?.pagination?.total) || 0;
      collected.push(...rows);
      page += 1;
      if (!rows.length || collected.length >= total || page > 100) break;
    } while (true);
    return collected;
  }

  async function handlePrint() {
    setPrinting(true); setError('');
    try {
      const rows = await fetchAllMatchingRows();
      setPrintRows(rows);
      setGeneratedAt(new Date().toISOString());
      await new Promise((resolve) => {
        if (!window.requestAnimationFrame) { resolve(); return; }
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
      });
      window.print();
    } catch (exception) {
      setError(exception.message || 'The print register could not be prepared.');
    } finally {
      setPrinting(false);
    }
  }

  const requisitions = result?.requisitions || [];
  const pagination = result?.pagination;
  const statusOptions = [...REQUESTER_STATUS_OPTIONS];
  if (filters.status === APPROVED_STATUS_FILTER) {
    statusOptions.push({ value: APPROVED_STATUS_FILTER, label: 'Approved or forwarded' });
  } else if (filters.status && !statusOptions.some((option) => option.value === filters.status)) {
    statusOptions.push({ value: filters.status, label: selectedStatusLabel(filters.status) });
  }
  const hasFilters = Boolean(filters.search || filters.status || filters.from || filters.to || filters.preset);
  const appliedFilters = filterSummary(filters, rangeError);

  return <>
    <section className="print-only requester-print-register" aria-label="Print-ready purchase requisition register">
      <div className="print-register-meta">
        <div><strong>System</strong><span>Hope Haven Procurement Management System</span></div>
        <div><strong>Report</strong><span>{REPORT.title}</span></div>
        <div><strong>Requester</strong><span>{requesterName}</span></div>
        <div><strong>Department</strong><span>{departmentName}</span></div>
        <div><strong>Generated</strong><span>{dateTimeLabel(generatedAt)}</span></div>
        <div><strong>Applied filters</strong><span>{appliedFilters}</span></div>
      </div>
      <table className="print-register-table">
        <thead>
          <tr>
            {['Reference', 'Title', 'Department', 'Submission date', 'Estimated cost', 'Current status', 'Supervisor decision', 'Procurement status'].map((heading) =>
              <th key={heading}>{heading}</th>)}
          </tr>
        </thead>
        <tbody>
          {printRows.length ? printRows.map((request) => <tr key={request.id}>
            <td>{request.reference}</td>
            <td>{request.title}<br />{request.itemsSummary || ''}</td>
            <td>{request.department || '—'}</td>
            <td>{request.submittedAt || request.createdAt ? dateLabel(request.submittedAt || request.createdAt) : '—'}</td>
            <td>{request.total === null || request.total === undefined ? '—' : currency(request.total)}</td>
            <td>{statusLabel(request.status)}</td>
            <td>{request.supervisorDecision ? decisionLabel(request.supervisorDecision) : 'Awaiting'}{request.forwardedAt ? ' · Forwarded' : ''}</td>
            <td>{procurementStatus(request)}</td>
          </tr>) : <tr><td colSpan={8}>No records match the active filters.</td></tr>}
        </tbody>
      </table>
      <p className="print-register-note">
        {printRows.length.toLocaleString('en-US')} matching record(s) · {appliedFilters} · Supervisor approval alone does not forward a request to Procurement.
      </p>
    </section>

    <section className="no-print mb-5 overflow-hidden rounded-xl border border-brand bg-white">
      <div className="flex flex-col gap-3 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p data-testid="requests-date" className="text-[11px] font-semibold text-black">{formatDate(new Date())}</p>
          <h1 data-testid="requests-title" className="display-font mt-1 text-[25px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[28px]">
            {pageName}
          </h1>
          <p data-testid="requests-context" className="mt-1 text-xs text-black">{roleName} · {departmentName}</p>
        </div>
      </div>
    </section>

    <ReportToolbar
      report={REPORT}
      dateFilter={filters}
      onDateFilterChange={updateDateFilter}
      params={listParams}
      onPrint={handlePrint}
      printing={printing}
      printLabel="Print My purchase requisitions"
      printDates={`Generated ${dateTimeLabel(generatedAt)}`}
      renderPrintTable={false}
    />

    <PageCard
      className="no-print"
      professional
      title={history ? 'My request history' : 'My procurement requests'}
      description={history
        ? 'Completed, cancelled and older requests you submitted.'
        : 'Track every request you have created, from draft to completion.'}
      action={!history && <button type="button" onClick={() => navigate('Create Purchase Request')} className={primaryButtonClass('min-h-10')}>
        <FilePlus2 size={15} aria-hidden="true" />New Request
      </button>}>
      <div className="border-b border-subtle bg-white px-5 py-5 sm:px-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-black">Search register</p>
            <p className="mt-1 text-xs text-black">Find requests by reference, title or item.</p>
          </div>
          {pagination?.total !== undefined && <span className="shrink-0 rounded-full border border-brand bg-white px-3 py-1.5 text-[10px] font-bold text-black">
            {Number(pagination.total).toLocaleString('en-US')} record{Number(pagination.total) === 1 ? '' : 's'}
          </span>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
        <SearchField
          value={filters.search}
          onChange={(value) => updateFilter('search', value)}
          onClear={() => updateFilter('search', '')}
          placeholder="Reference, title, item…"
          className="w-full sm:w-72"
        />
        <FilterField label="Status" className="w-full sm:w-60">
          <select
            value={filters.status}
            onChange={(event) => updateFilter('status', normalizeStatus(event.target.value))}
            className="field"
          >
            <option value="">All statuses</option>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </FilterField>
        {hasFilters && <button type="button" onClick={clearFilters}
          className="mb-0.5 inline-flex h-10 items-center gap-1.5 rounded-lg border border-brand bg-white px-3 text-[11px] font-bold text-black">
          <X size={12} aria-hidden="true" />Clear filters
        </button>}
        </div>
      </div>

      <ErrorState message={error} onRetry={load} />
      {loading && !result ? <LoadingState label="Loading your requests…" /> : !requisitions.length ?
        <EmptyState title={history ? 'No completed requests yet' : 'No requests found'}
          description={history ? 'Requests that finish processing will appear here.' : 'Use New Request to create your first purchase request.'} /> :
        <>
          <div className="overflow-hidden rounded-xl border border-brand bg-white">
            <TableScroll minWidth={1080} label="My procurement requests table" className="scrollbar-hide">
              <table className="w-full table-fixed border-collapse text-left text-[13px] text-black">
                <colgroup>
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead className="bg-black/[0.025]">
                  <tr className="border-b border-brand">
                    {['Reference', 'Title', 'Department', 'Submission date', 'Estimated cost', 'Current status', 'Supervisor decision', 'Procurement status', 'Actions'].map((heading, index) =>
                      <th key={heading} scope="col" className={`${HEADER_CLASS} ${index === 8 ? 'sticky right-0 z-10 border-l border-subtle bg-white' : ''}`}>{heading}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  {requisitions.map((request) => {
                    const itemsSummary = request.itemsSummary || `${request.attachmentCount || 0} attachment(s)`;
                    const submitted = request.submittedAt || request.createdAt;
                    return <tr key={request.id} className="group transition-colors hover:bg-accent-tint">
                      <td className={`${CELL_CLASS} min-w-0`}>
                        <TextLink onClick={() => openRequest(request.id)} className="block max-w-full truncate !font-semibold !text-[12px]" title={request.reference}>
                          {request.reference}
                        </TextLink>
                      </td>
                      <td className={`${CELL_CLASS} min-w-0`}>
                        <div className="max-w-full truncate font-semibold leading-4" title={request.title}>{request.title || '—'}</div>
                        <div className="mt-1 flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 max-w-full truncate text-[11px] leading-4 text-black" title={itemsSummary}>{itemsSummary}</span>
                          <TextLink onClick={() => openRequest(request.id)} className="shrink-0 !text-[10px]">View items</TextLink>
                        </div>
                      </td>
                      <td className={`${CELL_CLASS} truncate`} title={request.department || ''}>{request.department || '—'}</td>
                      <td className={`${CELL_CLASS} whitespace-nowrap tabular-nums text-black`}
                        title={submitted ? dateTimeLabel(submitted) : ''}>
                        {submitted ? dateLabel(submitted) : '—'}
                      </td>
                      <td className={`${CELL_CLASS} whitespace-nowrap font-bold tabular-nums`}>
                        {request.total === null || request.total === undefined ? '—' : currency(request.total)}
                      </td>
                      <td className={CELL_CLASS}><StatusBadge value={request.status} wrap /></td>
                      <td className={CELL_CLASS}>
                        <span className="inline-flex max-w-full flex-col items-start gap-0.5">
                          <span className="inline-flex max-w-full items-start gap-1.5 rounded-lg border border-brand bg-white px-2 py-1.5 text-left text-[10px] font-bold leading-4">
                            <span className="min-w-0 break-words">{request.supervisorDecision ? decisionLabel(request.supervisorDecision) : 'Awaiting'}</span>
                          </span>
                          {request.forwardedAt && <span className="block max-w-full break-words text-[9px] font-semibold leading-3 text-black">Forwarded by Supervisor</span>}
                        </span>
                      </td>
                      <td className={`${CELL_CLASS} text-black`}>
                        <span className="block max-w-full break-words leading-4">{procurementStatus(request)}</span>
                      </td>
                      <td className={`${CELL_CLASS} sticky right-0 z-10 whitespace-nowrap border-l border-subtle bg-white`}>
                        <span className="inline-flex max-w-full items-center gap-1">
                          <TextLink onClick={() => openRequest(request.id)} title={`View ${request.reference}`} className="!text-[11px]">
                            <span className="inline-flex items-center gap-1"><Eye size={13} aria-hidden="true" />View</span>
                          </TextLink>
                          {!history && request.status === 'Draft' && <button
                            type="button"
                            title={`Edit ${request.reference}`}
                            aria-label={`Edit ${request.reference}`}
                            onClick={() => navigate('Create Purchase Request', { request: request.id })}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-brand bg-white text-black"
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>}
                          {request.supervisorId && <button type="button" title="Message your Supervisor"
                            aria-label={`Message supervisor about ${request.reference}`}
                            onClick={() => navigate('Messages', { userId: request.supervisorId, request: request.id })}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-brand bg-white text-black">
                            <MessageSquare size={13} aria-hidden="true" />
                          </button>}
                        </span>
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </TableScroll>
          </div>
          <div className="mt-4 rounded-xl border border-brand bg-white px-4 py-3.5 sm:px-5">
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

    {requestId && detailLoading && <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/20"><LoadingState label="Opening request…" /></div>}
    {requestId && detailError && !detail && <div className="no-print fixed inset-0 z-50 grid place-items-center bg-black/20 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5">
        <ErrorState message={detailError} onRetry={loadDetail} />
        <button type="button" onClick={closeRequest} className={primaryButtonClass('w-full')}>Close</button>
      </div>
    </div>}
    {detail && <RequestDetail
      requisition={detail}
      portal="requester"
      portalApi={portalApi}
      onClose={closeRequest}
      onMessage={(userId, request) => navigate('Messages', { userId, request })}
      onEdit={!history && detail.status === 'Draft'
        ? () => navigate('Create Purchase Request', { request: detail.id })
        : undefined}
      onChanged={async () => { await loadDetail(); await load(); }}
    />}
  </>;
}
