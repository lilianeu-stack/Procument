import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, RefreshCw, Send } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import { currency, dateTimeLabel } from '../../utils/format.js';
import { api } from '../../services/api.js';

const blankForm = { notes: '', prices: {} };

export default function SupplierRfqPage({ token }) {
  const [rfq, setRfq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(blankForm);

  const load = useCallback(async () => {
    if (!token) { setError('This quotation link is missing its access token.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const response = await api(`/supplier/rfq/${encodeURIComponent(token)}`);
      setRfq(response.rfq);
      const quotation = response.rfq.quotation;
      const prices = {};
      for (const item of response.rfq.items || []) {
        const saved = (quotation?.items || []).find((entry) => entry.requisitionItemId === item.requisitionItemId);
        prices[item.requisitionItemId] = saved ? String(saved.unitPrice) : '';
      }
      setForm({ notes: quotation?.notes || '', prices });
    } catch (exception) {
      setError(exception.message || 'This response link could not be opened.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function setPrice(itemId, value) {
    setForm((current) => ({ ...current, prices: { ...current.prices, [itemId]: value } }));
  }

  async function submit(event) {
    event.preventDefault();
    if (!(rfq?.items || []).length) {
      setError('There are no requested items to price.');
      return;
    }
    const items = rfq.items.map((item) => ({
      requisitionItemId: item.requisitionItemId,
      unitPrice: Number(form.prices[item.requisitionItemId])
    }));
    if (items.some((item) => !Number.isFinite(item.unitPrice) || item.unitPrice <= 0)) {
      setError('Enter a unit price for every requested item.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/supplier/rfq/${encodeURIComponent(token)}/quotation`, {
        method: 'POST',
        body: JSON.stringify({ notes: form.notes.trim(), items })
      });
      setNotice(result.message || 'Response submitted.');
      await load();
    } catch (exception) {
      setError(exception.message || 'The response could not be submitted.');
    } finally { setBusy(false); }
  }

  const responseTotal = (rfq?.items || []).reduce((sum, item) => {
    const price = Number(form.prices[item.requisitionItemId]) || 0;
    return sum + (Number(item.quantity) || 0) * price;
  }, 0);
  const responded = Boolean(rfq?.quotation);

  return <div className="min-h-screen bg-canvas">
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <BrandLogo />
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Requisition response portal</span>
      </div>
    </header>

    <main className="mx-auto max-w-6xl space-y-5 px-4 py-8">
      {loading && <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted">Opening your request form…</div>}
      {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>}
      {!loading && notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} />{notice}</div>}

      {!loading && rfq && <form onSubmit={submit} className="space-y-5">
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Requested items form</p>
              <h1 className="display-font mt-1 text-2xl font-extrabold text-slate-900">{rfq.requisitionReference}</h1>
              <p className="mt-1 text-sm text-muted">RFQ {rfq.reference} · {rfq.title || 'Procurement request'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-right text-xs">
              <div className="font-bold text-slate-700">Response deadline</div>
              <div className="mt-1 text-base font-extrabold text-brand">{dateTimeLabel(rfq.dueDate)}</div>
              <div className="mt-1 text-muted">Invited supplier: {rfq.supplier.name}</div>
            </div>
          </div>
          {rfq.message && <div className="mt-5 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5 shadow-sm">
            <strong className="block text-sm font-extrabold uppercase tracking-wide text-emerald-800">Message from Procurement</strong>
            <p className="mt-2 whitespace-pre-wrap text-base font-bold leading-relaxed text-slate-900">{rfq.message}</p>
          </div>}
        </section>

        <section className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b px-6 py-4">
            <FileText size={16} className="text-brand" />
            <h2 className="text-sm font-extrabold">Requested items · enter your prices</h2>
          </div>
          {rfq.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Item', 'Qty', 'Unit', 'Est. unit', 'Your unit price (RWF)', 'Your total'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead>
            <tbody className="divide-y">{rfq.items.map((item) => {
              const price = Number(form.prices[item.requisitionItemId]) || 0;
              return <tr key={item.requisitionItemId}>
                <td className="px-4 py-3 font-bold">{item.itemName}</td>
                <td className="px-4 py-3">{item.quantity}</td>
                <td className="px-4 py-3">{item.unit}</td>
                <td className="px-4 py-3">{currency(item.estimatedUnitCost)}</td>
                <td className="px-4 py-3">{responded ? <strong>{currency(price)}</strong> : <input required type="number" min="0.01" step="0.01" value={form.prices[item.requisitionItemId] || ''} onChange={(event) => setPrice(item.requisitionItemId, event.target.value)} className="field w-32" placeholder="0.00" />}</td>
                <td className="px-4 py-3 font-bold">{currency((Number(item.quantity) || 0) * price)}</td>
              </tr>;
            })}</tbody>
          </table></div> : <p className="p-6 text-sm text-muted">No item lines were supplied with this form.</p>}
          {rfq.items.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-emerald-200 bg-emerald-50 px-6 py-4">
            <span className="text-xs font-extrabold uppercase tracking-wide text-emerald-800">Your response total</span>
            <strong className="text-base font-bold text-brand">{currency(responseTotal)}</strong>
          </div>}
        </section>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          {responded ? <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-bold text-emerald-800"><CheckCircle2 size={17} />Response submitted{rfq.quotation.submittedAt ? ` ${dateTimeLabel(rfq.quotation.submittedAt)}` : ''}</span>
              <span className="text-xs font-bold text-muted">Only one response is accepted for each form.</span>
            </div>
            {rfq.quotation.notes && <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
              <strong className="text-xs font-extrabold uppercase tracking-wide text-muted">Overall comment</strong>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-ink">{rfq.quotation.notes}</p>
            </div>}
          </> : <>
            <label className="block text-xs font-bold">Overall comment<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="field mt-1 h-auto py-2" placeholder="Add any comment that should reach Procurement…" /></label>
            <p className="mt-3 text-xs text-muted">Your response, item prices, and comments are visible to Procurement only. Other invited suppliers cannot see them.</p>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
              <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-xs font-bold text-black hover:bg-brand/90 disabled:opacity-50">
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                {busy ? 'Submitting…' : 'Submit response'}
              </button>
            </div>
          </>}
        </section>
      </form>}
    </main>
  </div>;
}
