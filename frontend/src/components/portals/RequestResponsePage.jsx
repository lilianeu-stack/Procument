import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, MessageSquare, RefreshCw, Send } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import PublicPrintToolbar from '../ui/PublicPrintToolbar.jsx';
import { api } from '../../services/api.js';
import { currency, dateTimeLabel } from '../../utils/format.js';

export default function RequestResponsePage({ token }) {
  const [request, setRequest] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [responderName, setResponderName] = useState('');
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setError('This response link is missing its access token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await api(`/request-response/${encodeURIComponent(token)}`);
      setRequest(response.request);
      setComments(response.comments || []);
    } catch (exception) {
      setError(exception.message || 'This response link could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api(`/request-response/${encodeURIComponent(token)}/comment`, {
        method: 'POST',
        body: JSON.stringify({ responderName: responderName.trim(), comment: comment.trim() })
      });
      setNotice(result.message || 'Your comment was sent directly to Procurement.');
      setComment('');
      await load();
    } catch (exception) {
      setError(exception.message || 'Your comment could not be submitted.');
    } finally {
      setBusy(false);
    }
  }

  const items = request?.items || [];
  const total = items.reduce(
    (sum, item) => sum + Number(item.lineTotal ?? Number(item.quantity) * Number(item.estimatedUnitCost)),
    0
  );
  const responded = Boolean(request?.responded);

  return <div className="min-h-screen bg-canvas">
    <header className="border-b bg-white">
      <div className="flex w-full max-w-none flex-wrap items-center justify-between gap-3 px-4 py-4">
        <BrandLogo />
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-black">
          Request response
        </span>
      </div>
    </header>

    <main className="w-full max-w-none space-y-5 px-4 py-8">
      {loading && <div className="rounded-xl border bg-white p-8 text-center text-sm text-black">Opening your request…</div>}
      {!loading && error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-black">{error}</div>}
      {!loading && notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-black">
        <CheckCircle2 size={16} />{notice}
      </div>}

      {!loading && request && <>
        <PublicPrintToolbar
          title="Requested items form"
          reference={request.reference}
          label="Print request form"
          note="Print this signed-link request and your response for your records."
        />
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-black">Requested items form</p>
          <h1 className="display-font mt-1 text-2xl font-extrabold text-black">{request.reference}</h1>
          <p className="mt-1 text-sm text-black">{request.title || 'Procurement request'}</p>
          <div className="mt-5 grid gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-lg border p-3"><span className="block text-black">Department</span><strong className="mt-1 block">{request.department || '—'}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-black">Requester</span><strong className="mt-1 block">{request.requester || '—'}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-black">Grand total</span><strong className="mt-1 block text-black">{currency(total)}</strong></div>
          </div>
        </section>

        {request.message && <section className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-6 shadow-sm">
          <strong className="block text-sm font-extrabold uppercase tracking-wide text-black">Message from Procurement</strong>
          <p className="mt-2 whitespace-pre-wrap text-base font-bold leading-relaxed text-black">{request.message}</p>
        </section>}

        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b px-6 py-4">
            <FileText size={16} className="text-black" />
            <h2 className="text-sm font-extrabold">Requested items</h2>
          </div>
          {items.length ? <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-black">
                <tr>
                  {['Item', 'Description', 'Quantity', 'Unit price', 'Total'].map((heading) =>
                    <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => <tr key={item.id || item.itemName}>
                  <td className="px-4 py-3 font-bold">{item.itemName}</td>
                  <td className="max-w-[260px] px-4 py-3 text-black">{item.description || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-bold">{item.quantity} {item.unit || 'unit'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{currency(item.estimatedUnitCost)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-bold">{currency(item.lineTotal)}</td>
                </tr>)}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="4" className="px-4 py-3 text-right text-xs font-bold">Grand total</td>
                  <td className="px-4 py-3 text-right text-xs font-extrabold text-black">{currency(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div> : <p className="p-6 text-sm text-black">No item lines were supplied with this request.</p>}
        </section>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-black" />
            <h2 className="text-sm font-extrabold">{responded ? 'Your response' : 'Add your comment'}</h2>
          </div>
          {responded ? <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-bold text-black">
                <CheckCircle2 size={17} />Response submitted
              </span>
              <span className="text-xs font-bold text-black">Only one response is accepted for each form.</span>
            </div>
            {request.response && <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold">{request.response.sender || 'Recipient'}</span>
                <span className="text-[10px] text-black">{dateTimeLabel(request.response.receivedAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-black">{request.response.comment}</p>
            </div>}
            {!request.response && request.recipientEmail && <p className="text-xs text-black">Submitted from {request.recipientEmail}.</p>}
          </div> : <>
            <p className="mt-1 text-xs text-black">
              Your comment is sent directly to Procurement and added to this request. No login is needed.
            </p>
            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block text-xs font-bold">
                Your name (optional)
                <input
                  type="text"
                  maxLength={150}
                  value={responderName}
                  onChange={(event) => setResponderName(event.target.value)}
                  placeholder="Your name"
                  className="field mt-1"
                />
              </label>
              <label className="block text-xs font-bold">
                Comment *
                <textarea
                  required
                  maxLength={5000}
                  rows={5}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Type your comment about the requested items, quantities, prices or delivery."
                  className="field mt-1 h-auto py-2"
                />
              </label>
              {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-black">{error}</div>}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[10px] text-black">{comment.length}/5000 characters</span>
                <button type="submit" disabled={busy || !comment.trim()} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-xs font-bold text-black hover:bg-brand/90 disabled:opacity-50">
                  {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  {busy ? 'Submitting…' : 'Submit comment'}
                </button>
              </div>
            </form>
          </>}
        </section>

        {!responded && comments.length > 0 && <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-sm font-extrabold">Comments already on this request</h2>
          <ul className="mt-4 space-y-3">
            {comments.map((entry) => <li key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold">{entry.sender || 'Recipient'}</span>
                <span className="text-[10px] text-black">{dateTimeLabel(entry.receivedAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-black">{entry.comment}</p>
            </li>)}
          </ul>
        </section>}
      </>}
    </main>
  </div>;
}
