import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle2, FileText, Loader2, LockKeyhole, Mail,
  ShieldCheck, XCircle
} from 'lucide-react';
import PublicPrintToolbar from '../ui/PublicPrintToolbar.jsx';
import StatusBadge from '../ui/StatusBadge.jsx';
import PurchaseOrderDocument from '../documents/PurchaseOrderDocument.jsx';
import SupplierPricingAwardSummary from '../documents/SupplierPricingAwardSummary.jsx';
import { api } from '../../services/api.js';
import { roleLabel } from '../../utils/access.js';
import { dateLabel, dateTimeLabel } from '../../utils/format.js';

function Meta({ label, value }) {
  return <div className="rounded-lg border border-brand bg-white p-3">
    <dt className="text-[10px] font-bold uppercase tracking-wide text-black">{label}</dt>
    <dd className="mt-1 break-words text-xs font-semibold text-black">{value || '—'}</dd>
  </div>;
}

export default function PurchaseOrderApprovalPage({ token }) {
  const [approval, setApproval] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loginNotice, setLoginNotice] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailWarning, setEmailWarning] = useState('');
  const [login, setLogin] = useState({ email: '', password: '' });
  const [pendingDecision, setPendingDecision] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setError('This approval link is missing its access token.'); setLoading(false); return; }
    setLoading(true); setError(''); setNeedsLogin(false); setLoginNotice('');
    try {
      const response = await api(`/purchase-order-approvals/${encodeURIComponent(token)}`);
      setApproval(response.approval);
    } catch (exception) {
      if ([401, 403].includes(exception.status)) {
        setNeedsLogin(true);
        setLoginNotice(exception.status === 403
          ? 'This link is reserved for another registered user. Sign in with the intended recipient account.'
          : 'Sign in with the intended recipient account to review this purchase order.');
      } else {
        setError(exception.message || 'This approval link could not be opened.');
      }
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function signIn(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: login.email, password: login.password })
      });
      localStorage.setItem('pims-token', result.token);
      setLogin({ email: '', password: '' });
      await load();
    } catch (exception) {
      setError(exception.message || 'Sign in failed.');
    } finally { setBusy(false); }
  }

  async function decide() {
    const decision = pendingDecision;
    if (!decision) return;
    if (decision === 'Rejected' && !comment.trim()) { setError('A rejection reason is required.'); return; }
    setBusy(true); setError(''); setNotice(''); setEmailWarning('');
    try {
      const result = await api(`/purchase-order-approvals/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, comment: comment.trim() })
      });
      setApproval(result.approval);
      setPendingDecision('');
      setComment('');
      setNotice(result.message || 'Your decision has been recorded.');
      if (result.emailDelivery && !result.emailDelivery.ok) {
        setEmailWarning(result.emailDelivery.error?.message || result.emailDelivery.reason || 'The sender could not be notified by email.');
      }
    } catch (exception) {
      setError(exception.message || 'The decision could not be recorded.');
    } finally { setBusy(false); }
  }

  const canDecide = approval && approval.status === 'Pending' && approval.purchaseOrder?.status === 'Pending approval';
  const decided = approval && ['Approved', 'Rejected'].includes(approval.status);

  return <div className="min-h-screen bg-canvas">
    <header className="no-print border-b bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black">Secure approval link</span>
      </div>
    </header>

    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      {loading && <div className="flex items-center justify-center gap-2 rounded-xl border bg-white p-10 text-sm text-black"><Loader2 size={16} className="animate-spin" />Opening secure purchase order…</div>}
      {!loading && error && <div className="flex items-start gap-2 rounded-xl border border-brand bg-white p-5 text-sm font-semibold text-black"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div>}
      {!loading && notice && <div className="flex items-start gap-2 rounded-xl border border-brand bg-white p-5 text-sm font-semibold text-black"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{notice}</div>}
      {!loading && emailWarning && <div className="flex items-start gap-2 rounded-xl border border-brand bg-white p-5 text-xs text-black"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span><strong>Email notice:</strong> {emailWarning}</span></div>}

      {!loading && needsLogin && <section className="mx-auto max-w-lg rounded-xl border border-brand bg-white p-6">
        <div className="flex items-center gap-2 text-black"><LockKeyhole size={18} /><h1 className="display-font text-xl font-extrabold">Sign in to review</h1></div>
        <p className="mt-2 text-sm leading-6 text-black">{loginNotice}</p>
        <form onSubmit={signIn} className="mt-5 space-y-4">
          <label className="block text-xs font-bold">Registered email
            <input required type="email" value={login.email} onChange={(event) => setLogin({ ...login, email: event.target.value })} className="field mt-1" />
          </label>
          <label className="block text-xs font-bold">Password
            <input required type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} className="field mt-1" />
          </label>
          <button disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-xs font-bold text-black disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <LockKeyhole size={14} />}
            {busy ? 'Signing in…' : 'Sign in and continue'}
          </button>
        </form>
      </section>}

      {!loading && approval && <>
        <PublicPrintToolbar
          title="Purchase order approval"
          reference={approval.purchaseOrder.reference}
          label="Print approval"
          note="Print the signed-link purchase order and approval decision for your records."
        />
        <section className="rounded-xl border border-brand bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-black">Purchase order review</p>
              <h1 className="display-font mt-1 text-2xl font-extrabold text-black">{approval.purchaseOrder.reference}</h1>
              <p className="mt-1 text-sm text-black">Sent to {approval.recipient.name} · {approval.recipient.roleLabel || roleLabel(approval.recipient.role)}</p>
            </div>
            <div className="text-right">
              <StatusBadge value={approval.purchaseOrder.status} />
              <p className="mt-2 text-[10px] text-black">Approval request: {approval.status}</p>
            </div>
          </div>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Meta label="Prepared By" value={approval.purchaseOrder.preparedBy} />
            <Meta label="Current Approval Status" value={approval.purchaseOrder.status} />
            <Meta label="Awarded RFQ" value={approval.purchaseOrder.rfq} />
            <Meta label="Sender" value={approval.sender.name} />
            <Meta label="Date sent" value={dateTimeLabel(approval.sentAt)} />
            <Meta label="Optional message from sender" value={approval.message} />
          </dl>
          {approval.message && <p className="mt-4 rounded-lg border border-brand bg-white p-4 text-sm italic leading-6 text-black">“{approval.message}”</p>}
        </section>

        <section className="rounded-xl border border-brand bg-white">
          <div className="no-print flex items-center gap-2 border-b px-5 py-4"><FileText size={16} className="text-black" /><h2 className="text-sm font-extrabold">Official purchase order</h2></div>
          <div className="space-y-4 overflow-x-auto p-3 sm:p-5">
            <SupplierPricingAwardSummary award={approval.purchaseOrder.supplierPricingAward} />
            <PurchaseOrderDocument order={approval.purchaseOrder} />
          </div>
        </section>

        <section className="no-print rounded-xl border border-brand bg-white p-5 sm:p-6">
          {canDecide ? <>
            <div className="flex items-start gap-2 text-black"><ShieldCheck size={18} className="mt-0.5" />
              <div><h2 className="text-sm font-extrabold">Record your decision</h2><p className="mt-1 text-xs text-black">Your decision updates the original purchase order immediately.</p></div>
            </div>
            {!pendingDecision ? <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => { setPendingDecision('Approved'); setError(''); }}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-xs font-bold text-black hover:bg-brand">
                <CheckCircle2 size={15} />Approve
              </button>
              <button type="button" onClick={() => { setPendingDecision('Rejected'); setError(''); }}
                className="inline-flex items-center gap-2 rounded-lg border border-brand bg-white px-4 py-2.5 text-xs font-bold text-black hover:bg-white">
                <XCircle size={15} />Reject
              </button>
            </div> : <div className="mt-5 max-w-2xl space-y-4">
              <div className="rounded-lg border border-brand bg-white p-4 text-xs">
                <strong>{pendingDecision === 'Approved' ? 'Confirm approval' : 'Confirm rejection'}</strong>
                <p className="mt-1 leading-5 text-black">{pendingDecision === 'Approved'
                  ? 'You are approving this purchase order. A confirmation will be sent to the sender.'
                  : 'You are rejecting this purchase order. A reason is required and will be sent to the sender.'}</p>
              </div>
              <label className="block text-xs font-bold">{pendingDecision === 'Approved' ? 'Optional approval comment' : 'Rejection reason *'}
                <textarea rows="3" value={comment} onChange={(event) => { setComment(event.target.value); setError(''); }}
                  placeholder={pendingDecision === 'Approved' ? 'Add an optional comment…' : 'Explain why this purchase order is being rejected…'}
                  className="field mt-1 h-auto py-2" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={decide} disabled={busy}
                  className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold text-black disabled:opacity-60 ${pendingDecision === 'Approved' ? 'bg-brand' : 'bg-brand'}`}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  {busy ? 'Recording…' : `Confirm ${pendingDecision === 'Approved' ? 'approval' : 'rejection'}`}
                </button>
                <button type="button" onClick={() => { setPendingDecision(''); setComment(''); setError(''); }} disabled={busy}
                  className="rounded-lg border border-brand px-4 py-2.5 text-xs font-bold disabled:opacity-50">Cancel</button>
              </div>
            </div>}
          </> : <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold">Decision recorded</h2>
              <p className="mt-1 text-xs text-black">
                {approval.status} by {approval.recipient.name}
                {approval.decidedAt ? ` on ${dateTimeLabel(approval.decidedAt)}` : ''}
                {approval.decisionComment ? ` · “${approval.decisionComment}”` : ''}
              </p>
            </div>
            <Mail size={18} className="text-black" />
          </div>}
        </section>
      </>}
    </main>
  </div>;
}
