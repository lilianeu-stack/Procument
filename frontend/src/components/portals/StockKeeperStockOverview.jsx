import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import DownloadButton from '../ui/DownloadButton.jsx';
import Modal from '../ui/Modal.jsx';
import PageCard from '../ui/PageCard.jsx';
import {
  EmptyState, ErrorState, FilterBar, FilterField, LoadingState,
  PortalBadge, SearchField, TableScroll, primaryButtonClass, secondaryButtonClass
} from './PortalUi.jsx';
import { dateTimeLabel } from '../../utils/format.js';

const number = (value) => Number(value) || 0;

function statusTone(status) {
  if (status === 'Available') return 'emerald';
  if (status === 'Low Stock') return 'amber';
  return 'red';
}

export default function StockKeeperStockOverview({ portalApi, initial = null }) {
  const [data, setData] = useState(initial || { items: [], departments: [] });
  const [filters, setFilters] = useState({ search: '', departmentId: '' });
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await portalApi.getStockOverview(filters));
    } catch (exception) {
      setError(exception.message || 'Stock overview could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, filters]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => data.items || [], [data]);
  const groups = useMemo(() => {
    const grouped = new Map();
    for (const item of items) {
      const key = `${item.department || 'Unassigned'}::${item.storageLocation || 'General storage'}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(item);
    }
    return [...grouped.entries()];
  }, [items]);

  async function saveLocation(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await portalApi.updateStockLocation(editing.id, {
        departmentId: editing.departmentId || null,
        storageLocation: editing.storageLocation || 'General storage'
      });
      setEditing(null);
      await load();
    } catch (exception) {
      setError(exception.message || 'The storage location could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
      <DownloadButton exportKey="stockkeeperCurrentBalance" format="xlsx" params={filters} label="Excel" />
      <DownloadButton exportKey="stockkeeperDepartmentStock" format="csv" params={filters} label="CSV" />
      <button type="button" onClick={load} className={secondaryButtonClass()}><RefreshCw size={13} />Refresh</button>
    </div>
    <ErrorState message={error} onRetry={load} />
    <PageCard title="Current stock by Department and location" description={`${items.length} item${items.length === 1 ? '' : 's'}`} noPadding>
      <FilterBar>
        <SearchField value={filters.search} onChange={(search) => setFilters({ ...filters, search })} onClear={() => setFilters({ ...filters, search: '' })} placeholder="Search item, code, category or location…" />
        <FilterField label="Department" className="w-full sm:w-56">
          <select value={filters.departmentId} onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })} className="field">
            <option value="">All departments</option>
            <option value="unassigned">Unassigned</option>
            {(data.departments || []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        </FilterField>
      </FilterBar>
      {loading && !initial ? <LoadingState label="Loading stock overview…" /> : !groups.length ?
        <EmptyState title="No stock records" description="No catalogue items match the current filters." /> :
        groups.map(([groupName, rows]) => <section key={groupName} className="border-b border-subtle last:border-b-0">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-3">
            <h3 className="text-xs font-extrabold">{groupName}</h3>
            <span className="text-[10px] text-black">{rows.length} item{rows.length === 1 ? '' : 's'}</span>
          </div>
          <TableScroll minWidth={1240}>
            <table className="w-full text-left text-xs">
              <thead className="bg-white text-[10px] uppercase text-black">
                <tr>{['Code', 'Item', 'Category', 'Department', 'Location', 'Unit', 'Opening', 'Stock in', 'Stock out', 'Current', 'Minimum', 'Status', 'Updated', 'Action'].map((name) =>
                  <th key={name} className="whitespace-nowrap px-3 py-3">{name}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((item) => <tr key={item.id}>
                  <td className="px-3 py-3 font-bold">{item.itemCode || '—'}</td>
                  <td className="px-3 py-3">{item.itemName}</td>
                  <td className="px-3 py-3">{item.category || '—'}</td>
                  <td className="px-3 py-3">{item.department}</td>
                  <td className="px-3 py-3">{item.storageLocation}</td>
                  <td className="px-3 py-3">{item.unitOfMeasure || 'unit'}</td>
                  <td className="px-3 py-3">{number(item.openingBalance)}</td>
                  <td className="px-3 py-3">{number(item.totalStockIn)}</td>
                  <td className="px-3 py-3">{number(item.totalStockOut)}</td>
                  <td className="px-3 py-3 font-bold">{number(item.currentBalance)}</td>
                  <td className="px-3 py-3">{number(item.minimumStock)}</td>
                  <td className="px-3 py-3"><PortalBadge tone={statusTone(item.status)}>{item.status}</PortalBadge></td>
                  <td className="px-3 py-3">{dateTimeLabel(item.updatedAt)}</td>
                  <td className="px-3 py-3"><button type="button" className={secondaryButtonClass()}
                    onClick={() => setEditing({ id: item.id, departmentId: item.departmentId || '', storageLocation: item.storageLocation || '' })}>
                    <MapPin size={13} />Set location
                  </button></td>
                </tr>)}
              </tbody>
            </table>
          </TableScroll>
        </section>)}
    </PageCard>

    {editing && <Modal title="Set Department and storage location" onClose={() => setEditing(null)}>
      <form onSubmit={saveLocation} className="space-y-3 text-xs text-black">
        <label className="block font-bold">Department
          <select value={editing.departmentId} onChange={(event) => setEditing({ ...editing, departmentId: event.target.value })} className="field">
            <option value="">Unassigned</option>
            {(data.departments || []).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
        </label>
        <label className="block font-bold">Storage location
          <input value={editing.storageLocation} onChange={(event) => setEditing({ ...editing, storageLocation: event.target.value })} className="field" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass()} onClick={() => setEditing(null)}>Cancel</button>
          <button type="submit" disabled={busy} className={primaryButtonClass()}>{busy ? 'Saving…' : 'Save location'}</button>
        </div>
      </form>
    </Modal>}
  </>;
}
