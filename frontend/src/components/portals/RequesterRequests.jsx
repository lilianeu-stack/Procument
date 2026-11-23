import { useCallback, useEffect, useState } from 'react';
import { Eye, MessageSquare, Plus } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import ReportToolbar from '../ui/ReportToolbar.jsx';
import RequestDetail from './RequestDetail.jsx';
import {
  EmptyState, ErrorState, FilterBar, FilterField, LoadingState, Pagination,
  SearchField, TableScroll, TextLink, primaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel } from '../../utils/format.js';
import { REQUEST_STATUS_OPTIONS, normalizeStatus } from '../../utils/status.js';

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

function procurementStatus(request) {
  return PROCUREMENT_STATUSES.includes(request.status) ? request.status : '—';
}

export default function RequesterRequests({
  portalApi, query = {}, navigate, history = false, initial = null
}) {
  const pageName = history ? 'My Request History' : 'My Procurement Requests';
  const [filters, setFilters] = useState({
    search: query.search || '',
    status: query.status || (history ? 'Completed' : ''),
    preset: '',
    from: query.from || '',
    to: query.to || '',
    dateField: query.dateField || REPORT.defaultField,
    page: Number(query.page) || 1
  });
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const requestId = query.request;
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getRequesterRequests(filters);
      setResult(response);
    } catch (exception) {
      setError(exception.message || 'Requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, filters.search, filters.status, filters.from, filters.to, filters.dateField, filters.page]);

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
    setFilters((current) => ({ ...current, [key]: value, page: key === 'page' ? value : 1 }));
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

  function openRequest(id) {
    navigate(pageName, { ...query, request: id });
  }

  function closeRequest() {
    const next = { ...query };
    delete next.request;
    navigate(pageName, next);
  }

  const requisitions = result?.requisitions || [];
  const pagination = result?.pagination;

  return <>
    <ReportToolbar
      report={REPORT}
      dateFilter={filters}
      onDateFilterChange={updateDateFilter}
      params={{ search: filters.search, status: filters.status }}
    />
    <PageCard
      title={history ? 'My request history' : 'My procurement requests'}
      description={history
        ? 'Completed, cancelled and older requests you submitted.'
        : 'Track every request you have created, from draft to completion.'}
      action={!history && <button type="button" onClick={() => navigate('Create Purchase Request')} className={primaryButtonClass()}>
        <Plus size={14} />New Request
      </button>}>
      <FilterBar>
        <SearchField value={filters.search} onChange={(value) => updateFilter('search', value)} placeholder="Reference, title, item…" />
        <FilterField label="Status" className="w-full sm:w-56">
          <select value={filters.status} onChange={(event) => updateFilter('status', normalizeStatus(event.target.value))} className="field">
            <option value="">All statuses</option>
            {REQUEST_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </FilterField>
        {(filters.search || filters.status || filters.from || filters.to) &&
          <button type="button" onClick={() => setFilters({
            search: '', status: '', preset: '', from: '', to: '',
            dateField: REPORT.defaultField, page: 1
          })}
            className="mb-0.5 text-xs font-bold text-muted hover:text-brand">Clear filters</button>}
      </FilterBar>

      <ErrorState message={error} onRetry={load} />
      {loading && !result ? <LoadingState label="Loading your requests…" /> : !requisitions.length ?
        <EmptyState title={history ? 'No completed requests yet' : 'No requests found'}
          description={history ? 'Requests that finish processing will appear here.' : 'Use New Request to create your first purchase request.'} /> :
        <>
          <TableScroll minWidth={1120}>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                <tr>
                  {['Reference', 'Title', 'Department', 'Submission date', 'Estimated cost', 'Current status', 'Supervisor decision', 'Procurement status', 'Actions'].map((heading) =>
                    <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requisitions.map((request) => <tr key={request.id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-brand">
                    <TextLink onClick={() => openRequest(request.id)}>{request.reference}</TextLink>
                  </td>
                  <td className="min-w-[190px] px-4 py-3">
                    <div className="font-semibold">{request.title}</div>
                    <div className="mt-0.5 text-[10px] text-muted">{request.itemsSummary || `${request.attachmentCount || 0} attachment(s)`}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{request.department || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{dateLabel(request.submittedAt || request.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-bold">{currency(request.total)}</td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={request.status} /></td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${request.supervisorDecision === 'Approve' ? 'bg-emerald-50 text-emerald-700' : request.supervisorDecision === 'Reject' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                      {request.supervisorDecision || 'Awaiting'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{procurementStatus(request)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-3">
                      <TextLink onClick={() => openRequest(request.id)}><span className="inline-flex items-center gap-1"><Eye size={13} />View</span></TextLink>
                      {request.supervisorId && <button type="button" title="Message your Supervisor"
                        onClick={() => navigate('Messages', { userId: request.supervisorId, request: request.id })}
                        className="text-muted hover:text-brand"><MessageSquare size={14} /></button>}
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll>
          <Pagination pagination={pagination} onChange={(value) => updateFilter('page', value)} />
        </>}
    </PageCard>

    {requestId && detailLoading && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30"><LoadingState label="Opening request…" /></div>}
    {requestId && detailError && !detail && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
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
      onChanged={async () => { await loadDetail(); await load(); }}
    />}
  </>;
}
