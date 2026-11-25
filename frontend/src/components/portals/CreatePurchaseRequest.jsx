import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Info, Plus, Save, Send, Trash2
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import {
  ErrorState, KeyValue, PageHeader, TableScroll, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { currency } from '../../utils/format.js';

const MAX_ITEMS = 100;
const UNITS = ['unit', 'box', 'kg', 'litre', 'hour', 'day', 'set', 'piece'];

const emptyItem = () => ({
  itemName: '', description: '', quantity: '1', unit: 'unit', estimatedUnitCost: ''
});

function lineTotal(item) {
  return (Number(item.quantity) || 0) * (Number(item.estimatedUnitCost) || 0);
}

export default function CreatePurchaseRequest({ portalApi, navigate, query = {} }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    title: query.title || ''
  });
  const [items, setItems] = useState([emptyItem()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const total = useMemo(
    () => items.reduce((sum, item) => sum + lineTotal(item), 0),
    [items]
  );
  const needsAdministrator = /no active supervisor|contact an administrator/i.test(error);
  const hasUnsavedChanges = Boolean(
    form.title || items.some((item) =>
      item.itemName || item.description || item.estimatedUnitCost ||
      item.quantity !== '1' || item.unit !== 'unit')
  );

  function cancelRequest() {
    if (busy) return;
    if (hasUnsavedChanges && !window.confirm('Discard this unsaved request and return to My Procurement Requests?')) return;
    navigate('My Procurement Requests');
  }

  function updateItem(index, key, value) {
    setItems((current) => current.map((item, position) =>
      position === index ? { ...item, [key]: value } : item));
  }

  function validate(action = 'submit') {
    if (!form.title.trim()) return 'A request title is required.';
    if (!items.length) return 'Add at least one item.';
    for (const [index, item] of items.entries()) {
      const number = index + 1;
      if (!item.itemName.trim()) return `Item ${number} needs a title.`;
      if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) {
        return `Item ${number} needs a whole quantity of at least 1.`;
      }
      if (!UNITS.includes(item.unit)) return `Choose a unit of quantity measure for item ${number}.`;
      if (action === 'submit' && !item.description.trim()) {
        return `Item ${number} needs a description or purpose.`;
      }
      if (action === 'submit' && (item.estimatedUnitCost === '' ||
          !Number.isFinite(Number(item.estimatedUnitCost)) || Number(item.estimatedUnitCost) < 0)) {
        return `Item ${number} needs a valid unit cost.`;
      }
    }
    return '';
  }

  function goToReview() {
    const problem = validate('submit');
    if (problem) { setError(problem); return; }
    setError('');
    setStep(2);
  }

  async function save(action) {
    setError('');
    const problem = validate(action);
    if (problem) {
      setError(problem);
      setStep(1);
      return;
    }
    setBusy(action);
    try {
      const justification = items
        .map((item) => `${item.itemName.trim()}: ${item.description.trim()}`)
        .filter((description) => !description.endsWith(': '))
        .join('\n')
        .slice(0, 5000);
      const result = await portalApi.createRequesterRequest({
        title: form.title.trim(),
        justification,
        budgetCode: '',
        priority: 'Medium',
        items: items.map((item) => ({
          itemName: item.itemName.trim(),
          description: item.description.trim(),
          quantity: Number(item.quantity),
          unit: item.unit,
          estimatedUnitCost: Number(item.estimatedUnitCost || 0)
        })),
        action
      });
      navigate('My Procurement Requests', { request: result.id });
    } catch (exception) {
      setError(exception.message || 'The request could not be saved.');
    } finally {
      setBusy('');
    }
  }

  return <>
    <button type="button" onClick={cancelRequest} className="mb-4 inline-flex items-center gap-1.5 text-xs font-bold text-brand hover:underline">
      <ArrowLeft size={14} />Back to My Procurement Requests
    </button>

    <PageHeader
      eyebrow="Step 1 of 2 · Request builder"
      title="Create purchase request"
      description="Describe the request and add one or more items before reviewing it."
      actions={<div className="flex items-center gap-2">
        <span className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${step === 1 ? 'bg-brand text-white' : 'bg-slate-100 text-muted'}`}>1 · Details</span>
        <span className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${step === 2 ? 'bg-brand text-white' : 'bg-slate-100 text-muted'}`}>2 · Review</span>
      </div>}
    />

    {needsAdministrator && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
        <div>
          <p className="text-sm font-bold text-amber-900">Submission is blocked for your Department</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">{error}</p>
          <p className="mt-2 text-xs font-bold text-amber-900">Next step: contact an Administrator to assign an active Department Supervisor, then try again.</p>
          <button type="button" onClick={() => navigate('My Procurement Requests')} className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800">
            View my requests
          </button>
        </div>
      </div>
    </div>}
    {!needsAdministrator && <ErrorState message={error && step === 2 ? '' : error} />}

    {step === 1 ? <div className="space-y-5">
      <PageCard title="Request details" description="Enter an overall title for this request.">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="block text-xs font-bold sm:col-span-2">
            Title *
            <input required value={form.title} maxLength={180} onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="e.g. Office supplies for the department" className="field" />
          </label>
          <div className="rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-muted sm:col-span-2">
            <Info size={14} className="mb-1 text-brand" />
            Drafts stay with you until submitted. Once submitted, your Department Supervisor receives the request for approval.
          </div>
        </div>
      </PageCard>

      <PageCard
        title="Request items"
        description="Each item has its own quantity, unit of measure, cost, total, and purpose."
        action={<button type="button" disabled={Boolean(busy) || items.length >= MAX_ITEMS}
          onClick={() => setItems((current) => [...current, emptyItem()])}
          className={secondaryButtonClass()}>
          <Plus size={14} />Add item
        </button>}>
        <TableScroll minWidth={1050}>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-muted">
              <tr>
                {['Item title *', 'Quantity *', 'Unit of quantity measure *', 'Unit cost *', 'Total', 'Description / purpose *', ''].map((heading) =>
                  <th key={heading} className="whitespace-nowrap px-3 py-3 font-bold">{heading}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, index) => <tr key={index} className="align-top">
                <td className="px-3 py-3">
                  <input required aria-label={`Item ${index + 1} title`} maxLength={180}
                    value={item.itemName} onChange={(event) => updateItem(index, 'itemName', event.target.value)}
                    placeholder="Item or service" className="field mt-0 min-w-36" />
                </td>
                <td className="px-3 py-3">
                  <input required aria-label={`Item ${index + 1} quantity`} type="number" min="1" step="1"
                    value={item.quantity} onChange={(event) => updateItem(index, 'quantity', event.target.value)}
                    className="field mt-0 w-24" />
                </td>
                <td className="px-3 py-3">
                  <select required aria-label={`Item ${index + 1} unit of quantity measure`} value={item.unit}
                    onChange={(event) => updateItem(index, 'unit', event.target.value)} className="field mt-0 w-36">
                    {UNITS.map((unit) => <option key={unit}>{unit}</option>)}
                  </select>
                </td>
                <td className="px-3 py-3">
                  <input required aria-label={`Item ${index + 1} unit cost`} type="number" min="0" step="0.01"
                    value={item.estimatedUnitCost} onChange={(event) => updateItem(index, 'estimatedUnitCost', event.target.value)}
                    placeholder="0.00" className="field mt-0 w-28" />
                </td>
                <td className="whitespace-nowrap px-3 py-4 font-bold">{currency(lineTotal(item))}</td>
                <td className="px-3 py-3">
                  <textarea required aria-label={`Item ${index + 1} description or purpose`} rows="2" maxLength={1000}
                    value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)}
                    placeholder="Describe the item and its purpose" className="field mt-0 min-w-48 py-2" />
                </td>
                <td className="px-3 py-3">
                  <button type="button" disabled={items.length === 1 || Boolean(busy)}
                    onClick={() => setItems((current) => current.filter((_, position) => position !== index))}
                    aria-label={`Remove item ${index + 1}`}
                    className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>)}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50">
                <td colSpan="4" className="px-3 py-3 text-right text-xs font-bold">Request total</td>
                <td className="px-3 py-3 text-sm font-extrabold text-brand">{currency(total)}</td>
                <td colSpan="2" />
              </tr>
            </tfoot>
          </table>
        </TableScroll>
      </PageCard>

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={cancelRequest} disabled={Boolean(busy)} className={secondaryButtonClass()}>
          Cancel
        </button>
        <button type="button" onClick={() => save('draft')} disabled={Boolean(busy)} className={secondaryButtonClass()}>
          <Save size={14} />{busy === 'draft' ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" onClick={goToReview} className={primaryButtonClass()}>
          Review request <ArrowRight size={14} />
        </button>
      </div>
    </div> : <div className="space-y-5">
      <PageCard title="Review your request" description="Check the details below before saving or submitting.">
        <dl className="grid gap-5 p-5 sm:grid-cols-2">
          <KeyValue label="Title">{form.title}</KeyValue>
          <KeyValue label="Items">{items.length}</KeyValue>
        </dl>
        <TableScroll minWidth={700}>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-muted">
              <tr>{['Item title', 'Quantity', 'Unit of quantity measure', 'Unit cost', 'Total', 'Description / purpose'].map((heading) =>
                <th key={heading} className="px-3 py-3 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, index) => <tr key={index}>
                <td className="px-3 py-3 font-bold">{item.itemName}</td>
                <td className="px-3 py-3">{item.quantity}</td>
                <td className="px-3 py-3">{item.unit}</td>
                <td className="px-3 py-3">{currency(Number(item.estimatedUnitCost))}</td>
                <td className="px-3 py-3 font-bold">{currency(lineTotal(item))}</td>
                <td className="px-3 py-3 text-muted">{item.description || '—'}</td>
              </tr>)}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50">
                <td colSpan="4" className="px-3 py-3 text-right font-bold">Request total</td>
                <td className="px-3 py-3 font-extrabold text-brand">{currency(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </TableScroll>
      </PageCard>
      <ErrorState message={error} />
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" onClick={() => { setStep(1); setError(''); }} className={secondaryButtonClass()}>
          <ArrowLeft size={14} />Edit request
        </button>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={cancelRequest} disabled={Boolean(busy)} className={secondaryButtonClass()}>
            Cancel
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={() => save('draft')} className={secondaryButtonClass()}>
            <Save size={14} />{busy === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" disabled={Boolean(busy)} onClick={() => save('submit')} className={primaryButtonClass()}>
            <Send size={14} />{busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>
      </div>
    </div>}

    {step === 1 && <p className="mt-4 flex items-center gap-2 text-[11px] text-muted">
      <Check size={13} className="text-emerald-600" />Save a draft with item titles; complete each item before submitting.
    </p>}
  </>;
}
