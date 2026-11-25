import { useCallback, useEffect, useState } from 'react';
import { Mail, MessageSquare, Phone } from 'lucide-react';
import PageCard from '../ui/PageCard.jsx';
import {
  EmptyState, ErrorState, LoadingState, SearchField, TableScroll, secondaryButtonClass
} from './PortalUi.jsx';
import { dateLabel } from '../../utils/format.js';

export default function SupervisorRequesters({ portalApi, navigate }) {
  const [search, setSearch] = useState('');
  const [requesters, setRequesters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await portalApi.getRequesters();
      setRequesters(response.requesters || []);
    } catch (exception) {
      setError(exception.message || 'Requesters could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [portalApi]);

  useEffect(() => { load(); }, [load]);

  const filtered = requesters.filter((requester) =>
    `${requester.name} ${requester.email}`.toLowerCase().includes(search.toLowerCase()));

  return <PageCard title="Requesters in your Department" description="Active Requesters and their request activity."
    action={<button type="button" onClick={() => navigate('Department Messages')} className={secondaryButtonClass()}>
      <MessageSquare size={13} />Open messages
    </button>}>
    <div className="border-b border-subtle bg-white px-4 py-4 sm:px-5">
      <SearchField value={search} onChange={setSearch} placeholder="Name or email…" className="w-full sm:w-72" />
    </div>
    <ErrorState message={error} onRetry={load} />
    {loading ? <LoadingState label="Loading Requesters…" /> : !filtered.length ?
      <EmptyState title="No Requesters found" description="Try another search, or ask an Administrator to assign Requesters to your Department." /> :
      <TableScroll minWidth={760}>
        <table className="w-full text-left text-xs">
          <thead className="bg-white text-[10px] uppercase text-muted">
            <tr>{['Name', 'Email', 'Phone', 'Requests', 'Joined', 'Actions'].map((heading) =>
              <th key={heading} className="whitespace-nowrap px-4 py-3 font-bold">{heading}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {filtered.map((requester) => <tr key={requester.id} className="hover:bg-white">
              <td className="whitespace-nowrap px-4 py-3 font-bold">{requester.name}</td>
              <td className="whitespace-nowrap px-4 py-3"><span className="inline-flex items-center gap-1.5"><Mail size={12} className="text-muted" />{requester.email}</span></td>
              <td className="whitespace-nowrap px-4 py-3"><span className="inline-flex items-center gap-1.5"><Phone size={12} className="text-muted" />{requester.phone || '—'}</span></td>
              <td className="whitespace-nowrap px-4 py-3 font-bold">{requester.requestCount ?? 0}</td>
              <td className="whitespace-nowrap px-4 py-3">{dateLabel(requester.createdAt)}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <button type="button" onClick={() => navigate('Department Messages', { userId: requester.id })} className={secondaryButtonClass('px-2.5 py-1.5')}>
                  <MessageSquare size={13} />Message
                </button>
              </td>
            </tr>)}
          </tbody>
        </table>
      </TableScroll>}
  </PageCard>;
}
