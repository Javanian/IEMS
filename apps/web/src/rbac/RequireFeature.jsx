import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { usePermissions } from './usePermissions';
import NoAccessPage from './NoAccessPage';

export default function RequireFeature({ feature, children }) {
  const { isAuthenticated } = useAuth();
  const { canRead } = usePermissions();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  if (!canRead(feature)) {
    return <NoAccessPage feature={feature} />;
  }
  return children;
}
