export default function PrintHeader({ title, reference, dates = '' }) {
  return <div className="print-only print-header">
    <img src="/procurement-logo.png" alt="" />
    <div className="min-w-0 flex-1">
      <strong>Hope Haven</strong>
      <span>Procurement Management System — PROCUREMENT &amp; STORES</span>
    </div>
    <div className="text-right">
      {reference && <strong className="!text-[11pt]">{reference}</strong>}
      {title && <span>{title}</span>}
      {dates && <span>{dates}</span>}
    </div>
  </div>;
}
