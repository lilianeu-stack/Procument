import { X } from 'lucide-react';

const SIZES = {
  sm: 'max-w-lg',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl'
};

export default function Modal({ title, onClose, children, size = 'sm', dismissible = true }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onMouseDown={(event) => dismissible && event.target === event.currentTarget && onClose()}>
    <section className={`portal-modal w-full ${SIZES[size] || SIZES.sm} max-h-[92vh] overflow-y-auto rounded-2xl border border-strong bg-white p-5  sm:p-6`}>
      <header className="mb-5 flex items-center justify-between">
        <h2 className="display-font text-lg font-extrabold">{title}</h2>
        {dismissible && <button onClick={onClose} className="rounded-lg p-2 text-black transition-colors hover:bg-accent-tint hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus" aria-label="Close"><X size={18} /></button>}
      </header>
      {children}
    </section>
  </div>;
}
