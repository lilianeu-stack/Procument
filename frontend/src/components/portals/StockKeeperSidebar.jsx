import { Bell, ClipboardList, LayoutDashboard, PackageSearch, UserRound } from 'lucide-react';
import PortalSidebarFrame from './PortalSidebarFrame.jsx';
import { STOCKKEEPER_PAGES } from '../../utils/access.js';

const icons = {
  Dashboard: LayoutDashboard,
  'List of Requesters': ClipboardList,
  Notification: Bell,
  'Bin Card': PackageSearch,
  Profile: UserRound
};
const groups = [
  { section: 'STOCK WORKSPACE', links: STOCKKEEPER_PAGES.map((name) => ({ name, icon: icons[name] })) }
];

const accent = {
  aside: 'bg-[#123d3a] text-white',
  active: 'bg-emerald-400/15 text-white',
  hover: 'hover:bg-white/5 hover:text-emerald-50',
  mutedText: 'text-emerald-100/60',
  sectionText: 'text-emerald-300/60',
  statusText: 'text-emerald-200',
  profile: 'bg-emerald-200 text-[#123d3a]',
  badge: 'bg-emerald-400/15 text-emerald-100',
  dot: 'bg-emerald-400'
};

export default function StockKeeperSidebar(props) {
  return <PortalSidebarFrame {...props} accent={accent} portalLabel="Stock Keeper Portal" groups={groups} />;
}
