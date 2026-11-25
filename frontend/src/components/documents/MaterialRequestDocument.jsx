import { createPortal } from 'react-dom';
import { dateLabel } from '../../utils/format.js';

// The sheet is rendered normally inside the modal for on-screen viewing and a
// second print-only copy is portalled to <body>. Print CSS hides everything
// except .official-print-root, so A4 output contains only the official form.
function OfficialSheet({ children, label }) {
  const sheet = () => <article className="official-document material-request-document" aria-label={label}>
    {children}
  </article>;
  return <>
    {sheet()}
    {typeof document !== 'undefined'
      ? createPortal(<div className="official-print-root">{sheet()}</div>, document.body)
      : null}
  </>;
}

export default function MaterialRequestDocument({ requisition = {} }) {
  const items = Array.isArray(requisition.items) ? requisition.items : [];
  const approved = requisition.supervisorDecision === 'Approved' && Boolean(requisition.supervisorDecisionAt);
  const requester = requisition.requester || requisition.requesterName || requisition.requestedBy || '';
  const requestedAt = requisition.submittedAt || requisition.createdAt;
  const supervisor = requisition.supervisorName || requisition.approvedBy || '';
  const paddedItems = [
    ...items,
    ...Array.from({ length: Math.max(0, 8 - items.length) }, () => null)
  ];

  return <OfficialSheet label="Official material request form">
    <header className="official-header">
      <img src="/procurement-logo.png" alt="Hope Haven logo" className="official-logo" />
      <div className="official-header-text">
        <strong>HOPE HAVEN</strong>
        <span>PROCUREMENT &amp; STORES</span>
      </div>
      <div className="official-header-meta">
        <span>{requisition.reference || '—'}</span>
        <span>{requisition.status || 'Draft'}</span>
        <span>{dateLabel(requestedAt)}</span>
      </div>
    </header>

    <h1 className="official-title">MATERIAL REQUEST FORM</h1>

    <div className="official-details">
      <div className="official-field">
        <span className="official-label">Requesting Department:</span>
        <span className="official-value">{requisition.department || '—'}</span>
      </div>
      <div className="official-field">
        <span className="official-label">Location where the items are needed:</span>
        <span className="official-value">{requisition.location || '—'}</span>
      </div>
    </div>

    <table className="official-table">
      <colgroup>
        <col style={{ width: '9%' }} />
        <col style={{ width: '38%' }} />
        <col style={{ width: '12%' }} />
        <col style={{ width: '20%' }} />
        <col style={{ width: '21%' }} />
      </colgroup>
      <thead>
        <tr>
          <th>Item #</th>
          <th>Item Description</th>
          <th>Quantity</th>
          <th>Unity of Measures</th>
          <th>Remarks</th>
        </tr>
      </thead>
      <tbody>
        {paddedItems.map((item, index) => <tr key={item?.id ?? `line-${index}`} className={item ? '' : 'official-blank-row'}>
          <td className="official-center">{index + 1}</td>
          <td>
            {item ? <>
              <span className="official-strong">{item.itemName || '—'}</span>
              {item.description && <span className="official-subtext">{item.description}</span>}
            </> : null}
          </td>
          <td className="official-center">{item ? (item.quantity ?? '—') : ''}</td>
          <td>{item ? (item.unit || 'unit') : ''}</td>
          <td>{item?.remarks || ''}</td>
        </tr>)}
      </tbody>
    </table>

    <div className="official-purpose">
      <span className="official-label">Purposes the goods are requested for:</span>
      <p>{requisition.justification || ''}</p>
    </div>

    <div className="official-approval-grid">
      <div>
        <span className="official-label">Name(Requested by):</span>
        <span className="official-value">{requester || '—'}</span>
      </div>
      <div>
        <span className="official-label">Signature:</span>
        <span className="official-value official-signature-line">{requester ? 'Digitally submitted' : ''}</span>
      </div>
      <div>
        <span className="official-label">Date:</span>
        <span className="official-value">{requestedAt ? dateLabel(requestedAt) : ''}</span>
      </div>
      <div>
        <span className="official-label">Name(Approved by):</span>
        <span className="official-value">{approved ? (supervisor || '—') : ''}</span>
      </div>
      <div>
        <span className="official-label">Signature:</span>
        <span className="official-value official-signature-line">{approved ? 'Digitally approved' : ''}</span>
      </div>
      <div>
        <span className="official-label">Date:</span>
        <span className="official-value">{approved ? dateLabel(requisition.supervisorDecisionAt) : ''}</span>
      </div>
    </div>
  </OfficialSheet>;
}
