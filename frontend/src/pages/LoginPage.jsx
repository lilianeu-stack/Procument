import { useState } from 'react';
import { ArrowRight, Boxes, Sparkles } from 'lucide-react';

function Brand({ light = false }) {
  return <div className="flex items-center gap-3">
    <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white"><Boxes size={20} /></div>
    <div className={`leading-tight ${light ? 'text-white' : 'text-ink'}`}>
      <div className="display-font text-[15px] font-extrabold tracking-tight">hope haven</div>
      <div className="mt-1 text-[9px] font-bold tracking-[.19em] text-slate-400">PROCUREMENT & STORES</div>
    </div>
  </div>;
}

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await onLogin(email, password); }
    catch (exception) { setError(exception.message); }
    finally { setBusy(false); }
  }

  return <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden bg-[#173b39] px-14 py-12 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
      <div className="absolute -right-36 -top-32 h-[440px] w-[440px] rounded-full border border-white/10" />
      <Brand light />
      <div className="relative max-w-lg pb-12">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs text-emerald-100"><Sparkles size={14} /> A better way to keep things moving</div>
        <h1 className="display-font text-5xl font-bold leading-[1.15] tracking-tight">Everything you need.<br /><span className="text-emerald-300">One clear process.</span></h1>
        <p className="mt-6 max-w-md text-[15px] leading-7 text-slate-300">Bring requests, approvals, suppliers and stock together — so your teams can focus on the work that matters.</p>
      </div>
      <p className="text-xs text-slate-400">Hope Haven Organization · Procurement & Inventory</p>
    </section>
    <section className="flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[410px]">
        <div className="mb-10 lg:hidden"><Brand /></div>
        <div className="mb-8"><p className="mb-2 text-sm font-semibold text-brand">Welcome back</p><h2 className="display-font text-3xl font-extrabold tracking-tight">Sign in to your account</h2><p className="mt-2 text-sm text-muted">Enter your details to access your workspace.</p></div>
        <form onSubmit={submit} className="space-y-5">
          <label className="block text-sm font-semibold">Work email<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@hopehaven.org" className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" /></label>
          <label className="block text-sm font-semibold">Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" className="mt-2 h-12 w-full rounded-lg border border-slate-200 px-4 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10" /></label>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button>
        </form>
        <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-muted"><span className="font-bold text-ink">Getting started?</span> Configure MySQL and create your first administrator with the setup steps in README.md.</div>
        <p className="mt-8 text-center text-xs text-slate-400">Secure access · Your activity may be logged</p>
      </div>
    </section>
  </main>;
}
