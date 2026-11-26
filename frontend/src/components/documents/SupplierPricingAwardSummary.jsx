import { formatRwf } from '../../utils/purchaseCalculations.js';

export default function SupplierPricingAwardSummary({ award }) {
  if (!award) return null;
  return <section className="rounded-xl border border-brand bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-black">
          Supplier pricing award · internal approval pending
        </p>
        <h2 className="mt-1 text-sm font-extrabold">{award.supplierName}</h2>
        <p className="mt-1 text-xs text-black">
          {award.requestReference}{award.supplierEmail ? ` · ${award.supplierEmail}` : ''}
          {award.awardedAt ? ` · Awarded ${new Date(award.awardedAt).toLocaleDateString()}` : ''}
        </p>
      </div>
      <div className="text-right">
        <span className="block text-[10px] text-black">Selected quotation total</span>
        <strong className="text-lg text-black">{formatRwf(award.total)}</strong>
      </div>
    </div>

    {award.items?.length > 0 && <div className="mt-4 overflow-x-auto rounded-lg border border-brand">
      <table className="w-full min-w-[700px] text-left text-xs">
        <thead className="bg-white text-[10px] uppercase text-black">
          <tr>{['Item', 'Quantity', 'Unit', 'Description', 'Supplier unit price', 'Line total'].map((label) =>
            <th key={label} className="px-3 py-2 font-bold">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {award.items.map((item) => <tr key={item.purchaseOrderItemId}>
            <td className="px-3 py-2 font-bold">{item.itemNo}</td>
            <td className="px-3 py-2">{item.quantity}</td>
            <td className="px-3 py-2">{item.unit}</td>
            <td className="px-3 py-2">{item.description || item.itemName}</td>
            <td className="px-3 py-2">{formatRwf(item.unitPrice)}</td>
            <td className="px-3 py-2 font-bold">{formatRwf(item.lineTotal)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}

    <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div><dt className="text-[10px] text-black">Subtotal</dt><dd className="font-bold">{formatRwf(award.subtotal)}</dd></div>
      <div><dt className="text-[10px] text-black">VAT ({award.vatRate || 0}%)</dt><dd className="font-bold">{formatRwf(award.vatAmount)}</dd></div>
      <div><dt className="text-[10px] text-black">Other charges</dt><dd className="font-bold">{formatRwf(award.otherCharges)}</dd></div>
      <div><dt className="text-[10px] text-black">Quotation validity</dt><dd className="font-bold">{award.quotationValidity || '—'}</dd></div>
      <div><dt className="text-[10px] text-black">Delivery lead time</dt><dd className="font-bold">{award.deliveryLeadTime || '—'}</dd></div>
      {(award.comments || award.technicalRemarks) && <div className="sm:col-span-2 lg:col-span-3">
        <dt className="text-[10px] text-black">Supplier remarks</dt>
        <dd className="whitespace-pre-wrap font-semibold">{[award.comments, award.technicalRemarks].filter(Boolean).join('\n')}</dd>
      </div>}
    </dl>
    <p className="mt-3 text-[10px] text-black">
      This award is stored separately from the original Purchase Order. Approval is still required before issue.
    </p>
  </section>;
}
