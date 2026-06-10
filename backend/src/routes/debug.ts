import type { Context } from 'hono';

// Minimal diagnostic page for manually verifying Better Auth in the backend.
// Adapted from the verified playground (playgrounds/better-auth-hono/public/index.html).
// Registered only when auth is enabled AND DEBUG=true (see index.ts), so it is
// never present in production or in the test environment.
const DEBUG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Auth Debug — Writing Tools Backend</title>
  <style>
    body { font-family: sans-serif; max-width: 560px; margin: 2.5rem auto; padding: 0 1.5rem; line-height: 1.5; }
    h1 { font-size: 1.3rem; }
    button { padding: 0.6rem 1.25rem; cursor: pointer; font-size: 1rem; border-radius: 6px; border: 1px solid #ccc; margin: 0.25rem 0.5rem 0.25rem 0; }
    .primary { background: #2563eb; color: white; border-color: #2563eb; }
    .muted { color: #666; font-size: 0.85rem; }
    pre { background: #f4f4f4; padding: 0.75rem; border-radius: 6px; white-space: pre-wrap; word-break: break-all; font-size: 0.85rem; }
    .ok { color: #16a34a; font-weight: bold; }
    .err { color: #dc2626; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Auth Debug</h1>
  <p class="muted">Manual verification page for Better Auth cookie + Bearer sessions.</p>

  <div id="signed-out">
    <button class="primary" onclick="signIn()">Sign in with Google</button>
  </div>

  <div id="signed-in" style="display:none">
    <p id="user-info"></p>
    <button onclick="callProtected('cookie')">Call /api/protected (cookie)</button>
    <button onclick="callProtected('bearer')">Call /api/protected (Bearer)</button>
    <button onclick="signOut()">Sign out</button>
  </div>

  <div id="result"></div>

  <script>
    const BASE = window.location.origin;

    async function getSession() {
      const res = await fetch(BASE + '/api/auth/get-session', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.user ? data : null;
    }

    async function init() {
      const session = await getSession();
      if (session) {
        document.getElementById('signed-out').style.display = 'none';
        document.getElementById('signed-in').style.display = 'block';
        document.getElementById('user-info').textContent =
          'Signed in as ' + session.user.email + ' (' + session.user.name + ')';
      }
    }

    async function signIn() {
      const res = await fetch(BASE + '/api/auth/sign-in/social', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: BASE + '/api/debug/auth' }),
      });
      const data = await res.json();
      if (data && data.url) window.location.href = data.url;
      else show('Sign-in error: ' + JSON.stringify(data), true);
    }

    async function signOut() {
      await fetch(BASE + '/api/auth/sign-out', { method: 'POST', credentials: 'include' });
      window.location.reload();
    }

    async function callProtected(mode) {
      const opts = { credentials: mode === 'cookie' ? 'include' : 'omit' };
      if (mode === 'bearer') {
        // Read the session token fresh and send it as a Bearer header.
        // The token is never stored or rendered.
        const session = await getSession();
        const token = session && session.session ? session.session.token : null;
        if (!token) { show('No session token available — sign in first.', true); return; }
        opts.headers = { Authorization: 'Bearer ' + token };
      }
      const res = await fetch(BASE + '/api/protected', opts);
      const data = await res.json();
      show(res.status + ': ' + JSON.stringify(data), !res.ok);
    }

    function show(text, isErr) {
      document.getElementById('result').innerHTML =
        '<pre class="' + (isErr ? 'err' : 'ok') + '">' + text + '</pre>';
    }

    init();
  </script>
</body>
</html>`;

export function debugAuthHandler(c: Context) {
	return c.html(DEBUG_HTML);
}
