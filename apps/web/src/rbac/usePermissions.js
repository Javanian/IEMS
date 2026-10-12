import { useMemo } from 'react';
import { useAuth } from './useAuth';
import { resolveLevel, actionAllowed, canRead, canWrite } from './permissionMatrix';

export function usePermissions() {
  const { role } = useAuth();
  const permsRaw =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('authPermissions') : null;
  return useMemo(() => {
    let overrides = null;
    try {
      overrides = permsRaw ? JSON.parse(permsRaw) : null;
    } catch {
      overrides = null;
    }
    const levelOf = (feature) => (overrides && overrides[feature]) || resolveLevel(role, feature);
    return {
      role,
      levelOf,
      can: (feature, action = 'read') => actionAllowed(levelOf(feature), action),
      canRead: (feature) => canRead(levelOf(feature)),
      canWrite: (feature) => canWrite(levelOf(feature)),
    };
  }, [role, permsRaw]);
}

export function useCan(feature, action = 'read') {
  const { can } = usePermissions();
  return can(feature, action);
}
