import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import Modal from '../components/ui/Modal.jsx';
import { EmptyState, ErrorMessage } from '../components/ui/PageCard.jsx';
import { currency, dateTimeLabel } from '../utils/format.js';

export default function CommitteeReviewModal({ rfqIds = [], onClose, onPreview, onSend }) {
  const [report, setReport] = useState(null);
  const [members, setMembers] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [recommendations, setRecommendations] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sending = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    onPreview(rfqIds)
      .then((result) => {
        if (!active) return;
        setReport(result.report || []);
        setMembers(result.members || []);
      })
      .catch((exception) => { if (active) setError(exception.message || 'The review could not be prepared.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onPreview, rfqIds]);

  function toggleMember(id) {
    setSelectedMembers((current) => current.includes(id)
      ? current.filter((entry) => entry !== id) : [...current, id]);
  }

  function setRecommendation(rfqId, patch) {
    setRecommendations((current) => ({
      ...current,
      [rfqId]: { supplierId: '', reason: '', ...current[rfqId], ...patch }
    }));
  }

  async function send(event) {
    event.preventDefault();
    if (sending.current) return;
    if (!selectedMembers.length) {
      setError('Select at least one committee member to receive this form.');
      return;
    }
    for (const section of report || []) {
      const entry = recommendations[section.id] || {};
      if (!entry.supplierId) {
        setError(`Choose the supplier you recommend for ${section.reference}.`);
        return;
      }
      if (!String(entry.reason || '').trim()) {
        setError(`Give a reason for your recommendation on ${section.reference}.`);
        return;
      }
    }
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      await onSend({
        rfqIds: (report || []).map((section) => section.id),
        memberIds: selectedMembers,
        recommendations
      });
      onClose();
    } catch (exception) {
      setError(exception.message || 'The committee form could not be sent.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return <Modal
    title="Review before sending to Procurement Committee"
    size="xl"
    dismissible={!busy}
    onClose={() => !busy && onClose()}
  >
    <form onSubmit={send} className="space-y-5">
      <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800">
        Check exactly what each selected committee member will receive: your recommendation, the requested
        items, when each RFQ was sent and is due, and every supplier response with each item’s price and
        comment. Each recipient gets one Accept/Deny choice with a required reason. Nothing is sent until
        you click “Send to Committee”.
      </p>
      {loading && <div role="status" className="p-5 text-center text-sm text-muted">Preparing the review form…</div>}
      {!loading && error && <ErrorMessage>{error}</ErrorMessage>}

      {!loading && report && <>
        <section className="rounded-xl border border-slate-200 p-4">
          <h3 className="text-xs font-extrabold uppercase tracking-wide">1. Select the people who will receive this form</h3>
          <p className="mt-1 text-[11px] text-muted">Committee members from the Procurement Committee directory.</p>
          {members.length ? <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {members.map((member) => {
              const checked = selectedMembers.includes(member.id);
              return <label key={member.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${checked ? 'border-brand bg-brand-light' : 'border-slate-200'}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleMember(member.id)} className="mt-0.5" />
                <span>
                  <span className="block font-bold">{member.firstName} {member.lastName}</span>
                  <span className="block text-[11px] text-muted">{member.email}</span>
                </span>
              </label>;
            })}
          </div> : <div className="mt-3"><EmptyState>No committee members have been added yet.</EmptyState></div>}
        </section>

        {(report || []).map((section, index) => {
          const responding = (section.suppliers || []).filter((supplier) => supplier.responseAt || supplier.amount !== null);
          const recommendation = recommendations[section.id] || {};
          return <section key={section.id} className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wide">
              {index + 2}. Content for {section.reference}
            </h3>
            <div className="mt-2 grid gap-3 text-xs sm:grid-cols-3">
              <div><span className="text-muted">Requisition</span><strong className="mt-1 block">{section.requisitionReference}</strong></div>
              <div><span className="text-muted">Request</span><strong className="mt-1 block">{section.title}</strong></div>
              <div><span className="text-muted">Sent / deadline</span><strong className="mt-1 block">{dateTimeLabel(section.issuedAt)} · {dateTimeLabel(section.dueDate)}</strong></div>
            </div>
            {section.message && <div className="mt-3 rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3 text-xs">
              <strong className="font-extrabold uppercase tracking-wide text-emerald-800">Message from Procurement</strong>
              <p className="mt-1 whitespace-pre-wrap font-bold leading-relaxed">{section.message}</p>
            </div>}

            <h4 className="mt-4 text-[11px] font-bold uppercase text-muted">Emails sent to suppliers and their responses</h4>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                  <tr>{['Supplier', 'Email sent to', 'Quotation requested', 'Email sent', 'Response received', 'Quote', 'Items, prices and responses'].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {(section.suppliers || []).map((supplier) => <tr key={supplier.supplierId}>
                    <td className="px-3 py-2 font-bold">{supplier.name}<div className="text-[10px] font-normal text-muted">{supplier.emailStatus}</div></td>
                    <td className="px-3 py-2">{supplier.recipientEmail || 'No email on file'}</td>
                    <td className="px-3 py-2">{dateTimeLabel(supplier.quotationRequestedAt)}</td>
                    <td className="px-3 py-2">{dateTimeLabel(supplier.emailSentAt)}</td>
                    <td className="px-3 py-2 font-semibold text-emerald-700">{dateTimeLabel(supplier.responseAt)}</td>
                    <td className="px-3 py-2 font-bold">{supplier.responseAt ? currency(supplier.amount) : 'No response'}</td>
                    <td className="px-3 py-2 align-top">
                      {(supplier.items || []).length ? <ul className="space-y-2">
                        {(supplier.items || []).map((item, itemIndex) => <li key={`${item.itemName}-${itemIndex}`} className="rounded-md bg-slate-50 p-2">
                          <div className="font-bold">{item.itemName} · {item.quantity} {item.unit}</div>
                          <div className="text-[11px] text-muted">
                            Unit price {currency(item.unitPrice)} · Total {currency(item.lineTotal)}
                          </div>
                          <div className="mt-1 text-[11px] text-emerald-700">Response: {item.comment || 'No item comment'}</div>
                        </li>)}
                      </ul> : <span className="text-muted">No quoted items were supplied.</span>}
                      {supplier.notes && <p className="mt-2 whitespace-pre-wrap text-[11px] text-muted">Overall response: {supplier.notes}</p>}
                    </td>
                  </tr>)}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid gap-3 rounded-lg bg-brand-light/40 p-3 sm:grid-cols-2">
              <label className="block text-xs font-bold">
                Recommended supplier *
                <select required value={recommendation.supplierId || ''}
                  onChange={(event) => setRecommendation(section.id, { supplierId: event.target.value })}
                  className="field mt-1">
                  <option value="">Select a supplier…</option>
                  {responding.map((supplier) => <option key={supplier.supplierId} value={supplier.supplierId}>
                    {supplier.name} · {currency(supplier.amount)}
                  </option>)}
                </select>
              </label>
              <label className="block text-xs font-bold">
                Reason for recommendation *
                <textarea required rows={2} maxLength={5000} value={recommendation.reason || ''}
                  onChange={(event) => setRecommendation(section.id, { reason: event.target.value })}
                  placeholder="Why is this supplier recommended?"
                  className="field mt-1 h-auto py-2" />
              </label>
            </div>

            <div className="mt-4 rounded-lg bg-brand-light/40 p-3 text-[11px] text-muted">
              Each recipient receives this content and one <strong>Accept</strong> or <strong>Deny</strong> choice on your recommendation, with a required reason. Only one decision is accepted per link.
            </div>
          </section>;
        })}
      </>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className="text-[11px] text-muted">Each recipient gets their own private review link.</span>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={busy || loading || !report?.length} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-60">
            {busy ? 'Sending…' : <Check size={14} />}
            {busy ? 'Sending emails…' : `Send to Committee${selectedMembers.length ? ` (${selectedMembers.length})` : ''}`}
          </button>
        </div>
      </div>
    </form>
  </Modal>;
}
