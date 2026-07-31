import type { Context } from 'hono';
import type { Auth } from '../auth.js';
import {
	getRoomForUser,
	listRooms,
	selectRoomForOAuth,
	selectedRoomForOAuth,
} from '../rooms.js';

const PAGE_STYLE = `
body{font:16px/1.5 system-ui,sans-serif;max-width:620px;margin:3rem auto;padding:0 1.5rem;color:#172033}
h1{font-size:1.5rem}button{font:inherit;padding:.65rem 1rem;border:1px solid #aab2c0;border-radius:7px;cursor:pointer}
.primary{background:#3157d5;color:white;border-color:#3157d5}.room{display:block;width:100%;text-align:left;margin:.7rem 0}
.muted{color:#657087}.error{color:#b42318}.actions{display:flex;gap:.7rem;margin-top:1.5rem}`;

function shell(title: string, script: string): string {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${PAGE_STYLE}</style></head><body><h1>${title}</h1><main id="app"><p class="muted">Loading…</p></main><script>${script}</script></body></html>`;
}

const helpers = `
const app=document.getElementById('app');
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node}
function show(...nodes){app.replaceChildren(...nodes)}
async function json(url,init){const response=await fetch(url,{credentials:'include',...init});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.detail||body.error_description||body.error||('Request failed ('+response.status+')'));return body}
function go(result){const url=result.url||result.redirect_uri;if(url)location.href=url;else throw new Error('Authorization server returned no redirect URL')}
`;

const LOGIN_HTML = shell(
	'Connect Mindmap',
	`${helpers}
async function start(){
 const session=await json('/api/auth/get-session').catch(()=>null);
 if(session?.user){
   location.replace('/api/auth/oauth2/authorize'+location.search);
   return;
 }
 const p=el('p','Sign in to choose which Writing Tools room Mindmap may open.');
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
	'Choose a room',
	`${helpers}
async function start(){
 try{
  const rooms=await json('/api/oauth/rooms');
  const params=new URLSearchParams(location.search);
  const hint=(params.get('state')||'').split('.')[0];
  const intro=el('p','Mindmap will receive access only to the room you choose.','muted');
  const nodes=[intro];
  for(const room of rooms){
   const b=el('button',room.name+(room.id===hint?' — from this launch':''),'room'+(room.id===hint?' primary':''));
   b.onclick=()=>choose(room.id);
   nodes.push(b);
  }
  if(!rooms.length)nodes.push(el('p','No rooms are available for this account. Return to Writing Tools and launch Mindmap again.','error'));
  show(...nodes);
 }catch(error){show(el('p',String(error),'error'))}
}
async function choose(roomId){
 try{
  await json('/api/oauth/room/select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room_id:roomId})});
  const result=await json('/api/auth/oauth2/continue',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({postLogin:true,oauth_query:location.search.slice(1)})});
  go(result);
 }catch(error){show(el('p',String(error),'error'))}
}
start();`,
);

const CONSENT_HTML = shell(
	'Allow Mindmap access?',
	`${helpers}
async function start(){
 try{
  const room=await json('/api/oauth/selected-room');
  const body=el('p','Mindmap wants to read “'+room.name+'” and use Writing Tools AI on your behalf.');
  const note=el('p','The access token is limited to this room and expires in one hour.','muted');
  const actions=el('div',undefined,'actions');
  const allow=el('button','Allow','primary');allow.onclick=()=>decide(true);
  const deny=el('button','Deny');deny.onclick=()=>decide(false);
  actions.append(allow,deny);show(body,note,actions);
 }catch(error){show(el('p',String(error),'error'))}
}
async function decide(accept){
 try{
  const result=await json('/api/auth/oauth2/consent',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({accept,oauth_query:location.search.slice(1)})});
  go(result);
 }catch(error){show(el('p',String(error),'error'))}
}
start();`,
);

export function registerOAuthPages(app: import('hono').Hono, auth: Auth): void {
	app.get('/api/oauth/login', (c) => c.html(LOGIN_HTML));
	app.get('/api/oauth/room', (c) => c.html(ROOM_HTML));
	app.get('/api/oauth/consent', (c) => c.html(CONSENT_HTML));

	app.get('/api/oauth/rooms', async (c) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.json({ detail: 'Unauthorized' }, 401);
		return c.json(
			listRooms(session.user.id).map(({ id, name, updatedAt }) => ({
				id,
				name,
				updated_at: updatedAt,
			})),
		);
	});

	app.post('/api/oauth/room/select', async (c) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.json({ detail: 'Unauthorized' }, 401);
		const body = (await c.req.json().catch(() => ({}))) as { room_id?: unknown };
		if (
			typeof body.room_id !== 'string' ||
			!selectRoomForOAuth(session.session.id, session.user.id, body.room_id)
		) {
			return c.json({ detail: 'Room not found for this account.' }, 404);
		}
		return c.json({ ok: true });
	});

	app.get('/api/oauth/selected-room', async (c) => {
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return c.json({ detail: 'Unauthorized' }, 401);
		const roomId = selectedRoomForOAuth(session.session.id, session.user.id);
		const room = roomId ? getRoomForUser(roomId, session.user.id) : null;
		if (!room) return c.json({ detail: 'Choose a room first.' }, 409);
		return c.json({ id: room.id, name: room.name });
	});
}
