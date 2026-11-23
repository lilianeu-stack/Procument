import {
  Bell, ClipboardList, History, LayoutDashboard, MessageSquare, UserRound
} from 'lucide-react';
import PortalSidebarFrame from './PortalSidebarFrame.jsx';

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
    { name: 'My Profile', icon: UserRound }
  ] }
];

const accent = {
  aside: 'bg-[#223b66] text-white',
  active: 'bg-indigo-400/15 text-white',
  hover: 'hover:bg-white/5 hover:text-indigo-50',
  mutedText: 'text-indigo-100/60',
  sectionText: 'text-indigo-300/60',
  statusText: 'text-indigo-200',
  profile: 'bg-indigo-200 text-[#223b66]',
  badge: 'bg-indigo-400/15 text-indigo-100',
  dot: 'bg-indigo-400'
};

export default function RequesterSidebar(props) {
  return <PortalSidebarFrame {...props} accent={accent} portalLabel="Requester Portal" groups={groups} />;
}
