// Print-only register rendered from the same full filtered dataset used by the
// PDF, Excel and CSV downloads. ReportToolbar fetches the rows on demand.
export default function ReportPrintTable({
  report,
  columns = [],
  rows = [],
  metadata = [],
  user = null,
  department = '',
  scope = 'matching records'
}) {
  const appliedFilters = metadata.find((line) => /^Applied filters:/i.test(line))
    || 'Applied filters: None';
  const generated = metadata.find((line) => /^Generated /i.test(line))
    || `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  const headingColumns = columns.length ? columns : ['No records found'];

  return <section className="print-only report-print-register" aria-label={`Print-ready ${report.title} register`}>
    <div className="print-register-meta">
      <div><strong>System</strong><span>Procurement Management System</span></div>
      <div><strong>Report</strong><span>{report.title}</span></div>
      {user?.name && <div><strong>Prepared by</strong><span>{user.name}{user.roleLabel ? ` · ${user.roleLabel}` : ''}</span></div>}
      {(department || user?.department) && <div><strong>Department</strong><span>{department || user.department}</span></div>}
      <div><strong>Generated</strong><span>{generated.replace(/^Generated\s*/i, '')}</span></div>
      <div><strong>Applied filters</strong><span>{appliedFilters.replace(/^Applied filters:\s*/i, '')}</span></div>
    </div>
    <table className="report-print-table">
      <thead>
        <tr>{headingColumns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length ? rows.map((row, index) => <tr key={index}>
          {row.map((cell, cellIndex) => <td key={cellIndex}>{cell || '—'}</td>)}
        </tr>) : <tr><td colSpan={headingColumns.length}>No records match the active filters.</td></tr>}
      </tbody>
    </table>
    <p className="print-register-note">
      {rows.length.toLocaleString('en-US')} {scope} · {appliedFilters} · {generated}
    </p>
  </section>;
}
