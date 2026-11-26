import { Bell, Menu } from 'lucide-react';
import { dateLabel } from '../../utils/format.js';
import AccountMenu from '../ui/AccountMenu.jsx';

export default function Topbar({ page, user, notifications, onToggle, onNotification, onMenu, onLogout, onProfile, open }) {
  return <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-subtle bg-white px-5 backdrop-blur sm:px-8">
    <div className="flex items-center gap-3">
      <button className="text-black lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="hidden items-center gap-2 text-[11px] text-black sm:flex">
        <span className="font-bold text-black">{page}</span>
      </div>
      <span className="font-bold sm:hidden">{page}</span>
    </div>
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-2 rounded-lg bg-white px-3 py-2 text-[10px] font-semibold text-black sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-success" />All systems normal</div>
      <div className="relative">
        <button aria-label="Notifications" onClick={onToggle} className="relative grid h-9 w-9 place-items-center rounded-lg text-black transition-colors hover:bg-accent-tint hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus">
          <Bell size={17} />{notifications.some((notice) => !notice.isRead) && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-reference ring-2 ring-white" />}
        </button>
        {open && <div className="absolute right-0 top-11 z-50 w-[320px] rounded-xl border border-strong bg-white p-3">
          <div className="mb-2 flex items-center justify-between px-1"><span className="text-xs font-bold">Notifications</span><span className="text-[10px] text-black">{notifications.filter((notice) => !notice.isRead).length} unread</span></div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length ? notifications.map((notice) => <button key={notice.id} onClick={() => onNotification(notice)} className={`mb-1 block w-full rounded-lg p-2 text-left transition-colors hover:bg-accent-tint hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus ${notice.isRead ? '' : 'bg-white'}`}>
              <span className="block text-xs font-bold">{notice.title}</span><span className="mt-1 block text-[11px] leading-4 text-black">{notice.body}</span><span className="mt-1 block text-[9px] text-black">{dateLabel(notice.createdAt)}</span>
            </button>) : <p className="py-8 text-center text-xs text-black">You’re all caught up.</p>}
          </div>
        </div>}
      </div>
      <div className="hidden h-7 w-px bg-white sm:block" />
      <AccountMenu user={user} onProfile={onProfile} onLogout={onLogout} />
    </div>
  </header>;
}
