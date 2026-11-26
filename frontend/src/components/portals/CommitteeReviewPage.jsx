import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileCheck2, RefreshCw, Send } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import PublicPrintToolbar from '../ui/PublicPrintToolbar.jsx';
import { api } from '../../services/api.js';
import { currency, dateTimeLabel } from '../../utils/format.js';

const responseTotal = (response) => {
  if (response.amount !== null && response.amount !== undefined) return Number(response.amount);
  return (response.items || []).reduce(
    (total, item) => total + Number(item.lineTotal ?? Number(item.quantity) * Number(item.unitPrice)),
    0
  );
};

export default function CommitteeReviewPage({ token }) {
  const [review, setReview] = useState(null);
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  const [responderName, setResponderName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setError('This committee decision link is missing its access token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api(`/committee-review/${encodeURIComponent(token)}`);
      setReview(result.review);
      const submitted = result.review.overallDecision || result.review.decisions?.[0] || null;
      setResponderName(submitted?.responderName || result.review.recipientName || '');
      setDecision(submitted?.decision || '');
      setReason(submitted?.reason || '');
    } catch (exception) {
      setError(exception.message || 'This committee decision link could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    if (!decision) {
      setError('Choose Accept or Deny for Procurement’s recommendation.');
      return;
    }
    if (!reason.trim()) {
      setError(decision === 'Rejected'
        ? 'Give a reason for denying this recommendation.'
        : 'Give a reason for accepting this recommendation.');
      return;
    }

    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/committee-review/${encodeURIComponent(token)}/decisions`, {
        method: 'POST',
        body: JSON.stringify({
          responderName: responderName.trim(),
          decision,
          reason: reason.trim()
        })
      });
      setNotice(result.message || 'Your decision was submitted to Procurement.');
      await load();
    } catch (exception) {
      setError(exception.message || 'Your decision could not be submitted.');
      // A duplicate submission (409) means a decision is already stored, so
      // refresh to show the submitted state instead of leaving an editable form.
      await load();
    } finally {
      setBusy(false);
    }
  }

  const responded = Boolean(review?.responded);
  const submittedDecision = review?.overallDecision || review?.decisions?.[0] || null;

  return <div className="min-h-screen bg-canvas">
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <BrandLogo />
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black">
          Committee decision form
        </span>
      </div>
    </header>

    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      {loading && <div className="rounded-xl border bg-white p-8 text-center text-sm text-black">Opening your decision form…</div>}
      {!loading && error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-black">{error}</div>}
      {!loading && notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-black">
        <CheckCircle2 size={16} />{notice}
      </div>}

      {!loading && review && <>
        <PublicPrintToolbar
          title="Procurement committee review"
          reference={review.reference}
          label="Print review"
          note="Print the signed-link review and supplier responses for your records."
        />
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-black">Procurement Committee review</p>
          <h1 className="display-font mt-1 text-2xl font-extrabold text-black">{review.reference}</h1>
          <p className="mt-1 text-sm text-black">{review.title || 'Supplier response review'}</p>
          <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border p-3"><span className="block text-black">Requisition</span><strong className="mt-1 block">{review.requisitionReference || '—'}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-black">Department</span><strong className="mt-1 block">{review.department || '—'}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-black">Form sent</span><strong className="mt-1 block">{dateTimeLabel(review.sentAt)}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-black">Response deadline</span><strong className="mt-1 block">{dateTimeLabel(review.dueDate)}</strong></div>
          </div>
          {review.message && <div className="mt-5 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5">
            <strong className="block text-sm font-extrabold uppercase tracking-wide text-black">Message from Procurement</strong>
            <p className="mt-2 whitespace-pre-wrap text-base font-bold leading-relaxed text-black">{review.message}</p>
          </div>}
          {review.recommendation && <div className="mt-5 rounded-xl border-2 border-brand bg-brand-light/60 p-6 shadow-sm">
            <span className="inline-flex rounded-full bg-brand px-3 py-1 text-[10px] font-extrabold uppercase tracking-widest text-black">
              Procurement recommendation
            </span>
            <p className="mt-3 text-xl font-extrabold leading-snug text-black sm:text-2xl">
              Recommended supplier: {review.recommendation.supplierName}
            </p>
            <div className="mt-3 rounded-lg border border-brand/20 bg-white/80 p-4">
              <strong className="block text-xs font-extrabold uppercase tracking-wide text-black">Reason for recommendation</strong>
              <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-black">
                {review.recommendation.reason || 'No reason was provided by Procurement.'}
              </p>
            </div>
          </div>}
        </section>

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b px-6 py-4">
            <FileCheck2 size={16} className="text-black" />
            <h2 className="text-sm font-extrabold">Requested items</h2>
          </div>
          {(review.requestedItems || []).length ? <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-black">
                <tr>{['Item', 'Description', 'Quantity', 'Estimated unit price', 'Total'].map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {review.requestedItems.map((item, index) => <tr key={`${item.itemName}-${index}`}>
                  <td className="px-4 py-3 font-bold">{item.itemName}</td>
                  <td className="max-w-[280px] px-4 py-3 text-black">{item.description || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{item.quantity} {item.unit || 'unit'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{currency(item.estimatedUnitCost)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold">{currency(Number(item.quantity) * Number(item.estimatedUnitCost || 0))}</td>
                </tr>)}
              </tbody>
            </table>
          </div> : <p className="p-6 text-sm text-black">No item lines were supplied with this RFQ.</p>}
        </section>

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b px-6 py-4">
            <FileCheck2 size={16} className="text-black" />
            <h2 className="text-sm font-extrabold">Supplier responses</h2>
          </div>
          {(review.responses || []).length ? <div className="divide-y">
            {(review.responses || []).map((response) => <article key={response.supplierId} className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-extrabold">{response.supplier}</h3>
                  <p className="mt-1 text-[11px] text-black">
                    Response received {dateTimeLabel(response.submittedAt)} · Delivery {response.deliveryDays ?? 'Not specified'} days
                  </p>
                </div>
                <div className="rounded-lg bg-brand-light px-3 py-2 text-right">
                  <span className="block text-[10px] font-bold uppercase text-black">Supplier response total</span>
                  <strong className="text-sm text-black">{currency(responseTotal(response))}</strong>
                </div>
              </div>

              {(response.items || []).length > 0 && <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[600px] text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] uppercase text-black">
                    <tr>{['Item', 'Quantity', 'Unit price', 'Total'].map((heading) => <th key={heading} className="px-3 py-2">{heading}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {response.items.map((item, index) => <tr key={`${item.itemName}-${index}`}>
                      <td className="px-3 py-2 font-bold">{item.itemName}{item.comment && <div className="text-[10px] font-normal text-black">Comment: {item.comment}</div>}</td>
                      <td className="px-3 py-2">{item.quantity} {item.unit || 'unit'}</td>
                      <td className="px-3 py-2">{currency(item.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-bold">{currency(item.lineTotal)}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>}
              {response.notes && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                <strong className="block">Overall supplier comment</strong>
                <p className="mt-1 whitespace-pre-wrap text-black">{response.notes}</p>
              </div>}
            </article>)}
          </div> : <p className="p-6 text-sm text-black">No supplier responses were included in this review.</p>}
        </section>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Send size={16} className="text-black" />
              <h2 className="text-sm font-extrabold">{responded ? 'Your submitted decision' : 'Your decision'}</h2>
            </div>
            {responded && <span className="flex items-center gap-2 text-xs font-bold text-black">
              <CheckCircle2 size={16} />Submitted {dateTimeLabel(review.submittedAt)} · one decision per link
            </span>}
          </div>
          {!responded && <p className="mt-2 text-xs text-black">
            Choose one <strong>Accept</strong> or <strong>Deny</strong> decision for Procurement’s recommendation and give a reason. No staff login is needed.
          </p>}

          <form onSubmit={submit} className="mt-5 space-y-5">
            <label className="block text-xs font-bold">
              Your name (optional)
              <input type="text" maxLength={150} disabled={responded || busy} value={responderName}
                onChange={(event) => setResponderName(event.target.value)} placeholder="Your name"
                className="field mt-1" />
            </label>

            {responded ? <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
              <p className="mb-2 text-black">Submitted by <strong className="text-black">{submittedDecision?.responderName || review.recipientName}</strong>{submittedDecision?.decidedAt ? ` · ${dateTimeLabel(submittedDecision.decidedAt)}` : ''}</p>
              <span className="font-bold">Your decision: </span>
              <span className={submittedDecision?.decision === 'Rejected' ? 'font-bold text-black' : 'font-bold text-black'}>
                {submittedDecision?.decision === 'Rejected' ? 'Deny' : submittedDecision?.decision === 'Accepted' ? 'Accept' : '—'}
              </span>
              {submittedDecision?.reason && <p className="mt-2 whitespace-pre-wrap text-black">Reason: {submittedDecision.reason}</p>}
            </div> : <>
              <div className="flex flex-wrap gap-4">
                {[['Accepted', 'Accept'], ['Rejected', 'Deny']].map(([value, label]) => <label key={value} className="flex cursor-pointer items-center gap-2 text-xs font-bold">
                  <input type="radio" name="committee-decision" checked={decision === value}
                    onChange={() => setDecision(value)} />
                  {label}
                </label>)}
              </div>
              <label className="block text-xs font-bold">
                Reason for this decision *
                <textarea rows={4} maxLength={5000} required value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={decision === 'Rejected'
                    ? 'Explain why you deny Procurement’s recommendation.'
                    : 'Explain why you accept Procurement’s recommendation.'}
                  className="field mt-1 h-auto py-2" />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <span className="text-[11px] text-black">Once submitted, this link cannot be used to change your decision.</span>
                <button type="submit" disabled={busy || !(review.responses || []).length}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-xs font-bold text-black hover:bg-brand/90 disabled:opacity-50">
                  {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {busy ? 'Submitting…' : 'Submit decision'}
                </button>
              </div>
            </>}
            {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-black">{error}</div>}
          </form>
        </section>
      </>}
    </main>
  </div>;
}
