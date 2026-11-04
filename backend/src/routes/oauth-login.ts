// The OAuth provider's login page, shared by every trusted client. The only thing
// that depends on which client sent the user here is its display name, looked up
// from the trusted-client list by the query's client_id so an unknown id can't put
// arbitrary text on the page. The provider only redirects here when there's no
// session, so the page is one button.
//
// It hands the provider's signed authorization query back as `oauth_query` on
// sign-in. The provider keeps it in the Google OAuth state, and once the callback
// sets the session it re-runs authorize itself and redirects straight to the
// client with a code; callbackURL is only the fallback if that doesn't happen.
// Only the signed parameters are sent (the subset ba_param names, plus the
// signature), matching what the provider's own client plugin does.

import { trustedOAuthClients } from '../config.js';

const loginHtml = (lede: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign in to Thoughtful</title>
  <style>
    body{font:16px/1.5 system-ui,sans-serif;max-width:620px;margin:3rem auto;padding:0 1.5rem;color:#172033}
    h1{font-size:1.5rem}button{font:inherit;padding:.65rem 1rem;border:1px solid #3157d5;border-radius:7px;cursor:pointer;background:#3157d5;color:white}
    .error{color:#b42318}
  </style>
</head>
<body>
  <h1>Sign in to Thoughtful</h1>
  <main id="app">
    <p>${lede}</p>
    <button id="sign-in">Sign in with Google</button>
  </main>
  <script>
    const app=document.getElementById('app');
    const button=document.getElementById('sign-in');
    function showError(error){const p=document.createElement('p');p.className='error';p.textContent=String(error);app.append(p)}
    function signedQuery(){const params=new URLSearchParams(location.search);const signed=new Set(params.getAll('ba_param'));const out=new URLSearchParams();for(const [key,value] of params)if(key==='sig'||key==='ba_param'||signed.has(key))out.append(key,value);return out.toString()}
    button.onclick=async()=>{
      button.disabled=true;
      try{
        const response=await fetch('/api/auth/sign-in/social',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google',callbackURL:location.href,errorCallbackURL:location.href,oauth_query:signedQuery()})});
        const result=await response.json().catch(()=>({}));
        if(!response.ok||!result.url)throw new Error(result.message||result.error_description||result.error||'Sign-in did not return a redirect URL.');
        location.href=result.url;
      }catch(error){button.disabled=false;showError(error)}
    };
  </script>
</body>
</html>`;

const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export function oauthLoginHandler(c: import('hono').Context): Response {
	const clientId = c.req.query('client_id');
	const client = trustedOAuthClients().find((entry) => entry.clientId === clientId);
	const lede = client
		? `<strong>${escapeHtml(client.name)}</strong> wants to use Thoughtful's AI on your behalf. Sign in to connect it.`
		: 'Sign in to let the app you came from use Thoughtful on your behalf.';
	return c.html(loginHtml(lede));
}
