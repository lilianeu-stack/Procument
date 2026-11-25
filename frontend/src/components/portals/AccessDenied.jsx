import { ArrowRight, ShieldAlert } from 'lucide-react';

export default function AccessDenied({ attemptedPortal, attemptedPage, correctPortal, correctPage, onContinue, onLogout, invalidRole }) {
  return <main className="grid min-h-screen place-items-center bg-canvas px-5 py-10">
    <div className="w-full max-w-lg rounded-2xl border border-brand bg-white p-8 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-black"><ShieldAlert size={26} /></span>
      <h1 className="display-font mt-5 text-2xl font-extrabold tracking-tight">Portal access restricted</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        {invalidRole
          ? 'Your account does not have a valid role or Department assignment. Contact an administrator to correct your access.'
          : `Your role only grants access to the ${correctPortal} portal. The requested ${attemptedPortal || 'unknown'} area is not available to you.`}
      </p>
      {(attemptedPortal || attemptedPage) && <div className="mt-5 rounded-lg bg-white p-3 text-left text-xs">
        <div className="flex justify-between gap-3"><span className="text-muted">Requested portal</span><span className="font-bold capitalize">{attemptedPortal || '—'}</span></div>
        <div className="mt-2 flex justify-between gap-3"><span className="text-muted">Requested page</span><span className="font-bold text-right">{attemptedPage || '—'}</span></div>
      </div>}
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        {!invalidRole && <button onClick={onContinue} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-xs font-bold text-black hover:bg-brand-dark">
          Go to {correctPage} <ArrowRight size={14} />
        </button>}
        <button onClick={onLogout} className="rounded-lg border border-brand px-4 py-2.5 text-xs font-bold hover:bg-white">Sign out</button>
      </div>
    </div>
  </main>;
}
