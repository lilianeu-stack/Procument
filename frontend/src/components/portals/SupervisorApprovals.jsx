import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, Info, RefreshCw, Send, XCircle } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import ReportToolbar from '../ui/ReportToolbar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import RequestDetail from './RequestDetail.jsx';
import {
  EmptyState, ErrorState, LoadingState, PageHeader, TableScroll, TextLink,
  primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel, dateTimeLabel } from '../../utils/format.js';
import { roleLabel } from '../../utils/access.js';
import { SUPERVISOR_PENDING } from '../../utils/status.js';

const REPORT = {
  exportKey: 'portalRequisitions',
  title: 'Supervisor decisions',
  defaultField: 'approved',
  fields: [
    { key: 'approved', label: 'Decision date' },
    { key: 'submitted', label: 'Date submitted' },
    { key: 'created', label: 'Date created' },
    { key: 'forwarded', label: 'Date forwarded' },
    { key: 'required', label: 'Required by' }
  ]
};

const DECISION_STATUSES = [
  'Approved by Supervisor', 'Rejected by Supervisor', 'Information Required'
];

const DECISION_BUTTONS = [
  { value: 'Approve', icon: CheckCircle2, className: 'border-brand bg-white text-black' },
  { value: 'Request Information', icon: Info, className: 'border-brand bg-white text-black' },
  { value: 'Reject', icon: XCircle, className: 'border-brand bg-white text-black' }
];

