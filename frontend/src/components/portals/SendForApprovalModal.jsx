import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Mail, Send, ShieldCheck } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import { ErrorMessage } from '../ui/PageCard.jsx';
import { roleLabel } from '../../utils/access.js';
import { dateLabel } from '../../utils/format.js';
import { formatRwf } from '../../utils/purchaseCalculations.js';

export default function SendForApprovalModal({ order, loadApprovers, onSend, onClose, onSent }) {
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [recipientId, setRecipientId] = useState('');
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState('compose');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoadingUsers(true);
    loadApprovers()
      .then((response) => {
        if (!active) return;
        const list = response.users || response.approvers || [];
        setUsers(Array.isArray(list) ? list : []);
      })
      .catch((exception) => { if (active) setError(exception.message || 'Could not load eligible approvers.'); })
      .finally(() => { if (active) setLoadingUsers(false); });
    return () => { active = false; };
  }, [loadApprovers]);

  const recipient = useMemo(
    () => users.find((user) => String(user.id) === String(recipientId)) || null,
    [users, recipientId]
  );
  const emailDelivery = result?.emailDelivery;

  async function confirmSend() {
    if (!recipient) { setError('Choose an authorized recipient.'); return; }
    setBusy(true);
    setError('');
    try {
      const response = await onSend(order, {
        recipientId: Number(recipient.id),
        message: message.trim()
      });
      setResult(response);
      setStage('sent');
      onSent?.(response);
    } catch (exception) {
      setError(exception.message || 'The request could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={`Send ${order.reference || 'purchase order'} for approval`} size="lg" onClose={onClose}>
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-brand">Purchase order being sent</p>
            <h3 className="display-font mt-1 text-lg font-extrabold">{order.reference || 'New purchase order'}</h3>
            <p className="mt-1 text-xs text-muted">{order.supplier || 'Supplier not recorded'} · {order.type || 'Standard'}</p>
          </div>
          <div className="text-right text-xs">
            <div className="text-muted">Total amount</div>
            <div className="mt-1 font-extrabold text-brand">{formatRwf(order.total)}</div>
            <div className="mt-1 text-[10px] text-muted">Delivery {dateLabel(order.deliveryDate)}</div>
          </div>
        </div>
        {!order.id && <p className="mt-3 rounded-md bg-white px-3 py-2 text-[10px] text-muted">
          The current purchase order draft will be saved first, then sent with a secure review link.
        </p>}
      </section>

      {stage === 'sent' ? <section className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <div>
            <strong>Sent for approval.</strong>
            <p className="mt-1 text-xs leading-5">
              {emailDelivery?.ok === false
                ? <>The request was saved, but the secure review link was not delivered to {recipient?.name || 'the recipient'}.
                  Resolve the email configuration and send again. Sending does not approve the purchase order.</>
                : <>The request was saved and a secure review link was sent to {recipient?.name || 'the recipient'}.
                  Sending does not approve the purchase order.</>}
            </p>
          </div>
        </div>
        {emailDelivery && !emailDelivery.ok && <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>Email was not delivered.</strong>
            <p className="mt-1 leading-5">{emailDelivery.error?.message || emailDelivery.reason || 'The email provider did not accept the message.'}</p>
          </div>
        </div>}
        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white">Done</button>
        </div>
      </section> : stage === 'compose' ? <>
        <section>
          <h3 className="mb-3 text-xs font-extrabold uppercase tracking-wide text-brand">Authorized recipient</h3>
          {loadingUsers ? <div className="flex items-center gap-2 py-6 text-xs text-muted"><Loader2 size={14} className="animate-spin" />Loading registered reviewers…</div> : <>
            <label className="block text-xs font-bold">Select a registered user
              <select value={recipientId} onChange={(event) => { setRecipientId(event.target.value); setError(''); }} className="field mt-1">
                <option value="">Choose an authorized reviewer…</option>
                {users.map((user) => <option key={user.id} value={user.id}>
                  {user.name} · {user.roleLabel || roleLabel(user.role)}
                </option>)}
              </select>
            </label>
            {recipient && <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 text-xs">
              <div className="flex items-center gap-2 font-bold text-emerald-800"><ShieldCheck size={14} />Authorized Purchase Order reviewer</div>
              <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                <div><dt className="text-[10px] text-muted">Full name</dt><dd className="font-bold">{recipient.name}</dd></div>
                <div><dt className="text-[10px] text-muted">Role</dt><dd className="font-bold">{recipient.roleLabel || roleLabel(recipient.role)}</dd></div>
                <div><dt className="text-[10px] text-muted">Registered email</dt><dd className="font-bold break-all">{recipient.email}</dd></div>
              </dl>
            </div>}
          </>}
        </section>

        <section>
          <label className="block text-xs font-bold">Optional message
            <textarea rows="3" value={message} onChange={(event) => setMessage(event.target.value)}
              placeholder="Add a short note for the reviewer…" className="field mt-1 h-auto py-2" />
          </label>
        </section>

        <ErrorMessage>{error}</ErrorMessage>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => { if (!recipient) { setError('Choose an authorized recipient.'); return; } setStage('confirm'); setError(''); }}
            className="inline-flex items-center gap-2 rounded-lg border border-brand bg-brand/5 px-4 py-2 text-xs font-bold text-brand">
            Review request <ArrowRight size={14} />
          </button>
        </div>
      </> : <>
        <section className="rounded-lg border border-brand/20 bg-brand/5 p-4 text-xs">
          <h3 className="flex items-center gap-2 text-sm font-extrabold text-brand"><CheckCircle2 size={16} />Confirm before sending</h3>
          <p className="mt-2 leading-5 text-slate-700">A secure, single-purpose approval link will be sent to the registered email address below. Sending does not approve the purchase order.</p>
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            <div><dt className="text-[10px] text-muted">Recipient</dt><dd className="font-bold">{recipient?.name}</dd></div>
            <div><dt className="text-[10px] text-muted">Role</dt><dd className="font-bold">{recipient?.roleLabel || roleLabel(recipient?.role)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-[10px] text-muted">Registered email</dt><dd className="font-bold break-all">{recipient?.email}</dd></div>
            <div><dt className="text-[10px] text-muted">Purchase order</dt><dd className="font-bold">{order.reference || 'Assigned when saved'}</dd></div>
            <div><dt className="text-[10px] text-muted">Total amount</dt><dd className="font-bold">{formatRwf(order.total)}</dd></div>
            {message.trim() && <div className="sm:col-span-2"><dt className="text-[10px] text-muted">Message</dt><dd className="mt-1 italic">“{message.trim()}”</dd></div>}
          </dl>
        </section>

        <ErrorMessage>{error}</ErrorMessage>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={() => setStage('compose')} disabled={busy} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-50">Back</button>
          <button type="button" onClick={confirmSend} disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {busy ? 'Saving and sending…' : 'Confirm and send'}
          </button>
        </div>
      </>}

      <p className="flex items-center gap-2 text-[10px] text-muted"><Mail size={12} />Only active Administrators and Approvers registered in the system can receive this request.</p>
    </div>
  </Modal>;
}
