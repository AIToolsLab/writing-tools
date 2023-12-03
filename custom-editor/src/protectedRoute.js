import { useAuth0 } from '@auth0/auth0-react';
import React from 'react';

function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth0();

  if (isLoading) {
    return <div>Loading ...</div>;
  }

  return (
    isAuthenticated ? children : <div>Please log in to access the custom editor.</div>
  );
}

export default ProtectedRoute;
