import { useAuth0 } from '@auth0/auth0-react';
import React from 'react';

function LoginButton() {
  const { loginWithRedirect, isAuthenticated } = useAuth0();

  return (
    isAuthenticated ? null : (
      <button onClick={ () => loginWithRedirect() }>
        Sign In
      </button>
    )
  );
}

export default LoginButton;
