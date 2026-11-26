import { createPortal } from 'react-dom';
import { dateLabel } from '../../utils/format.js';
import {
  amountInWords, calculatePurchaseTotals, formatRwf, roundMoney
} from '../../utils/purchaseCalculations.js';

// The second copy is rendered into the document body for printing only.
function OfficialSheet({ children, label }) {
  const sheet = () => <article className="official-document purchase-order-document" aria-label={label}>
    {children}
  </article>;
  return <>
    {sheet()}
    {typeof document !== 'undefined'
      ? createPortal(<div className="official-print-root">{sheet()}</div>, document.body)
      : null}
  </>;
}

function Field({ label, value, wide = false }) {
  return <div className={`official-po-field${wide ? ' official-po-field-wide' : ''}`}>
    <span className="official-label">{label}</span>
    <span className="official-value">{value || ''}</span>
  </div>;
}

function SignatureLine({ label, name, date, signature }) {
  return <div className="official-po-signature-line">
    <span className="official-label">{label}</span>
    <span className="official-po-signature-image">
      {signature ? <img src={signature} alt={`${label} signature`} /> : null}
    </span>
    <span className="official-signature-line" />
    <span className="official-value">{name || ''}</span>
    <span className="official-value official-po-signature-date">{date || ''}</span>
  </div>;
}

export default function PurchaseOrderDocument({ order = {} }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const computed = calculatePurchaseTotals(items, order.vatRate ?? 0);
  const subtotal = roundMoney(order.subtotal ?? computed.subtotal);
  const vatRate = Number(order.vatRate ?? 0) || 0;
  const vatAmount = roundMoney(order.vatAmount ?? computed.vatAmount);
  const total = roundMoney(order.total ?? computed.total);
  const words = order.amountInWords || amountInWords(total);
  const approved = Boolean(order.approvedAt)
    || ['Approved', 'Partially received', 'Received', 'Completed'].includes(order.status);

  return <OfficialSheet label="Official purchase order">
    <header className="official-header">
      <img src="/procurement-logo.png" alt="Hope Haven logo" className="official-logo" />
      <div className="official-header-text">
        <strong>HOPE HAVEN</strong>
        <span>PROCUREMENT &amp; STORES</span>
      </div>
      <div className="official-header-meta">
        <span>{order.status || 'Pending approval'}</span>
        <span>{dateLabel(order.createdAt || order.date)}</span>
      </div>
    </header>

    <h1 className="official-title">PURCHASE ORDER</h1>

    <div className="official-po-grid">
      <Field label="Supplier:" value={order.supplier || '—'} />
      <Field label="P.O No:" value={order.reference || '—'} />
      <Field label="Supplier Contact:" value={order.supplierContact || '—'} />
      <Field label="Type:" value={order.type || 'Standard'} />
      <Field label="Address:" value={order.supplierAddress || '—'} />
      <Field label="Date:" value={dateLabel(order.createdAt || order.date) || '—'} />
      <Field label="Date of Delivery:" value={dateLabel(order.deliveryDate) || '—'} />
      <Field label="Payment Modalities:" value={order.paymentTerms || '100%'} />
    </div>

    <section className="official-po-notice">
      <strong>Gentlemen:</strong>
      <p>Please furnish this office the following articles subject to the terms and conditions contained herein:</p>
    </section>

    <table className="official-table official-po-table">
      <colgroup>
        <col style={{ width: '9%' }} />
        <col style={{ width: '11%' }} />
        <col style={{ width: '10%' }} />
        <col style={{ width: '40%' }} />
        <col style={{ width: '14%' }} />
        <col style={{ width: '16%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>Item No.</th>
          <th>Quantity</th>
          <th>Unit</th>
          <th>Description</th>
          <th>Unit Price</th>
          <th>Total Price</th>
        </tr>
      </thead>
      <tbody>
        {(items.length ? items : [null]).map((item, index) => <tr key={item?.id ?? `line-${index}`}>
          <td className="official-center">{index + 1}</td>
          <td className="official-center">{item ? (item.quantity ?? '—') : ''}</td>
          <td>{item ? (item.unit || 'unit') : ''}</td>
          <td>
            {item ? <>
              <span className="official-strong">{item.itemName || '—'}</span>
              {item.description && <span className="official-subtext">{item.description}</span>}
            </> : null}
          </td>
          <td className="official-right">{item ? formatRwf(item.unitPrice) : ''}</td>
          <td className="official-right">{item ? formatRwf(item.lineTotal ?? (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)) : ''}</td>
        </tr>)}
      </tbody>
    </table>

    <div className="official-po-totals">
      <div><span className="official-label">Subtotal:</span><span className="official-value">{formatRwf(subtotal)}</span></div>
      <div><span className="official-label">VAT ({vatRate}%):</span><span className="official-value">{formatRwf(vatAmount)}</span></div>
      <div><span className="official-label">Total Amount:</span><span className="official-value official-strong">{formatRwf(total)}</span></div>
      <div className="official-po-words">
        <span className="official-label">Total Amount in Words: Rwandan Francs</span>
        <span className="official-value">{words}</span>
      </div>
    </div>

    <p className="official-po-terms">
      In case of failure to make the full delivery within the time specified and specification above.
    </p>

    <section className="official-po-approval">
      <p className="official-po-signoff">Sincerely Yours,</p>
      <div className="official-po-signature-grid">
        <SignatureLine label="Prepared By:" name={order.preparedBy} signature={order.preparedSignature} />
        <SignatureLine
          label="Approved By:"
          name={approved ? (order.approvedBy || '') : ''}
          date={approved && order.approvedAt ? dateLabel(order.approvedAt) : ''}
          signature={order.approvedSignature}
        />
      </div>
    </section>
  </OfficialSheet>;
}
