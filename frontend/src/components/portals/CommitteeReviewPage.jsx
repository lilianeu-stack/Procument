import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileCheck2, RefreshCw, Send } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
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
  const [choices, setChoices] = useState({});
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
      setResponderName(result.review.recipientName || '');
      const initial = {};
      for (const response of result.review.responses || []) {
        initial[response.supplierId] = {
          decision: response.decision?.decision || '',
          reason: response.decision?.reason || ''
        };
      }
      setChoices(initial);
    } catch (exception) {
      setError(exception.message || 'This committee decision link could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function setChoice(supplierId, patch) {
    setChoices((current) => ({
      ...current,
      [supplierId]: { decision: '', reason: '', ...current[supplierId], ...patch }
    }));
  }

  async function submit(event) {
    event.preventDefault();
    const responses = review?.responses || [];
    if (!responses.length) return;
    const missing = responses.filter((response) => !choices[response.supplierId]?.decision);
    if (missing.length) {
      setError(`Choose Accept or Deny for ${missing.map((item) => item.supplier).join(', ')}.`);
      return;
    }
    const noReason = responses.filter((response) =>
      choices[response.supplierId]?.decision === 'Rejected' && !String(choices[response.supplierId]?.reason || '').trim());
    if (noReason.length) {
      setError(`Give a reason for denying ${noReason.map((item) => item.supplier).join(', ')}.`);
      return;
    }

    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/committee-review/${encodeURIComponent(token)}/decisions`, {
        method: 'POST',
        body: JSON.stringify({
          responderName: responderName.trim(),
          decisions: responses.map((response) => ({
            supplierId: response.supplierId,
            decision: choices[response.supplierId].decision,
            reason: choices[response.supplierId].reason.trim()
          }))
        })
      });
      setNotice(result.message || 'Your decisions were submitted to Procurement.');
      await load();
    } catch (exception) {
      setError(exception.message || 'Your decisions could not be submitted.');
    } finally {
      setBusy(false);
    }
  }

  const responded = Boolean(review?.responded);

  return <div className="min-h-screen bg-canvas">
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <BrandLogo />
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
          Committee decision form
        </span>
      </div>
    </header>

    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      {loading && <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted">Opening your decision form…</div>}
      {!loading && error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>}
      {!loading && notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
        <CheckCircle2 size={16} />{notice}
      </div>}

      {!loading && review && <>
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand">Procurement Committee review</p>
          <h1 className="display-font mt-1 text-2xl font-extrabold text-slate-900">{review.reference}</h1>
          <p className="mt-1 text-sm text-muted">{review.title || 'Supplier response review'}</p>
          <div className="mt-5 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border p-3"><span className="block text-muted">Requisition</span><strong className="mt-1 block">{review.requisitionReference || '—'}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-muted">Department</span><strong className="mt-1 block">{review.department || '—'}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-muted">Form sent</span><strong className="mt-1 block">{dateTimeLabel(review.sentAt)}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-muted">Response deadline</span><strong className="mt-1 block">{dateTimeLabel(review.dueDate)}</strong></div>
          </div>
          {review.message && <div className="mt-5 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5">
            <strong className="block text-sm font-extrabold uppercase tracking-wide text-emerald-800">Message from Procurement</strong>
            <p className="mt-2 whitespace-pre-wrap text-base font-bold leading-relaxed text-slate-900">{review.message}</p>
          </div>}
          {review.recommendation && <div className="mt-5 rounded-xl border-2 border-brand/30 bg-brand-light/40 p-5">
            <strong className="block text-sm font-extrabold uppercase tracking-wide text-brand">Procurement recommendation</strong>
            <p className="mt-2 text-base font-extrabold text-slate-900">{review.recommendation.supplierName}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">{review.recommendation.reason}</p>
          </div>}
        </section>

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b px-6 py-4">
            <FileCheck2 size={16} className="text-brand" />
            <h2 className="text-sm font-extrabold">Requested items</h2>
          </div>
          {(review.requestedItems || []).length ? <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                <tr>{['Item', 'Description', 'Quantity', 'Estimated unit price', 'Total'].map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3">{heading}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {review.requestedItems.map((item, index) => <tr key={`${item.itemName}-${index}`}>
                  <td className="px-4 py-3 font-bold">{item.itemName}</td>
                  <td className="max-w-[280px] px-4 py-3 text-muted">{item.description || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{item.quantity} {item.unit || 'unit'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{currency(item.estimatedUnitCost)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold">{currency(Number(item.quantity) * Number(item.estimatedUnitCost || 0))}</td>
                </tr>)}
              </tbody>
            </table>
          </div> : <p className="p-6 text-sm text-muted">No item lines were supplied with this RFQ.</p>}
        </section>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Send size={16} className="text-brand" />
              <h2 className="text-sm font-extrabold">{responded ? 'Your submitted decisions' : 'Your decisions'}</h2>
            </div>
            {responded && <span className="flex items-center gap-2 text-xs font-bold text-emerald-700">
              <CheckCircle2 size={16} />Submitted {dateTimeLabel(review.submittedAt)} · one response per link
            </span>}
          </div>
          {!responded && <p className="mt-2 text-xs text-muted">
            Choose <strong>Accept</strong> or <strong>Deny</strong> for every supplier response. A reason is required for each Deny. No staff login is needed.
          </p>}

          <form onSubmit={submit} className="mt-5 space-y-5">
            <label className="block text-xs font-bold">
              Your name (optional)
              <input type="text" maxLength={150} disabled={responded || busy} value={responderName}
                onChange={(event) => setResponderName(event.target.value)} placeholder="Your name"
                className="field mt-1" />
            </label>

            {(review.responses || []).map((response) => {
              const choice = choices[response.supplierId] || {};
              const denied = choice.decision === 'Rejected';
              const submittedDecision = response.decision;
              return <article key={response.supplierId} className="rounded-xl border border-slate-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-extrabold">{response.supplier}</h3>
                    <p className="mt-1 text-[11px] text-muted">
                      Response received {dateTimeLabel(response.submittedAt)} · Delivery {response.deliveryDays ?? 'Not specified'} days
                    </p>
                  </div>
                  <div className="rounded-lg bg-brand-light px-3 py-2 text-right">
                    <span className="block text-[10px] font-bold uppercase text-muted">Supplier response total</span>
                    <strong className="text-sm text-brand">{currency(responseTotal(response))}</strong>
                  </div>
                </div>

                {(response.items || []).length > 0 && <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                      <tr>{['Item', 'Quantity', 'Unit price', 'Total'].map((heading) => <th key={heading} className="px-3 py-2">{heading}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y">
                      {response.items.map((item, index) => <tr key={`${item.itemName}-${index}`}>
                        <td className="px-3 py-2 font-bold">{item.itemName}{item.comment && <div className="text-[10px] font-normal text-muted">Comment: {item.comment}</div>}</td>
                        <td className="px-3 py-2">{item.quantity} {item.unit || 'unit'}</td>
                        <td className="px-3 py-2">{currency(item.unitPrice)}</td>
                        <td className="px-3 py-2 text-right font-bold">{currency(item.lineTotal)}</td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>}
                {response.notes && <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                  <strong className="block">Overall supplier comment</strong>
                  <p className="mt-1 whitespace-pre-wrap text-muted">{response.notes}</p>
                </div>}

                {responded ? <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <span className="font-bold">Your decision: </span>
                  <span className={submittedDecision?.decision === 'Rejected' ? 'font-bold text-red-700' : 'font-bold text-emerald-700'}>
                    {submittedDecision?.decision === 'Rejected' ? 'Deny' : submittedDecision?.decision || '—'}
                  </span>
                  {submittedDecision?.reason && <p className="mt-1 whitespace-pre-wrap text-muted">Reason: {submittedDecision.reason}</p>}
                </div> : <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap gap-4">
                    {[['Accepted', 'Accept'], ['Rejected', 'Deny']].map(([value, label]) => <label key={value} className="flex cursor-pointer items-center gap-2 text-xs font-bold">
                      <input type="radio" name={`decision-${response.supplierId}`} checked={choice.decision === value}
                        onChange={() => setChoice(response.supplierId, { decision: value })} />
                      {label}
                    </label>)}
                  </div>
                  {denied && <label className="block text-xs font-bold">
                    Reason for denying this response *
                    <textarea rows={3} maxLength={5000} required value={choice.reason || ''}
                      onChange={(event) => setChoice(response.supplierId, { reason: event.target.value })}
                      placeholder="Explain why this supplier response is not accepted."
                      className="field mt-1 h-auto py-2" />
                  </label>}
                </div>}
              </article>;
            })}

            {!responded && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <span className="text-[11px] text-muted">Once submitted, this link cannot be used to change your decisions.</span>
              <button type="submit" disabled={busy || !(review.responses || []).length}
                className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand/90 disabled:opacity-50">
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                {busy ? 'Submitting…' : 'Submit decisions'}
              </button>
            </div>}
            {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</div>}
          </form>
        </section>
      </>}
    </main>
  </div>;
}
