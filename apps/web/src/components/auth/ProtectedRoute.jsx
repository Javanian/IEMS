import { Navigate } from 'react-router-dom';

export default function ProtectedRoute({ children }) {
  const isVerified = sessionStorage.getItem('isVerified');

  if (isVerified !== 'true') {
    return <Navigate to="/" replace />;
  }

  return children;
}
