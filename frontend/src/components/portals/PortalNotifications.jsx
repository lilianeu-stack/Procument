import NotificationsPage from '../../notifications/NotificationsPage.jsx';

// Supervisor, Requester and Administrator portals share the same notification
// center; only the portal label used by the back-to-dashboard action differs.
export default function PortalNotifications(props) {
  return <NotificationsPage {...props} />;
}
