import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, RefreshCw, Send } from 'lucide-react';
import BrandLogo from '../ui/BrandLogo.jsx';
import { currency, dateLabel, dateTimeLabel } from '../../utils/format.js';
import { api } from '../../services/api.js';

export default function SupplierRfqPage({ token }) {
  const [rfq, setRfq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ amount: '', deliveryDays: '7', notes: '' });

  const load = useCallback(async () => {
    if (!token) { setError('This quotation link is missing its access token.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const response = await api(`/supplier/rfq/${encodeURIComponent(token)}`);
      setRfq(response.rfq);
      if (response.rfq.quotation) {
        setForm({
          amount: String(response.rfq.quotation.amount),
          deliveryDays: String(response.rfq.quotation.deliveryDays),
          notes: response.rfq.quotation.notes || ''
        });
      }
    } catch (exception) {
      setError(exception.message || 'This quotation link could not be opened.');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/supplier/rfq/${encodeURIComponent(token)}/quotation`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(form.amount),
          deliveryDays: Number(form.deliveryDays),
          notes: form.notes
        })
      });
      setNotice(result.message || 'Quotation submitted.');
      await load();
    } catch (exception) {
      setError(exception.message || 'The quotation could not be submitted.');
    } finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-canvas">
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <BrandLogo />
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">Supplier quotation portal</span>
      </div>
    </header>

    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      {loading && <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted">Opening your RFQ…</div>}
      {!loading && error && <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</div>}
      {!loading && notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700"><CheckCircle2 size={16} />{notice}</div>}

      {!loading && rfq && <>
        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">Request for quotation</p>
              <h1 className="display-font mt-1 text-2xl font-extrabold text-slate-900">{rfq.reference}</h1>
              <p className="mt-1 text-sm text-muted">Requisition {rfq.requisitionReference} · {rfq.title || 'Procurement request'}</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-right text-xs">
              <div className="font-bold text-slate-700">Quotation deadline</div>
              <div className="mt-1 text-base font-extrabold text-brand">{dateLabel(rfq.dueDate)}</div>
              <div className="mt-1 text-muted">Invited supplier: {rfq.supplier.name}</div>
            </div>
          </div>
          {rfq.justification && <p className="mt-5 rounded-lg bg-emerald-50/60 p-4 text-sm leading-relaxed text-slate-700">{rfq.justification}</p>}
          <div className="mt-5 grid gap-3 text-xs sm:grid-cols-3">
            <div className="rounded-lg border p-3"><span className="block text-muted">Priority</span><strong className="mt-1 block">{rfq.priority || 'Medium'}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-muted">Required by</span><strong className="mt-1 block">{dateLabel(rfq.requiredBy)}</strong></div>
            <div className="rounded-lg border p-3"><span className="block text-muted">Estimated total</span><strong className="mt-1 block">{currency(rfq.total)}</strong></div>
          </div>
        </section>

        <section className="rounded-xl border bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b px-6 py-4"><FileText size={16} className="text-brand" /><h2 className="text-sm font-extrabold">Requested items</h2></div>
          {rfq.items.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['Item', 'Description', 'Qty', 'Unit', 'Est. unit', 'Est. total'].map((cell) => <th key={cell} className="px-4 py-3">{cell}</th>)}</tr></thead>
            <tbody className="divide-y">{rfq.items.map((item, index) => <tr key={index}>
              <td className="px-4 py-3 font-bold">{item.itemName}</td>
              <td className="max-w-[260px] px-4 py-3 text-muted">{item.description || '—'}</td>
              <td className="px-4 py-3">{item.quantity}</td>
              <td className="px-4 py-3">{item.unit}</td>
              <td className="px-4 py-3">{currency(item.estimatedUnitCost)}</td>
              <td className="px-4 py-3 font-bold">{currency(item.lineTotal)}</td>
            </tr>)}</tbody>
          </table></div> : <p className="p-6 text-sm text-muted">No item lines were supplied with this RFQ.</p>}
        </section>

        <section className="rounded-xl border bg-white p-6 shadow-sm">
          <h2 className="text-sm font-extrabold">Submit your quotation</h2>
          <p className="mt-1 text-xs text-muted">Your response is visible to Procurement only. Other invited Suppliers cannot see it.</p>
          <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold">Quotation total (USD)<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="field mt-1" /></label>
            <label className="text-xs font-bold">Delivery days<input required type="number" min="1" step="1" value={form.deliveryDays} onChange={(event) => setForm({ ...form, deliveryDays: event.target.value })} className="field mt-1" /></label>
            <label className="text-xs font-bold sm:col-span-2">Notes<textarea rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="field mt-1 h-auto py-2" /></label>
            <div className="sm:col-span-2">
              <button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-xs font-bold text-white hover:bg-brand/90 disabled:opacity-50">
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                {busy ? 'Submitting…' : rfq.quotation ? 'Update quotation' : 'Submit quotation'}
              </button>
            </div>
          </form>
          {rfq.quotation?.submittedAt && <p className="mt-4 text-xs text-muted">Last submitted {dateTimeLabel(rfq.quotation.submittedAt)}.</p>}
        </section>
      </>}
    </main>
  </div>;
}
