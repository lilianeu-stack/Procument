import NotificationsPage from '../../notifications/NotificationsPage.jsx';

// Stock Keeper keeps its own portal file for route clarity, but the notification
// behavior is identical to every other authenticated portal.
export default function StockKeeperNotifications(props) {
  return <NotificationsPage {...props} portal="stockkeeper" id="stock-notification-type" />;
}
