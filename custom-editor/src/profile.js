import { useAuth0 } from '@auth0/auth0-react';
import React, { useEffect } from 'react';

function Profile() {
  const { user, isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();

  if (isLoading) {
    return <div>Loading ...</div>;
  }

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessTokenSilently({
          authorizationParams: {
            audience: 'https://tools.kenarnold.org/api', // Value in Identifier field for the API being called.
            scope: 'read:posts', // Scope that exists for the API being called. You can create these through the Auth0 Management API or through the Auth0 Dashboard in the Permissions view of your API.
          }
        });
        const response = await fetch('http://localhost:8000/api/private', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        console.log(await response.json());
      } 
      catch (e) {
        console.error(e);
      }
    })();
  }, [getAccessTokenSilently]);
  return (
    isAuthenticated ? (
      <div>
        <img src={ user.picture } alt={ user.name } />
        <h2>{ user.name }</h2>
        <p>{ user.email }</p>
      </div>
    ) : null
  );
}

export default Profile;
