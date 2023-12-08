import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

function Posts() {
  const { getAccessTokenSilently } = useAuth0();
  const [posts, setPosts] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessTokenSilently({

        });
        const response = await fetch('https://tools.kenarnold.org/api/posts', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        setPosts(await response.json());
      } 
      catch (e) {
        console.error(e);
      }
    })();
  }, [getAccessTokenSilently]);

  if (!posts) {
    return <div>Loading...</div>;
  } 

  return (
    <ul>
      { posts.map((post, index) => {
        return <li key={ index }>{ post }</li>;
      }) }
    </ul>
  );
}

export default Posts;
