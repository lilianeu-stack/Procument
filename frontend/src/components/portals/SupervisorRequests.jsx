import { useCallback, useEffect, useState } from 'react';
import { Eye, MessageSquare } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import ReportToolbar from '../ui/ReportToolbar.jsx';
import RequestDetail from './RequestDetail.jsx';
import {
  EmptyState, ErrorState, FilterBar, LoadingState, Pagination,
  SearchField, TableScroll, TextLink
} from './PortalUi.jsx';
import { currency, dateLabel } from '../../utils/format.js';
import { requisitionDisplayReference } from '../../utils/requisitionDisplay.js';
import { roleLabel } from '../../utils/access.js';
import { REQUEST_STATUS_OPTIONS, normalizeStatus } from '../../utils/status.js';

const REPORT = {
  exportKey: 'portalRequisitions',
  title: 'Department purchase requisitions',
  defaultField: 'submitted',
  fields: [
    { key: 'submitted', label: 'Date submitted' },
    { key: 'created', label: 'Date created' },
    { key: 'approved', label: 'Supervisor decision' },
    { key: 'forwarded', label: 'Date forwarded' },
    { key: 'required', label: 'Required by' }
  ]
};

export default function SupervisorRequests({ portalApi, query = {}, navigate, initial = null, user = {} }) {
  const PAGE = 'Procurement Requests';
  const [filters, setFilters] = useState({
    search: query.search || '',
    status: query.status || '',
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
      const response = await portalApi.getSupervisorRequests(filters);
      setResult(response);
    } catch (exception) {
      setError(exception.message || 'Department requests could not be loaded.');
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
      const response = await portalApi.getSupervisorRequest(requestId);
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

  function clearFilters() {
    setFilters({
      search: '', status: '', preset: '', from: '', to: '',
      dateField: REPORT.defaultField, page: 1
    });
  }

  function openRequest(id) { navigate(PAGE, { ...query, request: id }); }
  function closeRequest() {
    const next = { ...query }; delete next.request; navigate(PAGE, next);
  }

  const requisitions = result?.requisitions || [];
  const reportUser = user?.name
    ? { name: user.name, roleLabel: roleLabel(user.role), department: user.department }
    : null;

  return <>
    <ReportToolbar
      report={REPORT}
      dateFilter={filters}
      onDateFilterChange={updateDateFilter}
      params={{ search: filters.search, status: filters.status }}
      user={reportUser}
      department={user.department || ''}
      scope="department requisitions"
      dateFilterFromToOnly
      dateFilterContent={<>
        <label className="block min-w-0">
          <span className="block text-[10px] font-bold uppercase leading-4 tracking-[.08em] text-black">Status</span>
          <select value={filters.status} onChange={(event) => updateFilter('status', normalizeStatus(event.target.value))} className="field mt-0">
            <option value="">All statuses</option>
            {REQUEST_STATUS_OPTIONS.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
      </>}
    />
    <PageCard>
      <FilterBar>
        <SearchField value={filters.search} onChange={(value) => updateFilter('search', value)} placeholder="Reference, title, requester…" />
        {(filters.search || filters.status || filters.from || filters.to) &&
          <button type="button" onClick={clearFilters}
            className="mb-0.5 text-xs font-bold text-black hover:text-black">Clear filters</button>}
      </FilterBar>

      <ErrorState message={error} onRetry={load} />
      {loading && !result ? <LoadingState label="Loading Department requests…" /> : !requisitions.length ?
        <EmptyState title="No requests found" description="Requests from your Department will appear here." /> :
        <>
          <TableScroll minWidth={1160}>
            <table className="w-full text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-black">
                <tr>{['Reference', 'Requester', 'Title', 'Submission date', 'Estimated cost', 'Approval status', 'Actions'].map((heading) =>
                  <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {requisitions.map((request) => <tr key={request.id} className="hover:bg-white">
                  <td className="whitespace-nowrap px-4 py-3 font-bold text-black">
                    <TextLink onClick={() => openRequest(request.id)} title={requisitionDisplayReference(request)}>
                      {requisitionDisplayReference(request)}
                    </TextLink>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="font-semibold">{request.requester}</div>
                    <div className="text-[10px] text-black">{request.requesterEmail}</div>
                  </td>
                  <td className="min-w-[180px] px-4 py-3">{request.title}</td>
                  <td className="whitespace-nowrap px-4 py-3">{dateLabel(request.submittedAt || request.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-bold">{currency(request.total)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div><StatusBadge value={request.status} /></div>
                    {request.supervisorDecision && <div className="mt-1 text-[10px] text-black">Decision: {request.supervisorDecision}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex items-center gap-3">
                      <TextLink onClick={() => openRequest(request.id)}><span className="inline-flex items-center gap-1"><Eye size={13} />View</span></TextLink>
                      <button type="button" title="Message Requester"
                        onClick={() => navigate('Department Messages', { userId: request.requesterId, request: request.id })}
                        className="text-black hover:text-black"><MessageSquare size={14} /></button>
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll>
          <Pagination pagination={result?.pagination} onChange={(value) => updateFilter('page', value)} />
        </>}
    </PageCard>

    {requestId && detailLoading && <div className="fixed inset-0 z-50 grid place-items-center bg-black/20"><LoadingState label="Opening request…" /></div>}
    {requestId && detailError && !detail && <div className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 ">
        <ErrorState message={detailError} onRetry={loadDetail} />
        <button type="button" onClick={closeRequest} className="mt-2 w-full rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black">Close</button>
      </div>
    </div>}
    {detail && <RequestDetail
      requisition={detail}
      portal="supervisor"
      portalApi={portalApi}
      onClose={closeRequest}
      onMessage={(userId, request) => navigate('Department Messages', { userId, request })}
      onChanged={async () => { await loadDetail(); await load(); }}
    />}
  </>;
}
