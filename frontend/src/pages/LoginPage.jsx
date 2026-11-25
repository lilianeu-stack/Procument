import { useState } from 'react';
import {
  ArrowRight, BarChart3, Boxes, Check, Eye, EyeOff, FileText, LockKeyhole, Mail,
  PackageCheck, ShoppingCart, Truck
} from 'lucide-react';
import BrandLogo from '../components/ui/BrandLogo.jsx';
import './LoginPage.css';

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await onLogin(email, password); }
    catch (exception) { setError(exception.message || 'Sign in failed. Please try again.'); }
    finally { setBusy(false); }
  }

  return <main className="login-shell">
    <section className="login-visual" aria-label="Procurement workspace">
      <div className="login-visual-heading">
        <p className="login-eyebrow"><span />HOPE HAVEN · PROCUREMENT &amp; STORES</p>
        <h1 className="display-font">Move every request forward.</h1>
        <p className="login-visual-description">
          A clearer way to coordinate purchasing, suppliers and inventory — all in one secure workspace.
        </p>
      </div>

      <div className="login-illustration" aria-hidden="true">
        <div className="login-orbit login-orbit-one" />
        <div className="login-orbit login-orbit-two" />

        <div className="login-flow-card">
          <div className="login-flow-heading">
            <span className="login-icon-frame"><FileText size={22} /></span>
            <span><small>PROCUREMENT FLOW</small><strong>Purchase request</strong></span>
          </div>
          <div className="login-flow-connector" />
          <div className="login-flow-heading">
            <span className="login-icon-frame"><PackageCheck size={22} /></span>
            <span><small>ORDER PREPARATION</small><strong>Items &amp; delivery details</strong></span>
          </div>
          <div className="login-activity">
            <span className="login-activity-copy">
              <BarChart3 size={18} />
              <span><small>PROCUREMENT ACTIVITY</small><strong>Requests to delivery</strong></span>
            </span>
            <span className="login-activity-bars"><i /><i /><i /><i /><i /></span>
          </div>
          <div className="login-flow-status"><span />Ready for review</div>
        </div>

        <div className="login-float login-float-inventory">
          <span className="login-float-icon"><Boxes size={21} /></span>
          <span><strong>Inventory</strong><small>Stock visibility</small></span>
        </div>
        <div className="login-float login-float-order">
          <span className="login-float-icon"><ShoppingCart size={21} /></span>
          <span><strong>Purchase orders</strong><small>Order tracking</small></span>
        </div>
        <div className="login-float login-float-suppliers">
          <span className="login-float-icon"><Truck size={21} /></span>
          <span><strong>Suppliers</strong><small>Quotation tracking</small></span>
          <Check className="login-float-check" size={14} />
        </div>
      </div>

      <p className="login-visual-footer"><LockKeyhole size={14} /> Procurement, purchasing and stock — connected.</p>
    </section>

    <section className="login-panel" aria-label="Sign in">
      <div className="login-form-wrap">
        <div className="login-brand"><BrandLogo variant="login" /></div>
        <div className="login-intro">
          <p className="login-welcome">Welcome back</p>
          <h2 className="display-font">Sign in to your account</h2>
          <p>Use your registered work email and password to continue to your portal.</p>
        </div>

        <form onSubmit={submit} className="login-form" aria-busy={busy}>
          <label className="login-label" htmlFor="login-email">Work email</label>
          <div className="login-input-wrap">
            <Mail className="login-input-icon" size={17} aria-hidden="true" />
            <input
              id="login-email"
              name="email"
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@hopehaven.org"
              className="login-input"
            />
          </div>

          <label className="login-label login-password-label" htmlFor="login-password">Password</label>
          <div className="login-input-wrap">
            <LockKeyhole className="login-input-icon" size={17} aria-hidden="true" />
            <input
              id="login-password"
              name="password"
              required
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              className="login-input login-password-input"
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              aria-controls="login-password"
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>

          {error && <p id="login-error" role="alert" className="login-error">{error}</p>}

          <button type="submit" disabled={busy} className="login-submit">
            {busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={17} aria-hidden="true" />
          </button>
        </form>

        <p className="login-security-note"><LockKeyhole size={14} />Secure access · Your activity may be logged</p>
      </div>
    </section>
  </main>;
}
