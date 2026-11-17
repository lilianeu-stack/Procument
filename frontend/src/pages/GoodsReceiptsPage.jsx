import PageCard, { EmptyState } from '../components/ui/PageCard.jsx';
import { dateLabel } from '../utils/format.js';

export default function GoodsReceiptsPage({ receipts }) {
  return <PageCard title="Goods received notes" description="Receipts from purchase orders and direct stock sources">
    {receipts.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase text-muted"><tr>{['GRN', 'Purchase order', 'Items received', 'Source', 'Received by', 'Date'].map((cell) => <th key={cell} className="px-5 py-3">{cell}</th>)}</tr></thead><tbody className="divide-y">{receipts.map((receipt) => <tr key={receipt.id}><td className="px-5 py-4 font-bold">{receipt.reference}</td><td className="px-5 py-4">{receipt.purchaseOrder || 'Direct receipt'}</td><td className="px-5 py-4">{receipt.items}</td><td className="px-5 py-4">{receipt.source}</td><td className="px-5 py-4">{receipt.receivedBy}</td><td className="px-5 py-4">{dateLabel(receipt.receivedAt)}</td></tr>)}</tbody></table></div> : <EmptyState>No goods receipts have been recorded.</EmptyState>}
  </PageCard>;
}
