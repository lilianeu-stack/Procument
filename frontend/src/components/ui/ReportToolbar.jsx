import { useState } from 'react';
import DateRangeFilter from './DateRangeFilter.jsx';
import DownloadButton from './DownloadButton.jsx';
import PrintButton from './PrintButton.jsx';
import PrintHeader from './PrintHeader.jsx';
import ReportPrintTable from './ReportPrintTable.jsx';
import { fetchReportRows } from '../../utils/exports.js';
import { dateQueryForFilter } from '../../utils/reportFields.js';

// One toolbar for every printable/downloadable dataset. Callers supply only
// the module-specific date fields and the filters already applied to the list.
// Print, PDF, Excel and CSV all use the same filter query and full result set.
export default function ReportToolbar({
  report,
  dateFilter = {},
  onDateFilterChange,
  params = {},
  reference = '',
  onPrint,
  printLabel,
  printDates = '',
  printing = false,
  user = null,
  department = '',
  scope = 'matching records',
  renderPrintTable = true,
  dateFilterFromToOnly = false,
  dateFilterContent = null
}) {
  const [printRows, setPrintRows] = useState([]);
  const [printMetadata, setPrintMetadata] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [printError, setPrintError] = useState('');

  const value = {
    ...dateFilter,
    dateField: dateFilter.dateField || report.defaultField
  };
  const query = { ...dateQueryForFilter(value), ...params };
  const generated = printMetadata.find((line) => /^Generated /i.test(line)) || printDates;
  const busy = printing || fetching;

  async function handlePrint() {
    if (onPrint) {
      await onPrint();
      return;
    }
    setFetching(true);
    setPrintError('');
    try {
      const result = await fetchReportRows({ key: report.exportKey, params: query, reference });
      setPrintRows(result.rows);
      setPrintMetadata(result.metadata);
      await new Promise((resolve) => {
        if (!window.requestAnimationFrame) { resolve(); return; }
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
      });
      window.print();
    } catch (error) {
      setPrintError(error.message || 'The print register could not be prepared.');
    } finally {
      setFetching(false);
    }
  }

  return <>
    <PrintHeader title={report.title} reference={reference} dates={generated} />
    {renderPrintTable && <ReportPrintTable
      report={report}
      columns={printRows.length ? Object.keys(printRows[0]) : []}
      rows={printRows.map((row) => Object.values(row))}
      metadata={printMetadata}
      user={user}
      department={department}
      scope={scope}
    />}
    <div className="no-print mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton
            label={printLabel || (busy ? 'Preparing…' : 'Print Register')}
            tone="toolbar"
            disabled={busy}
            onClick={handlePrint}
          />
          <DownloadButton exportKey={report.exportKey} format="pdf" params={query} reference={reference} label="Download PDF" tone="toolbar" />
          <DownloadButton exportKey={report.exportKey} format="xlsx" params={query} reference={reference} label="Download Excel" tone="toolbar" />
          <DownloadButton exportKey={report.exportKey} format="csv" params={query} reference={reference} label="Download CSV" tone="toolbar" />
        </div>
      </div>
      {printError && <p role="alert" className="rounded-lg border border-brand bg-white px-3 py-2 text-xs text-black">{printError}</p>}
      <DateRangeFilter
        fromToOnly={dateFilterFromToOnly}
        value={value}
        fields={report.fields}
        onChange={onDateFilterChange}
        label={report.title}
      >{dateFilterContent}</DateRangeFilter>
    </div>
  </>;
}
