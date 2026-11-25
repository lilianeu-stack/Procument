import {
  Bell, Boxes, Building2, ClipboardList, LayoutDashboard,
  MessageSquare, UserRound, UsersRound
} from 'lucide-react';
import PortalSidebarFrame from './PortalSidebarFrame.jsx';
import { SUPERVISOR_PAGES } from '../../utils/access.js';

const groups = [
  { section: 'SUPERVISOR WORKSPACE', links: [
    { name: SUPERVISOR_PAGES[0], icon: LayoutDashboard },
    { name: SUPERVISOR_PAGES[2], icon: Building2 },
    { name: SUPERVISOR_PAGES[3], icon: UsersRound }
  ] },
  { section: 'PROCUREMENT', links: [
    { name: SUPERVISOR_PAGES[4], icon: ClipboardList },
    { name: SUPERVISOR_PAGES[6], icon: Boxes }
  ] },
  { section: 'COMMUNICATION', links: [
    { name: SUPERVISOR_PAGES[7], icon: MessageSquare },
    { name: SUPERVISOR_PAGES[8], icon: Bell }
  ] },
  { section: 'ACCOUNT', links: [
    { name: SUPERVISOR_PAGES[9], icon: UserRound }
  ] }
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

export default function SupervisorSidebar(props) {
  return <PortalSidebarFrame {...props} accent={accent} portalLabel="Supervisor Portal" groups={groups} />;
}
