import { Component } from 'react';

// A render exception must never leave the administrator with a blank screen.
// The underlying bug is fixed separately; this boundary keeps any future data
// shape problem visible and recoverable.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Page render failed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" className="rounded-xl border border-brand bg-white p-6 text-sm text-black">
      <h2 className="text-base font-extrabold">This page could not be displayed.</h2>
      <p className="mt-2">The error was caught before the screen became blank. Retry the page, or sign out and sign in again.</p>
      <pre className="mt-3 max-h-32 overflow-auto rounded bg-white p-3 text-[11px] whitespace-pre-wrap">{String(this.state.error?.message || this.state.error)}</pre>
      <div className="mt-4 flex gap-2">
        <button onClick={() => { this.setState({ error: null }); this.props.onRetry?.(); }} className="rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black">Retry</button>
        {this.props.onLogout && <button onClick={this.props.onLogout} className="rounded-lg border border-brand px-3 py-2 text-xs font-bold">Sign out</button>}
      </div>
    </div>;
  }
}
