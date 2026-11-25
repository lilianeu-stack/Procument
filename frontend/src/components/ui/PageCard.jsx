export default function PageCard({ title, description, action, children, surface = 'white', className = '', professional = false }) {
  // The Overview dashboard uses the `card` surface for its subtle shadow while
  // keeping the card itself pure white like every other panel.
  const surfaceClass = surface === 'card' ? 'bg-white shadow-dashboard' : 'bg-white';
  return <section className={`overflow-hidden rounded-2xl border border-brand ${surfaceClass} ${className}`}>
    <header className={`flex flex-wrap items-center justify-between gap-3 border-b border-subtle px-5 ${professional ? 'py-5 sm:px-6' : 'py-4'}`}>
      <div>
        <h2 className={professional ? 'display-font text-base font-extrabold tracking-tight' : 'text-sm font-bold'}>{title}</h2>
        {description && <p className="mt-1 text-xs text-muted">{description}</p>}
      </div>
      {action}
    </header>
    {children}
  </section>;
}

export function EmptyState({ children }) {
  return <div className="grid min-h-40 place-items-center px-5 text-center text-sm text-muted">{children}</div>;
}

export function ErrorMessage({ children }) {
  return children ? <p role="alert" className="rounded-lg bg-white px-3 py-2 text-xs text-black">{children}</p> : null;
}

export function FormActions({ busy, close, label, busyLabel }) {
  return <div className="flex justify-end gap-2 border-t border-subtle pt-4">
    <button type="button" onClick={close} className="rounded-lg border border-brand px-4 py-2 text-xs font-bold transition-colors hover:bg-accent-tint hover:border-accent-border hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">Cancel</button>
    <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black transition-colors hover:bg-accent-tint hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus disabled:opacity-60">
      {busy ? (busyLabel || 'Saving…') : label}
    </button>
  </div>;
}
