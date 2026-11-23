import PortalLayout from './PortalLayout.jsx';
import SupervisorSidebar from './SupervisorSidebar.jsx';

export default function SupervisorLayout(props) {
  return <PortalLayout {...props} portal="supervisor" sidebar={SupervisorSidebar} />;
}
