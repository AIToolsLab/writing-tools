import { useAuth0 } from '@auth0/auth0-react';
import React from 'react';

function LogoutButton() {
  const { logout, isAuthenticated } = useAuth0();

  return (
    isAuthenticated ? (
      <button onClick={ () => logout({ returnTo: window.location.origin }) }>
        Sign Out
      </button>
    ) : null
  );
}

export default LogoutButton;
