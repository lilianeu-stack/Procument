import {
  Bell, Boxes, Building2, ClipboardCheck, ClipboardList, LayoutDashboard,
  MessageSquare, UserRound, UsersRound
} from 'lucide-react';
import PortalSidebarFrame from './PortalSidebarFrame.jsx';
import { SUPERVISOR_PAGES } from '../../utils/access.js';

const groups = [
  { section: 'SUPERVISOR WORKSPACE', links: [
    { name: SUPERVISOR_PAGES[0], icon: LayoutDashboard },
    { name: SUPERVISOR_PAGES[2], icon: Building2 },
    { name: SUPERVISOR_PAGES[3], icon: UsersRound },
    { name: SUPERVISOR_PAGES[5], icon: ClipboardCheck }
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
  aside: 'bg-white text-black',
  active: 'bg-reference text-black shadow-sm',
  hover: 'hover:bg-hover hover:text-black',
  mutedText: 'text-black',
  sectionText: 'text-black'
};

export default function SupervisorSidebar(props) {
  return <PortalSidebarFrame {...props} accent={accent} groups={groups} />;
}
