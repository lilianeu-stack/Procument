import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, PackageCheck, XCircle } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import { currency, dateLabel, dateTimeLabel } from '../../utils/format.js';
import {
  EmptyState, ErrorState, FilterBar, FilterField, LoadingState, PageHeader,
  Pagination, PortalBadge, SearchField, TableScroll, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';

const TABS = [
  { value: 'Pending', label: 'Awaiting decision' },
  { value: 'Accepted', label: 'Accepted into stock' },
  { value: 'Rejected', label: 'Rejected' },
  { value: '', label: 'All items' }
];
const STATUS_TONES = { Pending: 'amber', Accepted: 'emerald', Rejected: 'red' };

function statusBadge(status) {
  return <PortalBadge tone={STATUS_TONES[status] || 'slate'}>{status}</PortalBadge>;
}

export default function StockKeeperDisplayBeforeDelivery({ portalApi }) {
  const [filters, setFilters] = useState({ status: 'Pending', search: '', page: 1, limit: 10 });
  const [searchInput, setSearchInput] = useState('');
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decision, setDecision] = useState(null);
  const [reason, setReason] = useState('');
  const [decisionError, setDecisionError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await portalApi.getPurchaseOrderDeliveries(filters);
      setResponse(result);
    } catch (exception) {
      setError(exception.message || 'Purchase order items could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, filters]);

  useEffect(() => { void load(); }, [load]);

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value, page: name === 'page' ? value : 1 }));
  }

  function applySearch(event) {
    event.preventDefault();
    updateFilter('search', searchInput.trim());
  }

  function openDecision(row, type) {
    setDecision({ row, type });
    setReason('');
    setDecisionError('');
    setNotice('');
  }

  async function submitDecision(event) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (decision.type === 'reject' && !trimmed) {
      setDecisionError('Enter the reason for rejecting this item.');
      return;
    }
    setBusy(true);
    setDecisionError('');
    try {
      const result = decision.type === 'accept'
        ? await portalApi.acceptPurchaseOrderDelivery(decision.row.id, { reason: trimmed })
        : await portalApi.rejectPurchaseOrderDelivery(decision.row.id, { reason: trimmed });
      setNotice(result.message || `Item ${decision.type === 'accept' ? 'accepted' : 'rejected'}.`);
      setDecision(null);
      setReason('');
      await load();
    } catch (exception) {
      setDecisionError(exception.message || 'The decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  const deliveries = response?.deliveries || [];
  const counts = response?.counts || { all: 0, Pending: 0, Accepted: 0, Rejected: 0 };

  return <div className="space-y-5">
    <PageHeader
      eyebrow="Storekeeper pre-delivery queue"
      title="Display before delivery"
      description="Items from purchase orders that have been sent to a supplier. Accept an item to add it to stock, or reject it so it never enters the inventory."
    />

    {notice && <div role="status" className="rounded-lg border border-brand bg-white px-4 py-3 text-xs text-black">{notice}</div>}
    <ErrorState message={error} onRetry={() => void load()} />

    <div className="flex flex-wrap gap-2">
      {TABS.map((tab) => {
        const count = tab.value ? (counts[tab.value] || 0) : (counts.all || 0);
        const active = filters.status === tab.value;
        return <button
          key={tab.label}
          type="button"
          onClick={() => updateFilter('status', tab.value)}
          aria-pressed={active}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition ${active ? 'border-brand bg-reference text-black' : 'border-brand bg-white text-black hover:bg-hover'}`}
        >
          {tab.label}
          <span className="grid min-w-6 place-items-center rounded-full border border-brand bg-white px-1.5 py-0.5 text-[10px]">{count}</span>
        </button>;
      })}
    </div>

    <div className="overflow-hidden rounded-2xl border border-brand bg-white">
      <FilterBar>
        <form onSubmit={applySearch} className="flex flex-wrap items-end gap-3">
          <SearchField
            value={searchInput}
            onChange={setSearchInput}
            onClear={() => { setSearchInput(''); updateFilter('search', ''); }}
            placeholder="Search item, PO, supplier or department"
            className="w-full sm:w-80"
          />
          <button type="submit" className={secondaryButtonClass()}>Search</button>
          <FilterField label="Rows per page" className="w-full sm:w-32">
            <select
              value={filters.limit}
              onChange={(event) => updateFilter('limit', Number(event.target.value))}
              className="field"
              aria-label="Rows per page"
            >
              {[10, 25, 50, 100].map((limit) => <option key={limit} value={limit}>{limit}</option>)}
            </select>
          </FilterField>
        </form>
      </FilterBar>

      {loading && !response ? <LoadingState label="Loading purchase order items…" /> : deliveries.length ? <>
        <TableScroll minWidth={1080} label="Purchase order items awaiting delivery review">
          <table className="w-full border-collapse text-left text-xs text-black">
            <thead className="border-b border-subtle bg-white text-[10px] font-extrabold uppercase tracking-[.08em]">
              <tr>
                <th className="px-4 py-3">Purchase order</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Quantity / Unit price</th>
                <th className="px-4 py-3">Supplier &amp; department</th>
                <th className="px-4 py-3">Delivery date</th>
                <th className="px-4 py-3">Decision</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {deliveries.map((row) => <tr key={row.id} data-delivery-id={row.id}>
                <td className="px-4 py-3">
                  <div className="font-bold">{row.poReference}</div>
                  <div className="mt-0.5 text-[10px] text-black">Queued {dateTimeLabel(row.createdAt)}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-bold">{row.itemName}</div>
                  {row.description && <div className="mt-0.5 max-w-64 text-[10px] leading-4 text-black">{row.description}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="font-bold">{Number(row.quantity).toLocaleString('en-US')} {row.unit}</div>
                  <div className="mt-0.5 text-[10px] text-black">{currency(row.unitPrice)} each</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-bold">{row.supplierName}</div>
                  <div className="mt-0.5 text-[10px] text-black">{row.departmentName || 'Unassigned department'}</div>
                </td>
                <td className="px-4 py-3">{row.deliveryDate ? dateLabel(row.deliveryDate) : '—'}</td>
                <td className="px-4 py-3">
                  <div>{statusBadge(row.status)}</div>
                  {row.status === 'Pending' ? <div className="mt-1 text-[10px] text-black">Awaiting Storekeeper review</div> : <>
                    <div className="mt-1 text-[10px] text-black">{row.decidedByName || 'Storekeeper'}{row.decidedAt ? ` · ${dateTimeLabel(row.decidedAt)}` : ''}</div>
                    {row.decisionReason && <div className="mt-0.5 max-w-56 text-[10px] leading-4 text-black">{row.decisionReason}</div>}
                  </>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {row.status === 'Pending' ? <>
                      <button
                        type="button"
                        onClick={() => openDecision(row, 'accept')}
                        className={primaryButtonClass('!px-2.5 !py-1.5')}
                        aria-label={`Accept ${row.itemName}`}
                      >
                        <CheckCircle2 size={13} />Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => openDecision(row, 'reject')}
                        className={secondaryButtonClass('!px-2.5 !py-1.5')}
                        aria-label={`Reject ${row.itemName}`}
                      >
                        <XCircle size={13} />Reject
                      </button>
                    </> : <span className="text-[10px] text-black">Decision recorded</span>}
                  </div>
                </td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>
        <Pagination
          pagination={response?.pagination}
          limit={filters.limit}
          onChange={(page) => updateFilter('page', page)}
          onLimitChange={(limit) => updateFilter('limit', limit)}
          limitOptions={[10, 25, 50, 100]}
        />
      </> : <EmptyState
        title="No purchase order items here"
        description={filters.status === 'Pending'
          ? 'Items appear here after the signed official purchase order has been sent to its supplier.'
          : 'No items match the selected decision status.'}
        action={<PackageCheck size={16} className="mx-auto text-black" />}
      />}
    </div>

    {decision && <Modal
      title={decision.type === 'accept' ? 'Accept item into stock' : 'Reject item'}
      onClose={() => { if (!busy) setDecision(null); }}
      dismissible={!busy}
    >
      <form onSubmit={submitDecision} className="space-y-4">
        <div className="rounded-xl border border-brand bg-white p-4 text-xs">
          <div className="font-bold">{decision.row.itemName}</div>
          <div className="mt-1 text-black">
            {decision.row.poReference} · {Number(decision.row.quantity).toLocaleString('en-US')} {decision.row.unit} · {decision.row.supplierName}
          </div>
        </div>
        {decision.type === 'accept' ? <p className="text-xs leading-5 text-black">
          Accepting this item creates a stock receipt and adds the quantity to the inventory catalogue.
        </p> : <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wide text-black">Reason for rejection</span>
          <textarea
            value={reason}
            onChange={(event) => { setReason(event.target.value); setDecisionError(''); }}
            rows={3}
            className="field mt-1"
            placeholder="Explain why this item must not enter stock"
          />
        </label>}
        {decisionError && <div role="alert" className="rounded-lg border border-brand bg-white px-3 py-2 text-xs text-black">{decisionError}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setDecision(null)} disabled={busy} className={secondaryButtonClass()}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}>
            {busy ? 'Saving…' : decision.type === 'accept' ? 'Confirm acceptance' : 'Confirm rejection'}
          </button>
        </div>
      </form>
    </Modal>}
  </div>;
}
