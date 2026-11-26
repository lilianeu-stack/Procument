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
  aside: 'bg-white text-black',
  active: 'bg-reference text-black shadow-sm',
  hover: 'hover:bg-hover hover:text-black',
  mutedText: 'text-black',
  sectionText: 'text-black'
};

export default function StockKeeperSidebar(props) {
  return <PortalSidebarFrame {...props} accent={accent} groups={groups} />;
}
