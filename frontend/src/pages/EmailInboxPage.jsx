import { useEffect, useState } from 'react';
import { Link2, LoaderCircle, Mail, MailOpen, RefreshCw, Send, Unplug } from 'lucide-react';
import Modal from '../components/ui/Modal.jsx';

function displayDate(value) {
  if (!value) return 'Date unavailable';
  const parsedValue = value instanceof Date
    ? value
    : typeof value === 'string' && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
  const date = new Date(parsedValue);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

export default function EmailInboxPage({ actions, query = {} }) {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(
    query.google === 'connected' ? 'Google mailbox connected successfully.' :
      query.google === 'error' ? 'Google authorization was not completed.' : ''
  );
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ to: '', subject: '', text: '' });

  async function loadInbox() {
    setLoading(true);
    setError('');
    try {
      const currentStatus = await actions.getEmailStatus();
      setStatus(currentStatus);
      if (!currentStatus.connected) {
        setMessages([]);
        setSelected(null);
        return;
      }
      const result = await actions.getInboxMessages();
      setMessages(result.messages || []);
    } catch (exception) {
      setError(exception.message || 'Email inbox could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadInbox(); }, []);

  async function connect() {
    setBusy('connect');
    setError('');
    try {
      const result = await actions.getEmailConnectUrl();
      window.location.assign(result.authorizationUrl);
    } catch (exception) {
      setError(exception.message || 'Google authorization could not be started.');
      setBusy('');
    }
  }

  async function sync() {
    setBusy('sync');
    setError('');
    setNotice('');
    try {
      const result = await actions.syncInbox();
      const linked = result.commentsReceived
        ? ` ${result.commentsReceived} recipient comment${result.commentsReceived === 1 ? '' : 's'} linked to requests.`
        : '';
      setNotice(`Inbox sync complete. ${result.synced} recent message(s) checked.${linked}`);
      await loadInbox();
    } catch (exception) {
      setError(exception.message || 'Inbox sync failed.');
    } finally {
      setBusy('');
    }
  }

  async function openMessage(message) {
    setError('');
    setSelected({ ...message, loading: true });
    try {
      const result = await actions.getInboxMessage(message.id);
      setSelected(result.message);
    } catch (exception) {
      setError(exception.message || 'The email could not be opened.');
      setSelected(null);
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this Google mailbox and remove its synced messages from the app?')) return;
    setBusy('disconnect');
    setError('');
    setNotice('');
    try {
      const result = await actions.disconnectGoogleEmail();
      setNotice(result.message);
      await loadInbox();
    } catch (exception) {
      setError(exception.message || 'Google mailbox could not be disconnected.');
    } finally {
      setBusy('');
    }
  }

  async function send(event) {
    event.preventDefault();
    setBusy('send');
    setError('');
    setNotice('');
    try {
      const result = await actions.sendEmail(draft);
      setNotice(result.message);
      setDraft({ to: '', subject: '', text: '' });
      setComposing(false);
    } catch (exception) {
      setError(exception.message || 'Email could not be sent.');
    } finally {
      setBusy('');
    }
  }

  return <div className="space-y-4">
    {error && <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs text-emerald-700">{notice}</div>}

    <section className="rounded-xl border border-slate-100 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="display-font text-lg font-extrabold">Email</h2>
          <p className="mt-1 text-xs text-muted">
            {status?.connected
              ? `Connected to ${status.connectedMailbox}${status.connectedAt ? ` · since ${displayDate(status.connectedAt)}` : ''}`
              : 'Connect the procurement Google mailbox to sync incoming messages.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(status?.smtpConfigured || status?.googleSendEnabled) && <button type="button" onClick={() => setComposing(true)} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black">
            <Send size={14} />Compose
          </button>}
          {status?.connected
            ? <>
                <button type="button" onClick={sync} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">
                  {busy === 'sync' ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}Sync inbox
                </button>
                <button type="button" onClick={disconnect} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">
                  <Unplug size={14} />Disconnect
                </button>
              </>
            : <button type="button" onClick={connect} disabled={Boolean(busy) || !status?.configured} className="inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
                {busy === 'connect' ? <LoaderCircle size={14} className="animate-spin" /> : <Link2 size={14} />}Connect Google mailbox
              </button>}
        </div>
      </div>
      {!status?.connected && status?.missing?.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Configure these backend variables before connecting: {status.missing.join(', ')}.
      </p>}
      {status?.connectionMismatch && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        The saved Google connection belongs to a different mailbox. Reconnect using the configured mailbox to sync it.
      </p>}
      {status?.connected && !status.smtpConfigured && !status.googleSendEnabled && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Incoming mail is connected. Grant Gmail send access or configure SMTP to enable email composition.
      </p>}
    </section>

    {composing && <Modal title="New email" onClose={() => setComposing(false)}>
      <form onSubmit={send} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs font-bold">To<input required type="email" maxLength="190" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} className="field" /></label>
          <label className="block text-xs font-bold">Subject<input required maxLength="200" value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} className="field" /></label>
        </div>
        <label className="block text-xs font-bold">Message<textarea required maxLength="50000" rows="6" value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} className="field h-auto py-2" /></label>
        <div className="flex justify-end"><button type="submit" disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black disabled:opacity-50">
          {busy === 'send' ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}Send email
        </button></div>
      </form>
    </Modal>}

    {status?.connected && <div className="grid min-h-[420px] gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
      <section className="overflow-hidden rounded-xl border border-slate-100 bg-white">
        <div className="border-b border-slate-100 px-4 py-3 text-xs font-bold">Recent inbox messages</div>
        {loading ? <div role="status" className="p-5 text-xs text-muted">Loading inbox…</div>
          : messages.length ? <div className="max-h-[560px] overflow-y-auto divide-y divide-slate-100">
              {messages.map((message) => <button key={message.id} type="button" onClick={() => openMessage(message)}
                className={`w-full px-4 py-3 text-left hover:bg-slate-50 ${selected?.id === message.id ? 'bg-brand-light/50' : ''}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-xs ${message.unread ? 'font-extrabold text-ink' : 'font-semibold text-slate-600'}`}>{message.sender || '(unknown sender)'}</span>
                  {message.unread ? <Mail size={13} className="shrink-0 text-brand" /> : <MailOpen size={13} className="shrink-0 text-muted" />}
                </span>
                <span className="mt-1 block truncate text-xs font-bold">{message.subject}</span>
                {message.requisitionReference && <span className="mt-1 inline-block rounded bg-brand-light px-2 py-0.5 text-[10px] font-bold text-brand">
                  Comment · {message.requisitionReference}
                </span>}
                <span className="mt-1 block line-clamp-2 text-[11px] text-muted">{message.snippet}</span>
                <span className="mt-2 block text-[10px] text-muted">{displayDate(message.receivedAt)}</span>
              </button>)}
            </div>
          : <div className="p-5 text-xs text-muted">No synced messages yet. Choose “Sync inbox” to fetch recent mail.</div>}
      </section>

      <section className="min-w-0 rounded-xl border border-slate-100 bg-white p-5">
        {selected ? selected.loading ? <div className="text-xs text-muted">Loading message…</div> : <>
          <h3 className="break-words text-base font-extrabold">{selected.subject}</h3>
          <dl className="mt-3 space-y-1 border-b border-slate-100 pb-4 text-xs">
            <div><dt className="inline text-muted">From: </dt><dd className="inline break-all">{selected.sender}</dd></div>
            <div><dt className="inline text-muted">To: </dt><dd className="inline break-all">{selected.recipient}</dd></div>
            <div><dt className="inline text-muted">Received: </dt><dd className="inline">{displayDate(selected.receivedAt)}</dd></div>
          </dl>
          {selected.comment && <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
            <div className="text-[11px] font-extrabold text-emerald-800">
              Recipient comment linked to {selected.requisitionReference || 'a request'}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-emerald-900">{selected.comment}</p>
          </div>}
          <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-700">{selected.body || selected.snippet || '(No plain-text message body.)'}</pre>
        </> : <div className="grid h-full min-h-64 place-items-center text-center text-xs text-muted">Select an email to read it here.</div>}
      </section>
    </div>}
  </div>;
}
