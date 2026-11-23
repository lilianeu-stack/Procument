import PortalLayout from './PortalLayout.jsx';
import RequesterSidebar from './RequesterSidebar.jsx';

export default function RequesterLayout(props) {
  return <PortalLayout {...props} portal="requester" sidebar={RequesterSidebar} />;
}
