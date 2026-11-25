import { ClipboardCheck, FileText, PackageCheck } from 'lucide-react';
import PageCard, { EmptyState } from '../components/ui/PageCard.jsx';
import { dateLabel } from '../utils/format.js';

export default function GoodsReceiptsPage({ receipts }) {
  return <PageCard
    title="Receipt register"
    description={`${receipts.length} ${receipts.length === 1 ? 'receipt' : 'receipts'} · Purchase orders and direct stock sources`}
    action={<span className="inline-flex items-center gap-1.5 rounded-full border border-brand bg-white px-3 py-1.5 text-[10px] font-bold text-black">
      <ClipboardCheck size={13} aria-hidden="true" />
      {receipts.length} recorded
    </span>}
  >
    {receipts.length ? <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] table-fixed text-left text-xs">
        <colgroup>
          <col style={{ width: '15%' }} />
          <col style={{ width: '19%' }} />
          <col style={{ width: '27%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '10%' }} />
        </colgroup>
        <thead className="bg-hover text-[10px] uppercase tracking-[.08em] text-black/55">
          <tr>{['GRN', 'Purchase order', 'Items received', 'Source', 'Received by', 'Date'].map((cell) =>
            <th key={cell} className="whitespace-nowrap px-5 py-3.5 font-bold">{cell}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-subtle">
          {receipts.map((receipt) => <tr key={receipt.id} className="transition-colors hover:bg-hover">
            <td className="px-5 py-4 align-middle font-mono text-[11px] font-semibold">{receipt.reference || '—'}</td>
            <td className="px-5 py-4 align-middle">
              <span className="inline-flex items-center gap-2 font-semibold">
                <FileText size={14} className="shrink-0 text-black/50" aria-hidden="true" />
                {receipt.purchaseOrder || 'Direct receipt'}
              </span>
            </td>
            <td className="break-words px-5 py-4 align-middle leading-5">{receipt.items || '—'}</td>
            <td className="px-5 py-4 align-middle">{receipt.source || '—'}</td>
            <td className="px-5 py-4 align-middle">{receipt.receivedBy || '—'}</td>
            <td className="whitespace-nowrap px-5 py-4 align-middle">{dateLabel(receipt.receivedAt)}</td>
          </tr>)}
        </tbody>
      </table>
    </div> : <EmptyState>
      <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-10">
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-brand bg-white text-black">
          <PackageCheck size={22} strokeWidth={1.7} aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-sm font-bold text-black">No goods receipts yet</h3>
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
          Recorded deliveries will appear here with their items, source, and receipt date.
        </p>
      </div>
    </EmptyState>}
  </PageCard>;
}
