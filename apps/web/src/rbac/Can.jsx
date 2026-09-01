import { useCan } from './usePermissions';

export default function Can({ feature, action = 'read', fallback = null, children }) {
  const allowed = useCan(feature, action);
  if (typeof children === 'function') return children(allowed);
  return allowed ? children : fallback;
}
