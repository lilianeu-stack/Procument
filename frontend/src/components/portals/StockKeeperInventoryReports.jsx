import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import ReportToolbar from '../ui/ReportToolbar.jsx';
import {
  EmptyState, ErrorState, FilterBar, FilterField, LoadingState, PageHeader,
  SearchField, TableScroll, secondaryButtonClass
} from './PortalUi.jsx';
import { dateQueryForFilter } from '../../utils/reportFields.js';

function displayValue(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

const REPORTS = [
  { key: 'stockkeeperStockMovement', title: 'Stock Movement', fields: [{ key: 'movement', label: 'Transaction date' }, { key: 'created', label: 'Date recorded' }], defaultField: 'movement', transactionTypes: ['Receipt', 'Issue', 'Adjustment'] },
  { key: 'stockkeeperStockIn', title: 'Stock In', fields: [{ key: 'movement', label: 'Transaction date' }, { key: 'created', label: 'Date recorded' }], defaultField: 'movement', transactionTypes: ['Receipt', 'Adjustment'] },
  { key: 'stockkeeperStockOut', title: 'Stock Out', fields: [{ key: 'movement', label: 'Transaction date' }, { key: 'created', label: 'Date recorded' }], defaultField: 'movement', transactionTypes: ['Issue', 'Adjustment'] },
  { key: 'stockkeeperCurrentBalance', title: 'Current Stock Balance', fields: [{ key: 'updated', label: 'Last updated' }], defaultField: 'updated', transactionTypes: [] },
  { key: 'stockkeeperDepartmentStock', title: 'Department Stock', fields: [{ key: 'updated', label: 'Last updated' }], defaultField: 'updated', transactionTypes: [] },
  { key: 'stockkeeperLowStock', title: 'Low Stock', fields: [{ key: 'updated', label: 'Last updated' }], defaultField: 'updated', transactionTypes: [] },
  { key: 'stockkeeperDamagedGoods', title: 'Damaged / Rejected Goods', fields: [{ key: 'received', label: 'Date received' }, { key: 'expected', label: 'Expected delivery' }], defaultField: 'received', transactionTypes: [] },
  { key: 'stockkeeperSupplierDeliveries', title: 'Supplier Delivery / Receiving', fields: [{ key: 'received', label: 'Date received' }, { key: 'expected', label: 'Expected delivery' }], defaultField: 'received', transactionTypes: [] }
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, index) => currentYear - index);

