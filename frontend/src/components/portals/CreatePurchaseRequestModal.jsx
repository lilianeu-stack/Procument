import Modal from '../ui/Modal.jsx';
import CreatePurchaseRequest from './CreatePurchaseRequest.jsx';

// Requester forms open as a popup instead of replacing the requests workspace.
// Closing the popup returns the Requester to the same list they came from.
export default function CreatePurchaseRequestModal({ portalApi, query = {}, navigate, user = {} }) {
  const close = () => navigate('My Procurement Requests');
  const title = query.request ? 'Edit draft purchase request' : 'Create purchase request';

  return <Modal title={title} size="xl" onClose={close}>
    <CreatePurchaseRequest
      portalApi={portalApi}
      query={query}
      navigate={navigate}
      user={user}
      inModal
    />
  </Modal>;
}
