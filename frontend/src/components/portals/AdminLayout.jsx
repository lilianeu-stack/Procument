import AppLayout from '../layout/AppLayout.jsx';

// The Administrator portal preserves the existing system-wide shell.
export default function AdminLayout(props) {
  return <AppLayout {...props} portalLabel="Administrator Portal" />;
}
