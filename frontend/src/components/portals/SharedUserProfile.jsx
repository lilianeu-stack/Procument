import { roleLabel } from '../../utils/access.js';

const tones = {
  supervisor: 'bg-white text-black',
  requester: 'bg-white text-black'
};

export default function SharedUserProfile({ user, portal = 'supervisor', className = '' }) {
  return <div className={`flex items-center gap-3 ${className}`}>
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-extrabold ${tones[portal] || tones.supervisor}`}>
      {user?.initials || 'HH'}
    </span>
    <div className="min-w-0">
      <div className="truncate text-xs font-bold text-ink">{user?.name || 'User'}</div>
      <div className="mt-0.5 truncate text-[10px] text-muted">
        {roleLabel(user?.role)} · {user?.department || 'No department assigned'}
      </div>
    </div>
  </div>;
}
