import { betterAuthOrigin } from '../config.js';

function loginHtml(resource: string): string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect Mindmap</title>
  <style>
    body{font:16px/1.5 system-ui,sans-serif;max-width:620px;margin:3rem auto;padding:0 1.5rem;color:#172033}
    h1{font-size:1.5rem}button{font:inherit;padding:.65rem 1rem;border:1px solid #3157d5;border-radius:7px;cursor:pointer;background:#3157d5;color:white}
    .muted{color:#657087}.error{color:#b42318}
  </style>
</head>
<body>
  <h1>Connect Mindmap</h1>
  <main id="app"><p class="muted">Checking your sign-in…</p></main>
  <script>
    const app=document.getElementById('app');
    function showError(error){const p=document.createElement('p');p.className='error';p.textContent=String(error);app.replaceChildren(p)}
    async function json(url,init){const response=await fetch(url,{credentials:'include',...init});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||body.detail||body.error_description||body.error||('Request failed ('+response.status+')'));return body}
    async function start(){
      const session=await json('/api/auth/get-session').catch(()=>null);
      if(session?.user){
        const authorize=new URL('/api/auth/oauth2/authorize',location.origin);
        authorize.search=location.search;
        // Provider 1.6.22 does not preserve RFC 8707 resource in its signed
        // login continuation query. Restore the already-validated server origin;
        // the signature explicitly ignores parameters outside ba_param.
        authorize.searchParams.set('resource',${JSON.stringify(resource)});
        location.replace(authorize);return
      }
      const explanation=document.createElement('p');explanation.textContent='Sign in to let Mindmap use Writing Tools AI on your behalf.';
      const button=document.createElement('button');button.textContent='Sign in with Google';
      button.onclick=async()=>{button.disabled=true;try{const callbackURL=location.href;const result=await json('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google',callbackURL,errorCallbackURL:callbackURL})});if(!result.url)throw new Error('Sign-in did not return a redirect URL.');location.href=result.url}catch(error){showError(error)}};
      app.replaceChildren(explanation,button);
    }
    start().catch(showError);
  </script>
</body>
</html>`;
}

export function oauthLoginHandler(c: import('hono').Context): Response {
	return c.html(loginHtml(betterAuthOrigin()));
}