export default function SupervisorApprovals({ portalApi, query = {}, navigate, initial = null, user = {} }) {
  const PAGE = 'Approvals';
  const [pending, setPending] = useState(initial?.requisitions || []);
  const [decided, setDecided] = useState([]);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [reportFilter, setReportFilter] = useState({
    preset: '', from: '', to: '', dateField: REPORT.defaultField, status: ''
  });
  const [activeId, setActiveId] = useState(null);
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [forwardBusy, setForwardBusy] = useState(null);
  const [forwardError, setForwardError] = useState('');
  const [rowError, setRowError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const requestId = query.request;

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [pendingResponse, recentResponse] = await Promise.all([
        portalApi.getSupervisorRequests({ status: SUPERVISOR_PENDING, page: 1, limit: 100 }),
        portalApi.getSupervisorRequests({
          hasDecision: 1,
          status: reportFilter.status,
          from: reportFilter.from,
          to: reportFilter.to,
          dateField: reportFilter.dateField,
          page: 1,
          limit: 25
        })
      ]);
      setPending(pendingResponse.requisitions || []);
      setDecided((recentResponse.requisitions || []).filter((request) => request.supervisorDecision).slice(0, 10));
    } catch (exception) {
      setError(exception.message || 'Approval queue could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, reportFilter.status, reportFilter.from, reportFilter.to, reportFilter.dateField]);

  useEffect(() => { load(); }, [load]);

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

  function choose(id, value) {
    setActiveId(id); setDecision(value); setRowError('');
    if (value === 'Approve') setReason('');
  }

  async function confirm(request) {
    if (decision !== 'Approve' && !reason.trim()) {
      setRowError('A reason is required when rejecting or requesting information.');
      return;
    }
    setBusy(true); setRowError('');
    try {
      await portalApi.decideRequest(request.id, { decision, reason: reason.trim() });
      setActiveId(null); setDecision(''); setReason('');
      await load();
      await portalApi.reload();
      if (Number(requestId) === Number(request.id)) await loadDetail();
    } catch (exception) {
      setRowError(exception.message || 'The decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  async function forward(request) {
    setForwardBusy(request.id); setForwardError('');
    try {
      await portalApi.forwardRequest(request.id);
      await load();
      await portalApi.reload();
      if (Number(requestId) === Number(request.id)) await loadDetail();
    } catch (exception) {
      setForwardError(exception.message || 'The request could not be forwarded.');
    } finally {
      setForwardBusy(null);
    }
  }

  function updateReportFilter(next) {
    setReportFilter((current) => ({ ...current, ...next }));
  }

  function closeRequest() {
    const next = { ...query }; delete next.request; navigate(PAGE, next);
  }

  const reportUser = user?.name
    ? { name: user.name, roleLabel: roleLabel(user.role), department: user.department }
    : null;

  return <>
    <ReportToolbar
      report={REPORT}
      dateFilter={reportFilter}
      onDateFilterChange={updateReportFilter}
      params={{ hasDecision: 1, status: reportFilter.status }}
      user={reportUser}
      department={user.department || ''}
      scope="supervisor decisions"
    />
    <PageHeader
      eyebrow="Your Department review queue"
      title="Incoming requests"
      description="Review requests, verify live stock, then route each approved request to the Procurement Office or the Stock Keeper. Approval alone never sends a request to either destination."
      actions={<div className="flex flex-wrap items-center gap-2">
        <select
          value={reportFilter.status}
          onChange={(event) => updateReportFilter({ status: event.target.value })}
          className="field h-9 w-auto bg-white"
          aria-label="Decision report status"
        >
          <option value="">All decisions</option>
          {DECISION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <button type="button" onClick={load} className={secondaryButtonClass()}><RefreshCw size={13} />Refresh</button>
      </div>}
    />

    <ErrorState message={error || forwardError} onRetry={load} />

    <PageCard title="Incoming requests awaiting review" description={pending.length ? `${pending.length} request${pending.length === 1 ? '' : 's'} in your queue` : 'Queue is clear'}>
      {loading && !initial ? <LoadingState label="Loading approval queue…" /> : !pending.length ?
        <EmptyState title="Nothing awaiting approval" description="New submissions from your Department will appear here." /> :
        <TableScroll minWidth={1000}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{['Reference', 'Requester', 'Title', 'Submitted', 'Estimated cost', 'Priority', 'Status', 'Decision', ''].map((heading) =>
                <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {pending.map((request) => <tr key={request.id} className={activeId === request.id ? 'bg-white' : 'hover:bg-white'}>
                <td className="whitespace-nowrap px-4 py-3 font-bold text-black">
                  <TextLink onClick={() => navigate(PAGE, { ...query, request: request.id })}>{request.reference}</TextLink>
                </td>
                <td className="whitespace-nowrap px-4 py-3">{request.requester}</td>
                <td className="min-w-[170px] px-4 py-3">{request.title}</td>
                <td className="whitespace-nowrap px-4 py-3">{dateLabel(request.submittedAt || request.createdAt)}</td>
                <td className="whitespace-nowrap px-4 py-3 font-bold">{currency(request.total)}</td>
                <td className="whitespace-nowrap px-4 py-3">{request.priority || 'Medium'}</td>
                <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={request.status} /></td>
                <td className="px-4 py-3">
                  {activeId === request.id ? <div className="min-w-[240px] space-y-2">
                    {decision !== 'Approve' && <textarea rows="2" value={reason} onChange={(event) => setReason(event.target.value)}
                      placeholder="Reason (required)…" className="field h-auto py-2" />}
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" disabled={busy} onClick={() => confirm(request)} className={primaryButtonClass('px-2.5 py-1.5')}>
                        {busy ? 'Saving…' : `Confirm ${decision}`}
                      </button>
                      <button type="button" onClick={() => { setActiveId(null); setRowError(''); }} className="text-[11px] font-bold text-black hover:text-black">Cancel</button>
                    </div>
                    {rowError && <p role="alert" className="text-[11px] text-black">{rowError}</p>}
                  </div> : <div className="flex items-center gap-1.5">
                    {DECISION_BUTTONS.map(({ value, icon: Icon, className }) => <button key={value} type="button"
                      onClick={() => choose(request.id, value)} title={value}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-bold ${className}`}>
                      <Icon size={12} />{value === 'Request Information' ? 'Info' : value === 'Approve' ? 'Approve' : 'Reject'}
                    </button>)}
                    <button type="button" onClick={() => navigate(PAGE, { ...query, request: request.id })} title="View full request" className="ml-1 text-black hover:text-black"><Eye size={14} /></button>
                  </div>}
                </td>
                <td className="whitespace-nowrap px-4 py-3" />
              </tr>)}
            </tbody>
          </table>
        </TableScroll>}
    </PageCard>

    <div className="mt-5"><PageCard title="Recently decided" description="Your latest approval decisions for this Department.">
      {decided.length ? <TableScroll minWidth={780}>
        <table className="w-full text-left text-xs">
          <thead className="bg-white text-[10px] uppercase text-black">
            <tr>{['Reference', 'Requester', 'Decision', 'Note', 'Decided at', 'Status', ''].map((heading) =>
              <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {decided.map((request) => <tr key={request.id}>
              <td className="whitespace-nowrap px-4 py-3 font-bold text-black">
                <TextLink onClick={() => navigate(PAGE, { ...query, request: request.id })}>{request.reference}</TextLink>
              </td>
              <td className="whitespace-nowrap px-4 py-3">{request.requester}</td>
              <td className="whitespace-nowrap px-4 py-3 font-bold">{request.supervisorDecision}</td>
              <td className="max-w-[220px] truncate px-4 py-3 text-black">{request.supervisorNotes || '—'}</td>
              <td className="whitespace-nowrap px-4 py-3">{dateTimeLabel(request.supervisorDecisionAt)}</td>
              <td className="whitespace-nowrap px-4 py-3"><StatusBadge value={request.status} /></td>
              <td className="whitespace-nowrap px-4 py-3">
                <div className="flex items-center gap-3">
                  {request.supervisorDecision === 'Approved' && request.status === 'Approved by Supervisor' && !request.forwardedBySupervisor &&
                    <button type="button" disabled={forwardBusy === request.id} onClick={() => forward(request)}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand px-2 py-1.5 text-[10px] font-bold text-black hover:bg-brand disabled:opacity-50">
                      <Send size={11} />{forwardBusy === request.id ? 'Forwarding…' : 'Forward to Procurement'}
                    </button>}
                  <TextLink onClick={() => navigate(PAGE, { ...query, request: request.id })}>View</TextLink>
                </div>
              </td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll> : <EmptyState title="No decisions yet" description="Requests you approve, reject or query will be listed here." />}
    </PageCard></div>

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
      onChanged={async () => { await loadDetail(); await load(); await portalApi.reload(); }}
    />}
  </>;
}
