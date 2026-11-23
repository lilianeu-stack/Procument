import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, Info, Paperclip, Plus, Save, Send, Trash2
} from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import {
  AttachmentPicker, EmptyState, ErrorState, KeyValue, PageHeader,
  TableScroll, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { currency, dateLabel } from '../../utils/format.js';
import { filesToAttachments } from '../../utils/attachments.js';

const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const UNITS = ['unit', 'box', 'kg', 'litre', 'hour', 'day', 'set', 'piece'];

const emptyItem = () => ({ itemName: '', description: '', quantity: '1', unit: 'unit', estimatedUnitCost: '' });

function itemTotals(items) {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimatedUnitCost) || 0), 0);
}

export default function CreatePurchaseRequest({ portalApi, navigate, query = {} }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    title: query.title || '',
    justification: '',
    budgetCode: '',
    requiredBy: '',
    priority: 'Medium'
  });
  const [items, setItems] = useState([emptyItem()]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const total = useMemo(() => itemTotals(items), [items]);
  const budgetMissing = !form.budgetCode.trim();
  const needsAdministrator = /no active supervisor|contact an administrator/i.test(error);
  const hasUnsavedChanges = Boolean(
    form.title || form.justification || form.budgetCode || form.requiredBy || form.priority !== 'Medium' ||
    items.some((item) => item.itemName || item.description || item.estimatedUnitCost || item.quantity !== '1' || item.unit !== 'unit') ||
    files.length
  );

  function cancelRequest() {
    if (busy) return;
    if (hasUnsavedChanges && !window.confirm('Discard this unsaved request and return to My Procurement Requests?')) return;
    navigate('My Procurement Requests');
  }

  function updateItem(index, key, value) {
    setItems((current) => current.map((item, position) => position === index ? { ...item, [key]: value } : item));
  }

  function validate() {
    if (!form.title.trim()) return 'A request title is required.';
    if (!form.justification.trim()) return 'A justification is required.';
    if (!form.budgetCode.trim()) return 'A budget code is required.';
    if (!items.length) return 'Add at least one item.';
    for (const [index, item] of items.entries()) {
      if (!item.itemName.trim()) return `Item ${index + 1} needs a name.`;
      if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) return `Item ${index + 1} needs a whole quantity of at least 1.`;
      if (item.estimatedUnitCost === '' || !Number.isFinite(Number(item.estimatedUnitCost)) || Number(item.estimatedUnitCost) < 0) {
        return `Item ${index + 1} needs a valid estimated unit cost.`;
      }
    }
    return '';
  }

  function goToReview() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError('');
    setStep(2);
  }

  async function save(action) {
    setError('');
    if (action === 'submit') {
      const problem = validate();
      if (problem) { setError(problem); setStep(1); return; }
    } else if (!items.some((item) => item.itemName.trim())) {
      setError('Add at least one item before saving a draft.');
      setStep(1);
      return;
    }
    setBusy(action);
    try {
      const attachments = files.length ? await filesToAttachments(files) : undefined;
      const result = await portalApi.createRequesterRequest({
        title: form.title.trim(),
        justification: form.justification.trim(),
        budgetCode: form.budgetCode.trim(),
        requiredBy: form.requiredBy || undefined,
        priority: form.priority,
        items: items.map((item) => ({
          itemName: item.itemName.trim(),
          description: item.description.trim(),
          quantity: Number(item.quantity),
          unit: item.unit || 'unit',
          estimatedUnitCost: Number(item.estimatedUnitCost)
        })),
        action,
        attachments
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
      description="Describe what your Department needs, attach supporting documents, then review before saving or submitting for approval."
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
      <PageCard title="Request details" description="Fields marked * are required before submitting.">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <label className="block text-xs font-bold sm:col-span-2">
            Title *
            <input required value={form.title} maxLength={180} onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="e.g. Office laptops for procurement team" className="field" />
          </label>
          <label className="block text-xs font-bold sm:col-span-2">
            Justification *
            <textarea required rows="4" value={form.justification} onChange={(event) => setForm({ ...form, justification: event.target.value })}
              placeholder="Explain why these items are needed and how they will be used." className="field h-auto py-2" />
          </label>
          <label className="block text-xs font-bold">
            Budget code *
            <input required value={form.budgetCode} maxLength={60} onChange={(event) => setForm({ ...form, budgetCode: event.target.value })}
              placeholder="e.g. OPS-2026-004" className="field" />
            {budgetMissing && <span className="mt-1 block text-[10px] font-normal text-amber-600">Required when submitting.</span>}
          </label>
          <label className="block text-xs font-bold">
            Required by
            <input type="date" value={form.requiredBy} onChange={(event) => setForm({ ...form, requiredBy: event.target.value })} className="field" />
          </label>
          <label className="block text-xs font-bold">
            Priority
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} className="field">
              {PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}
            </select>
          </label>
          <div className="rounded-lg bg-slate-50 p-3 text-[11px] leading-5 text-muted sm:col-span-1">
            <Info size={14} className="mb-1 text-brand" />
            Drafts stay with you until submitted. Once submitted, your Department Supervisor receives the request for approval.
          </div>
        </div>
      </PageCard>

      <PageCard
        title="Request items"
        description="Add every item or service needed. Line totals update automatically."
        action={<button type="button" onClick={() => setItems((current) => [...current, emptyItem()])} className={secondaryButtonClass()}>
          <Plus size={14} />Add item
        </button>}>
        {items.length === 0 ? <EmptyState title="No items added" description="Add at least one item to continue." /> :
          <TableScroll minWidth={820}>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase text-muted">
                <tr>
                  {['Item name *', 'Description', 'Qty *', 'Unit', 'Unit cost *', 'Line total', ''].map((heading) =>
                    <th key={heading} className="whitespace-nowrap px-3 py-3 font-bold">{heading}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item, index) => <tr key={index} className="align-top">
                  <td className="px-3 py-3">
                    <input required value={item.itemName} onChange={(event) => updateItem(index, 'itemName', event.target.value)}
                      placeholder="Item or service" className="field mt-0" />
                  </td>
                  <td className="px-3 py-3">
                    <input value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)}
                      placeholder="Optional detail" className="field mt-0" />
                  </td>
                  <td className="px-3 py-3">
                    <input required type="number" min="1" step="1" value={item.quantity}
                      onChange={(event) => updateItem(index, 'quantity', event.target.value)} className="field mt-0 w-20" />
                  </td>
                  <td className="px-3 py-3">
                    <select value={item.unit} onChange={(event) => updateItem(index, 'unit', event.target.value)} className="field mt-0 w-24">
                      {[...new Set([item.unit, ...UNITS])].filter(Boolean).map((unit) => <option key={unit}>{unit}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <input required type="number" min="0" step="0.01" value={item.estimatedUnitCost}
                      onChange={(event) => updateItem(index, 'estimatedUnitCost', event.target.value)}
                      placeholder="0.00" className="field mt-0 w-28" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 font-bold">{currency((Number(item.quantity) || 0) * (Number(item.estimatedUnitCost) || 0))}</td>
                  <td className="px-3 py-3">
                    <button type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, position) => position !== index))}
                      aria-label={`Remove item ${index + 1}`} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>)}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td colSpan="5" className="px-3 py-3 text-right text-xs font-bold">Estimated total</td>
                  <td className="px-3 py-3 text-sm font-extrabold text-brand">{currency(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </TableScroll>}
      </PageCard>

      <PageCard title="Supporting documents" description="Optional. Up to five files, 5 MB each.">
        <div className="p-5"><AttachmentPicker files={files} onChange={setFiles} /></div>
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
          <KeyValue label="Budget code">{form.budgetCode}</KeyValue>
          <KeyValue label="Required by">{dateLabel(form.requiredBy)}</KeyValue>
          <KeyValue label="Priority">{form.priority}</KeyValue>
          <KeyValue label="Justification" className="sm:col-span-2">{form.justification}</KeyValue>
        </dl>
        <TableScroll minWidth={520}>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-muted">
              <tr>{['Item', 'Description', 'Quantity', 'Unit cost', 'Line total'].map((heading) => <th key={heading} className="px-4 py-3 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item, index) => <tr key={index}>
                <td className="px-4 py-3 font-bold">{item.itemName}</td>
                <td className="px-4 py-3 text-muted">{item.description || '—'}</td>
                <td className="px-4 py-3">{item.quantity} {item.unit}</td>
                <td className="px-4 py-3">{currency(Number(item.estimatedUnitCost))}</td>
                <td className="px-4 py-3 font-bold">{currency(itemTotals([item]))}</td>
              </tr>)}
            </tbody>
            <tfoot><tr className="bg-slate-50"><td colSpan="4" className="px-4 py-3 text-right font-bold">Estimated total</td><td className="px-4 py-3 font-extrabold text-brand">{currency(total)}</td></tr></tfoot>
          </table>
        </TableScroll>
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold"><Paperclip size={14} />Attachments ({files.length})</div>
          {files.length ? <ul className="space-y-1">{files.map((file, index) => <li key={index} className="text-[11px] text-muted">• {file.name}</li>)}</ul>
            : <p className="text-[11px] text-muted">No documents attached.</p>}
        </div>
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
      <Check size={13} className="text-emerald-600" />You can save a draft with just one item; full details are required to submit.
    </p>}
  </>;
}
