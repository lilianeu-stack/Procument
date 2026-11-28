import Modal from '../ui/Modal.jsx';
import PortalProfile from './PortalProfile.jsx';

// Profile is an account form, so opening it from any portal shows a popup over
// the current workspace instead of replacing the page.
export default function PortalProfileModal({ user, summary, portal, onUpdated, onClose }) {
  return <Modal title="My profile" size="xl" onClose={onClose}>
    <PortalProfile
      user={user}
      summary={summary}
      portal={portal}
      onUpdated={onUpdated}
      inModal
    />
  </Modal>;
}
