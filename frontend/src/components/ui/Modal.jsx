import { X } from 'lucide-react';

export default function Modal({ title, onClose, children }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
      <header className="mb-5 flex items-center justify-between">
        <h2 className="display-font text-lg font-extrabold">{title}</h2>
        <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
      </header>
      {children}
    </section>
  </div>;
}
