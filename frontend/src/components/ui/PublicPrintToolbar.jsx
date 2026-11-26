import { useMemo } from 'react';
import PrintButton from './PrintButton.jsx';
import PrintHeader from './PrintHeader.jsx';
import { dateTimeLabel } from '../../utils/format.js';

// Signed-link pages have no authenticated report API. This gives them the same
// A4 print header and action styling as staff registers, with downloads omitted.
export default function PublicPrintToolbar({ title, reference = '', label = 'Print document', note = '' }) {
  const generated = useMemo(() => `Generated ${dateTimeLabel(new Date().toISOString())}`, []);

  return <>
    <PrintHeader title={title} reference={reference} dates={generated} />
    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand bg-white px-4 py-3">
      <div>
        <h2 className="display-font text-sm font-extrabold text-black">{title}</h2>
        <p className="text-[11px] text-black">{note || 'Print this signed-link document for your records.'}</p>
      </div>
      <PrintButton label={label} tone="toolbar" />
    </div>
  </>;
}
