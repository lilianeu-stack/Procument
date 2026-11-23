import PortalLayout from './PortalLayout.jsx';
import StockKeeperSidebar from './StockKeeperSidebar.jsx';

export default function StockKeeperLayout(props) {
  return <PortalLayout {...props} portal="stockkeeper" sidebar={StockKeeperSidebar} />;
}
