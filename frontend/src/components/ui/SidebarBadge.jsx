import { badgeLabel } from '../../services/sidebarCounts.js';

export default function SidebarBadge({ count, floating = false }) {
  const label = badgeLabel(count);
  if (!label) return null;

  return <span
    className={`pims-sidebar-badge inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full border border-brand bg-success px-1 text-[10px] font-bold leading-none text-black ${floating ? 'absolute right-1 top-1 lg:right-0.5 lg:top-0.5' : 'ml-auto'}`}
    aria-label={`${Number(count)} unread`}
    title={`${Number(count)} unread`}
  >
    {label}
  </span>;
}
