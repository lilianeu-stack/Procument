import DateRangeFilter from './DateRangeFilter.jsx';
import DownloadButton from './DownloadButton.jsx';
import PrintButton from './PrintButton.jsx';
import PrintHeader from './PrintHeader.jsx';
import { dateQueryForFilter } from '../../utils/reportFields.js';

// One toolbar for every printable/downloadable dataset. Callers supply only
// the module-specific date fields and the filters already applied to the list.
export default function ReportToolbar({
  report,
  dateFilter = {},
  onDateFilterChange,
  params = {},
  reference = '',
  professionalActions = false
}) {
  const value = {
    ...dateFilter,
    dateField: dateFilter.dateField || report.defaultField
  };
  const query = { ...dateQueryForFilter(value), ...params };

  return <>
    <PrintHeader title={report.title} reference={reference} />
    <div className="no-print mb-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="display-font text-sm font-extrabold">{report.title}</h2>
          <p className="text-[11px] text-muted">Filter the report, then print or download the current result set.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintButton label={`Print ${report.title}`} tone={professionalActions ? 'primary' : 'default'} />
          <DownloadButton exportKey={report.exportKey} format="pdf" params={query} reference={reference} label="Download PDF" tone={professionalActions ? 'toolbar' : 'default'} />
          <DownloadButton exportKey={report.exportKey} format="xlsx" params={query} reference={reference} label="Download Excel" tone={professionalActions ? 'toolbar' : 'default'} />
          <DownloadButton exportKey={report.exportKey} format="csv" params={query} reference={reference} label="Download CSV" tone={professionalActions ? 'toolbar' : 'default'} />
        </div>
      </div>
      <DateRangeFilter
        value={value}
        fields={report.fields}
        onChange={onDateFilterChange}
        label={report.title}
      />
    </div>
  </>;
}
