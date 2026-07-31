const PAGE_STYLE = `
body{font:16px/1.5 system-ui,sans-serif;max-width:620px;margin:3rem auto;padding:0 1.5rem;color:#172033}
h1{font-size:1.5rem}button{font:inherit;padding:.65rem 1rem;border:1px solid #aab2c0;border-radius:7px;cursor:pointer}
.primary{background:#3157d5;color:white;border-color:#3157d5}.muted{color:#657087}.error{color:#b42318}
.actions{display:flex;gap:.7rem;margin-top:1.5rem}`;

function shell(title: string, script: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${PAGE_STYLE}</style></head><body><h1>${title}</h1><main id="app"><p class="muted">Loading…</p></main><script>${script}</script></body></html>`;
}

const helpers = `
const app=document.getElementById('app');
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node}
function show(...nodes){app.replaceChildren(...nodes)}
async function json(url,init){const response=await fetch(url,{credentials:'include',...init});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.message||body.detail||body.error_description||body.error||('Request failed ('+response.status+')'));return body}
function oauthBody(extra){return JSON.stringify({...extra,oauth_query:location.search.slice(1)})}
function go(result){const url=result.url||result.redirect_uri;if(url)location.href=url;else throw new Error('Authorization server returned no redirect URL')}
`;

const LOGIN_HTML = shell(
	'Connect an app',
	`${helpers}
async function start(){
 const session=await json('/api/auth/get-session').catch(()=>null);
 if(session?.user){location.replace('/api/auth/oauth2/authorize'+location.search);return}
 const p=el('p','Sign in to authorize the Writing Tools room opened by this app.');
 const b=el('button','Sign in with Google','primary');
 b.onclick=async()=>{try{
  const callbackURL=location.href;
  const result=await json('/api/auth/sign-in/social',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'google',callbackURL,errorCallbackURL:callbackURL})});
  location.href=result.url;
 }catch(error){show(el('p',String(error),'error'))}};
 show(p,b);
}
start();`,
);

const ROOM_HTML = shell(
	'Authorize this room',
	`${helpers}
async function start(){
 try{
  const context=await json('/api/auth/oauth2/room-context',{method:'POST',headers:{'Content-Type':'application/json'},body:oauthBody({})});
  const intro=el('p',context.client.name+' ('+context.client.redirect_origin+') wants access to the room opened from Writing Tools:');
  const room=el('p',context.room.name+' ('+context.room.id+')','muted');
  const button=el('button','Continue','primary');button.onclick=choose;
  show(intro,room,button);
 }catch(error){show(el('p',String(error),'error'))}
}
async function choose(){
 try{
  await json('/api/auth/oauth2/authorize-room',{method:'POST',headers:{'Content-Type':'application/json'},body:oauthBody({})});
  const result=await json('/api/auth/oauth2/continue',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:oauthBody({postLogin:true})});
  go(result);
 }catch(error){show(el('p',String(error),'error'))}
}
start();`,
);

const CONSENT_HTML = shell(
	'Allow access?',
	`${helpers}
async function start(){
 try{
  const context=await json('/api/auth/oauth2/room-context',{method:'POST',headers:{'Content-Type':'application/json'},body:oauthBody({})});
  if(!context.selected)throw new Error('This authorization has no selected room.');
  const body=el('p',context.client.name+' ('+context.client.redirect_origin+') wants to read “'+context.room.name+'” and use Writing Tools AI on your behalf.');
  const note=el('p','The access token is limited to this room and expires in one hour.','muted');
  const actions=el('div',undefined,'actions');
  const allow=el('button','Allow','primary');allow.onclick=()=>decide(true);
  const deny=el('button','Deny');deny.onclick=()=>decide(false);
  actions.append(allow,deny);show(body,note,actions);
 }catch(error){show(el('p',String(error),'error'))}
}
async function decide(accept){
 try{
  const result=await json('/api/auth/oauth2/consent',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:oauthBody({accept})});
  go(result);
 }catch(error){show(el('p',String(error),'error'))}
}
start();`,
);

export function registerOAuthPages(app: import('hono').Hono): void {
	app.get('/api/oauth/login', (c) => c.html(LOGIN_HTML));
	app.get('/api/oauth/room', (c) => c.html(ROOM_HTML));
	app.get('/api/oauth/consent', (c) => c.html(CONSENT_HTML));
}