export default function StockKeeperInventoryReports({ portalApi, user = {}, department = '' }) {
  const [type, setType] = useState(REPORTS[0].key);
  const [filters, setFilters] = useState({ departmentId: '', itemId: '', transactionType: '', year: '', search: '', sort: '', direction: '' });
  const [dateFilter, setDateFilter] = useState({});
  const [catalog, setCatalog] = useState({ items: [], departments: [] });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const config = useMemo(() => REPORTS.find((entry) => entry.key === type) || REPORTS[0], [type]);

  useEffect(() => {
    Promise.all([
      portalApi.getStockOverview({}),
      portalApi.getStockItems()
    ]).then(([overview, items]) => setCatalog({
      departments: overview.departments || [],
      items: items.items || []
    })).catch((exception) => setError(exception.message || 'Report filters could not be loaded.'));
  }, [portalApi]);

  const effectiveDateFilter = useMemo(() => {
    if (!filters.year) return dateFilter;
    return { from: `${filters.year}-01-01`, to: `${filters.year}-12-31`, dateField: config.defaultField };
  }, [dateFilter, filters.year, config.defaultField]);

  const params = useMemo(() => ({
    type,
    ...dateQueryForFilter({
      ...effectiveDateFilter,
      dateField: effectiveDateFilter.dateField || config.defaultField
    }),
    ...Object.fromEntries(Object.entries(filters).filter(([key, value]) => key !== 'year' && value !== ''))
  }), [type, effectiveDateFilter, filters, config.defaultField]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await portalApi.getInventoryReport(params));
    } catch (exception) {
      setError(exception.message || 'The inventory report could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi, params]);

  useEffect(() => { load(); }, [load]);

  const reportConfig = useMemo(() => ({
    exportKey: config.key,
    title: config.title,
    fields: config.fields,
    defaultField: config.defaultField
  }), [config]);
  const columns = report?.rows?.length ? Object.keys(report.rows[0]) : [];

  return <>
    <div className="mb-4 flex justify-end">
      <button type="button" className={secondaryButtonClass()} onClick={load}><RefreshCw size={13} />Refresh</button>
    </div>
    <ErrorState message={error} onRetry={load} />
    <PageCard title="Report filters">
      <FilterBar>
        <FilterField label="Report type" className="w-full sm:w-64">
          <select value={type} onChange={(event) => { setType(event.target.value); setFilters({ ...filters, transactionType: '' }); }} className="field">
            {REPORTS.map((entry) => <option key={entry.key} value={entry.key}>{entry.title}</option>)}
          </select>
        </FilterField>
        <FilterField label="Department" className="w-full sm:w-52">
          <select value={filters.departmentId} onChange={(event) => setFilters({ ...filters, departmentId: event.target.value })} className="field">
            <option value="">All departments</option>
            {catalog.departments.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Item" className="w-full sm:w-56">
          <select value={filters.itemId} onChange={(event) => setFilters({ ...filters, itemId: event.target.value })} className="field">
            <option value="">All items</option>
            {catalog.items.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </FilterField>
        {config.transactionTypes.length > 0 && <FilterField label="Transaction type" className="w-full sm:w-44">
          <select value={filters.transactionType} onChange={(event) => setFilters({ ...filters, transactionType: event.target.value })} className="field">
            <option value="">All types</option>
            {config.transactionTypes.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </FilterField>}
        <FilterField label="Year" className="w-full sm:w-32">
          <select value={filters.year} onChange={(event) => setFilters({ ...filters, year: event.target.value })} className="field">
            <option value="">Any date</option>
            {YEARS.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </FilterField>
        <SearchField value={filters.search} onChange={(search) => setFilters({ ...filters, search })} onClear={() => setFilters({ ...filters, search: '' })} placeholder="Search reference, item or supplier…" />
        <button type="button" className={secondaryButtonClass()} onClick={() => { setFilters({ departmentId: '', itemId: '', transactionType: '', year: '', search: '', sort: '', direction: '' }); setDateFilter({}); }}>Clear filters</button>
      </FilterBar>
    </PageCard>

    <ReportToolbar
      report={reportConfig}
      dateFilter={effectiveDateFilter}
      onDateFilterChange={(next) => { setDateFilter(next); if (next.from || next.to) setFilters({ ...filters, year: '' }); }}
      params={Object.fromEntries(Object.entries(params).filter(([key]) => !['from', 'to', 'dateField'].includes(key)))}
      reference={config.title}
      user={user}
      department={department}
      scope={`${report?.rows?.length || 0} matching ${config.title.toLowerCase()} record${report?.rows?.length === 1 ? '' : 's'}`}
    />

    <PageCard title={`${config.title} register`} description={`${report?.rows?.length || 0} record${report?.rows?.length === 1 ? '' : 's'}`}>
      {loading ? <LoadingState label="Loading report…" /> : !columns.length ?
        <EmptyState title="No matching records" description="Adjust the filters or date range and run the report again." /> :
        <TableScroll minWidth={Math.max(900, columns.length * 140)}>
          <table className="w-full text-left text-xs">
            <thead className="bg-white text-[10px] uppercase text-black">
              <tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-3">{column}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {report.rows.map((row, index) => <tr key={index}>
                {columns.map((column) => <td key={column} className="whitespace-nowrap px-3 py-3">{displayValue(row[column])}</td>)}
              </tr>)}
            </tbody>
          </table>
        </TableScroll>}
      {Boolean(report?.summary?.length) && <div className="flex flex-wrap gap-3 border-t border-subtle bg-white px-4 py-3 text-xs font-bold">
        {report.summary.map((total) => <span key={total.column}>{total.label}: {total.value}</span>)}
      </div>}
    </PageCard>
  </>;
}
