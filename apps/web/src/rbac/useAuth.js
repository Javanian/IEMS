import { normalizeRole } from './permissionMatrix';

export function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

export function getRole() {
  return normalizeRole(readAuthUser()?.roles);
}

export function readAuthPermissions() {
  try {
    return JSON.parse(sessionStorage.getItem('authPermissions') || 'null');
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return sessionStorage.getItem('isVerified') === 'true';
}

export function authHeaders() {
  const user = readAuthUser();
  if (!user) return {};
  return {
    'x-user-id': user.id != null ? String(user.id) : '',
    'x-user-name': user.name || user.username || '',
    'x-user-role': user.roles || user.role || '',
  };
}

export function useAuth() {
  const user = readAuthUser();
  return {
    user,
    role: normalizeRole(user?.roles),
    isAuthenticated: isAuthenticated(),
  };
}
