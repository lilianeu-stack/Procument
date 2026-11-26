import {
  Bell, ClipboardList, History, LayoutDashboard, MessageSquare, UserRound
} from 'lucide-react';
import PortalSidebarFrame from './PortalSidebarFrame.jsx';
import { PROFILE_PAGE } from '../../utils/access.js';

const groups = [
  { section: 'REQUESTER WORKSPACE', links: [
    { name: 'Requester Dashboard', icon: LayoutDashboard },
    { name: 'My Procurement Requests', icon: ClipboardList },
    { name: 'My Request History', icon: History }
  ] },
  { section: 'COMMUNICATION', links: [
    { name: 'Messages', icon: MessageSquare },
    { name: 'Notifications', icon: Bell }
  ] },
  { section: 'ACCOUNT', links: [
    { name: PROFILE_PAGE, icon: UserRound }
  ] }
];

const accent = {
  aside: 'bg-white text-black',
  active: 'bg-reference text-black shadow-sm',
  hover: 'hover:bg-hover hover:text-black',
  mutedText: 'text-black',
  sectionText: 'text-black'
};

export default function RequesterSidebar(props) {
  return <PortalSidebarFrame {...props} accent={accent} groups={groups} />;
}
