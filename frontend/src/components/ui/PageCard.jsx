export default function PageCard({ title, description, action, children }) {
  return <section className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-card">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div>
        <h2 className="text-sm font-bold">{title}</h2>
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
  return children ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{children}</p> : null;
}

export function FormActions({ busy, close, label }) {
  return <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
    <button type="button" onClick={close} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold">Cancel</button>
    <button disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-white disabled:opacity-60">
      {busy ? 'Saving…' : label}
    </button>
  </div>;
}
