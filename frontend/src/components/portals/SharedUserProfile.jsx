import UserAvatar from '../ui/UserAvatar.jsx';
import { roleLabel } from '../../utils/access.js';

const tones = {
  supervisor: 'bg-white text-black',
  requester: 'bg-white text-black'
};

export default function SharedUserProfile({ user, portal = 'supervisor', className = '' }) {
  return <div className={`flex items-center gap-3 ${className}`}>
    <UserAvatar user={user} size="h-10 w-10" textSize="text-xs" className="border border-brand" fallbackClassName={tones[portal] || tones.supervisor} />
    <div className="min-w-0">
      <div className="truncate text-xs font-bold text-ink">{user?.name || 'User'}</div>
      <div className="mt-0.5 truncate text-[10px] text-muted">
        {roleLabel(user?.role)} · {user?.department || 'No department assigned'}
      </div>
    </div>
  </div>;
}
