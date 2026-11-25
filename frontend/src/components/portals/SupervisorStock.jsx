import { useCallback, useEffect, useState } from 'react';
import { Boxes, PackageSearch, X } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import {
  EmptyState, ErrorState, FilterBar, FilterField, KeyValue, LoadingState,
  PortalBadge, SearchField, TableScroll
} from './PortalUi.jsx';
import { currency, dateLabel, dateTimeLabel } from '../../utils/format.js';

const TABS = [
  { label: 'Available Stock', value: 'Available', tone: 'emerald' },
  { label: 'Low Stock', value: 'Low Stock', tone: 'amber' },
  { label: 'Out of Stock', value: 'Out of Stock', tone: 'red' }
];

function stockTone(status) {
  if (status === 'Available') return 'emerald';
  if (status === 'Low Stock') return 'amber';
  return 'red';
}

export default function SupervisorStock({ portalApi, initial = null }) {
  const [tab, setTab] = useState('Available');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [result, setResult] = useState(initial
    ? { ...initial, items: (initial.items || []).filter((item) => item.stockStatus === 'Available') }
    : null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getStock({ search, category, status: tab });
      setResult(response);
    } catch (exception) {
      setError(exception.message || 'Stock could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, search, category, tab]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true); setDetailError(''); setDetail(null); setDetailId(id);
    try {
      const response = await portalApi.getStockItem(id);
      setDetail(response);
    } catch (exception) {
      setDetailError(exception.message || 'Stock item details could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }, [portalApi]);

  const items = result?.items || [];
  const categories = result?.categories || [];

  return <>
    <PageCard title="Department stock overview"
      description="Read-only view of inventory available to your Department. Stock is managed by Procurement and Store teams.">
      <FilterBar>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {TABS.map((item) => <button key={item.value} type="button" onClick={() => setTab(item.value)}
            className={`rounded-lg px-3 py-2 text-[11px] font-bold transition ${tab === item.value ? 'border border-black bg-white text-black' : 'border border-brand bg-white text-muted hover:border-black hover:text-black'}`}>
            {item.label}
          </button>)}
        </div>
        <SearchField value={search} onChange={setSearch} placeholder="SKU, name or category…" className="w-full sm:w-64" />
        <FilterField label="Category" className="w-full sm:w-48">
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="field">
            <option value="">All categories</option>
            {categories.map((name) => <option key={name}>{name}</option>)}
          </select>
        </FilterField>
        {(search || category) && <button type="button" onClick={() => { setSearch(''); setCategory(''); }}
          className="mb-0.5 text-xs font-bold text-muted hover:text-black">Clear filters</button>}
      </FilterBar>

      {result?.message && <p className="border-b border-subtle bg-white px-5 py-2 text-[11px] text-black">{result.message}</p>}
      <ErrorState message={error} onRetry={load} />
      {loading && !result ? <LoadingState label="Loading stock…" /> : !items.length ?
        <EmptyState title="No items in this view" description="Try another tab or clear the filters." /> :
        <TableScroll minWidth={900}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-muted">
              <tr>{['SKU', 'Item', 'Category', 'Unit', 'On hand', 'Reserved', 'Issued', 'Reorder level', 'Unit cost', 'Status', ''].map((heading) =>
                <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {items.map((item) => <tr key={item.id} className="hover:bg-white">
                <td className="whitespace-nowrap px-4 py-3 font-bold">{item.sku}</td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold">{item.name}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.category || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.unit || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 font-bold">{item.quantity}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.reservedQuantity ?? 0}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.issuedQuantity ?? 0}</td>
                <td className="whitespace-nowrap px-4 py-3">{item.reorderLevel}</td>
                <td className="whitespace-nowrap px-4 py-3">{currency(item.unitCost)}</td>
                <td className="whitespace-nowrap px-4 py-3"><PortalBadge tone={stockTone(item.stockStatus)}>{item.stockStatus}</PortalBadge></td>
                <td className="whitespace-nowrap px-4 py-3">
                  <button type="button" onClick={() => loadDetail(item.id)} className="text-xs font-bold text-black hover:underline">Details</button>
                </td>
              </tr>)}
            </tbody>
          </table>
        </TableScroll>}
    </PageCard>

    {detailLoading && <div className="fixed inset-0 z-40 grid place-items-center bg-black/20"><LoadingState label="Loading item…" /></div>}
    {detailError && <div className="fixed inset-0 z-40 grid place-items-center bg-black/20 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 ">
        <ErrorState message={detailError} onRetry={() => detailId && loadDetail(detailId)} />
        <button type="button" onClick={() => setDetailError('')} className="mt-2 w-full rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black">Close</button>
      </div>
    </div>}

    {detail && <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(event) => event.target === event.currentTarget && setDetail(null)}>
      <aside className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white ">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-subtle bg-white px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted"><Boxes size={13} />Stock item</div>
            <h2 className="display-font mt-1 text-lg font-extrabold">{detail.item.name}</h2>
            <p className="mt-1 text-xs text-muted">{detail.item.sku} · {detail.item.category || 'Uncategorised'}</p>
          </div>
          <button type="button" onClick={() => setDetail(null)} aria-label="Close details" className="rounded-lg p-2 text-muted hover:bg-white"><X size={18} /></button>
        </header>
        <div className="space-y-5 p-5">
          <dl className="grid grid-cols-2 gap-4 rounded-xl border border-brand bg-white p-4">
            <KeyValue label="Status"><PortalBadge tone={stockTone(detail.item.stockStatus)}>{detail.item.stockStatus}</PortalBadge></KeyValue>
            <KeyValue label="On hand">{detail.item.quantity} {detail.item.unit}</KeyValue>
            <KeyValue label="Reorder level">{detail.item.reorderLevel}</KeyValue>
            <KeyValue label="Unit cost">{currency(detail.item.unitCost)}</KeyValue>
            <KeyValue label="Issued to date">{detail.item.issuedQuantity ?? 0}</KeyValue>
            <KeyValue label="Department">{detail.item.department || 'Shared / all departments'}</KeyValue>
            <KeyValue label="Updated">{dateLabel(detail.item.updatedAt)}</KeyValue>
          </dl>
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold"><PackageSearch size={15} />Stock movements</h3>
            {detail.movements?.length ? <TableScroll minWidth={520}>
              <table className="w-full text-left text-xs">
                <thead className="bg-white text-[10px] uppercase text-muted">
                  <tr>{['Date', 'Type', 'Quantity', 'Source', 'Balance', 'Actor'].map((heading) => <th key={heading} className="whitespace-nowrap px-3 py-2 font-bold">{heading}</th>)}</tr>
                </thead>
                <tbody className="divide-y">
                  {detail.movements.map((movement) => <tr key={movement.id}>
                    <td className="whitespace-nowrap px-3 py-2">{dateTimeLabel(movement.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-bold">{movement.movementType}</td>
                    <td className="whitespace-nowrap px-3 py-2">{movement.quantity}</td>
                    <td className="px-3 py-2">{movement.source || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{movement.balanceAfter}</td>
                    <td className="whitespace-nowrap px-3 py-2">{movement.actor || 'System'}</td>
                  </tr>)}
                </tbody>
              </table>
            </TableScroll> : <EmptyState title="No movements" description="No stock movements have been recorded for this item." />}
          </div>
        </div>
      </aside>
    </div>}
  </>;
}
