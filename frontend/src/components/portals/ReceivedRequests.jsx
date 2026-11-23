import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Inbox, RefreshCw } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import ReportToolbar from '../ui/ReportToolbar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import {
  EmptyState, ErrorState, FilterBar, FilterField, LoadingState, Pagination,
  SearchField, TableScroll, TextLink, secondaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel, dateTimeLabel } from '../../utils/format.js';
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

const SORTABLE = [
  { key: 'reference', label: 'Reference' },
  { key: 'department', label: 'Department' },
  { key: 'requester', label: 'Requester' },
  { key: 'supervisorName', label: 'Supervisor' },
  { key: 'title', label: 'Title' },
  { key: 'submittedAt', label: 'Date submitted' },
  { key: 'forwardedAt', label: 'Date forwarded' },
  { key: 'total', label: 'Estimated total' },
  { key: 'status', label: 'Status' }
];

export default function ReceivedRequests({
  portalApi, query = {}, navigate, initial = null, dateFilter = {}, onDateFilterChange
}) {
  const report = reportForPage(RECEIVED_REQUESTS_PAGE);
  const [filters, setFilters] = useState({
    search: query.search || '',
    department: query.department || '',
    status: query.status || '',
    sort: query.sort || 'forwardedAt',
    direction: query.direction || 'desc',
    page: Number(query.page) || 1,
    limit: Number(query.limit) || 10
  });
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [departments, setDepartments] = useState([]);

  const dateQuery = dateQueryForFilter(dateFilter);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getReceivedRequests({ ...filters, ...dateQuery });
      setResult(response);
    } catch (exception) {
      setError(exception.message || 'Received requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, filters, dateQuery.from, dateQuery.to, dateQuery.dateField]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let active = true;
    portalApi.getDepartments?.()
      .then((response) => { if (active) setDepartments(response.departments || []); })
      .catch(() => { if (active) setDepartments([]); });
    return () => { active = false; };
  }, [portalApi]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' || key === 'limit' ? value : 1 }));
  }

  function toggleSort(key) {
    setFilters((current) => ({
      ...current,
      sort: key,
      direction: current.sort === key && current.direction === 'asc' ? 'desc' : 'asc',
      page: 1
    }));
  }

  function openDocument(id) {
    navigate(RECEIVED_REQUESTS_PAGE, { ...query, view: id });
  }

  const requisitions = result?.requisitions || [];
  const pagination = result?.pagination;

  return <>
    <ReportToolbar
      report={report}
      dateFilter={dateFilter}
      onDateFilterChange={onDateFilterChange}
      params={{ search: filters.search, department: filters.department, status: filters.status, sort: filters.sort, direction: filters.direction }}
    />
    <PageCard
      title="Requests received from Departments"
      description="Only complete requests explicitly forwarded by a Department Supervisor appear here."
      action={<button type="button" onClick={load} className={secondaryButtonClass()}><RefreshCw size={13} />Refresh</button>}>
      <FilterBar>
        <SearchField value={filters.search} onChange={(value) => updateFilter('search', value)} placeholder="Reference, title, requester, supervisor…" />
        <FilterField label="Department" className="w-full sm:w-52">
          <select value={filters.department} onChange={(event) => updateFilter('department', event.target.value)} className="field">
            <option value="">All departments</option>
            {departments.map((department) => <option key={department.id} value={department.name}>{department.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Status" className="w-full sm:w-52">
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="field">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </FilterField>
        {(filters.search || filters.department || filters.status) &&
          <button type="button" onClick={() => setFilters((current) => ({
            ...current, search: '', department: '', status: '', page: 1
          }))} className="mb-0.5 text-xs font-bold text-muted hover:text-brand">Clear filters</button>}
      </FilterBar>

      <ErrorState message={error} onRetry={load} />
      {loading && !result ? <LoadingState label="Loading received requests…" /> : !requisitions.length ?
        <EmptyState
          title="No requests received yet"
          description="Department requests appear here only after their Supervisor explicitly forwards them to Procurement."
          action={<span className="mx-auto inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-bold text-muted"><Inbox size={14} />Awaiting Supervisor forwarding</span>}
        /> :
        <>
          <TableScroll minWidth={1240}>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                <tr>
                  {SORTABLE.map(({ key, label }) => <th key={key} className="whitespace-nowrap px-4 py-3 font-bold">
                    <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-brand">
                      {label}
                      {filters.sort === key && (filters.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                    </button>
                  </th>)}
                  <th className="whitespace-nowrap px-4 py-3 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requisitions.map((request) => <tr key={request.id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-brand">
                    <TextLink onClick={() => openDocument(request.id)}>{request.reference}</TextLink>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{request.department || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{request.requester}</td>
                  <td className="whitespace-nowrap px-4 py-3">{request.supervisorName || request.forwardedByName || '—'}</td>
                  <td className="min-w-[190px] px-4 py-3">
                    <div className="font-semibold">{request.title}</div>
                    <div className="mt-0.5 text-[10px] text-muted">{request.attachmentCount || 0} attachment(s)</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{dateLabel(request.submittedAt || request.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{dateTimeLabel(request.forwardedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-bold">{currency(request.total)}</td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={request.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <TextLink onClick={() => openDocument(request.id)}>
                      <span className="inline-flex items-center gap-1"><Eye size={13} />View</span>
                    </TextLink>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 sm:px-5">
            <label className="flex items-center gap-2 text-[11px] text-muted">
              Rows per page
              <select value={filters.limit} onChange={(event) => updateFilter('limit', Number(event.target.value))} className="field w-20 py-1">
                {[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
            <Pagination pagination={pagination} onChange={(value) => updateFilter('page', value)} />
          </div>
        </>}
    </PageCard>
  </>;
}
