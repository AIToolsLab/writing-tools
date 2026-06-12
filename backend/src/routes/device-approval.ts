import type { Context } from 'hono';

// Browser-facing device authorization approval page at GET /api/device.
// Must be on the backend's origin so Google session cookies reach Better Auth.
// Registered whenever auth is enabled (see index.ts).
const DEVICE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize Writing Tools</title>
  <style>
    body { font-family: sans-serif; max-width: 520px; margin: 3rem auto; padding: 0 1.5rem; line-height: 1.5; }
    h1 { font-size: 1.4rem; }
    .code { font-family: monospace; font-size: 1.6rem; letter-spacing: 0.15em; background: #f4f4f4; padding: 0.5rem 1rem; border-radius: 6px; display: inline-block; }
    button { padding: 0.6rem 1.5rem; cursor: pointer; font-size: 1rem; border-radius: 6px; border: 1px solid #ccc; margin-right: 0.75rem; }
    .approve { background: #16a34a; color: white; border-color: #16a34a; }
    .deny { background: #dc2626; color: white; border-color: #dc2626; }
    .muted { color: #666; font-size: 0.9rem; }
    #content { margin-top: 1.5rem; }
    #status { margin-top: 1rem; }
    .ok { color: #16a34a; font-weight: bold; }
    .err { color: #dc2626; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Authorize Writing Tools</h1>
  <p class="muted">A device is requesting access to your Writing Tools account.</p>
  <div id="content">Loading…</div>
  <div id="status"></div>

  <script>
    const BASE = window.location.origin;
    const params = new URLSearchParams(window.location.search);
    const userCode = params.get('user_code');
    const content = document.getElementById('content');
    const statusEl = document.getElementById('status');

    // All dynamic values go through textContent — never innerHTML.
    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function btn(cls, label, handler) {
      const b = el('button', cls, label);
      b.onclick = handler;
      return b;
    }
    function showContent(...nodes) { content.replaceChildren(...nodes); }
    function setStatus(...nodes) { statusEl.replaceChildren(...nodes); }

    async function getSession() {
      const res = await fetch(BASE + '/api/auth/get-session', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.user ? data : null;
    }

    async function claimCode() {
      const res = await fetch(
        BASE + '/api/auth/device?user_code=' + encodeURIComponent(userCode),
        { credentials: 'include' }
      );
      return { ok: res.ok, data: await res.json() };
    }

    async function signIn() {
      const res = await fetch(BASE + '/api/auth/sign-in/social', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL: window.location.href }),
      });
      const data = await res.json();
      if (data?.url) window.location.href = data.url;
      else setStatus(el('span', 'err', 'Sign-in error: ' + JSON.stringify(data)));
    }

    async function approve() {
      const res = await fetch(BASE + '/api/auth/device/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showContent();
        setStatus(el('p', 'ok', 'Authorization complete. You can close this tab and return to Writing Tools.'));
      } else {
        setStatus(el('span', 'err', 'Approve failed: ' + JSON.stringify(data)));
      }
    }

    async function deny() {
      const res = await fetch(BASE + '/api/auth/device/deny', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showContent();
        setStatus(el('p', 'err', 'Authorization denied. The device will not be granted access.'));
      } else {
        setStatus(el('span', 'err', 'Deny failed: ' + JSON.stringify(data)));
      }
    }

    async function init() {
      if (!userCode) {
        showContent(el('p', 'err', 'No user_code in the URL.'));
        return;
      }

      const session = await getSession();

      if (!session) {
        const codeSpan = el('span', 'code', userCode);
        const p1 = el('p'); p1.append('You are authorizing code: ', codeSpan);
        showContent(p1, el('p', null, 'Sign in with Google to continue.'), btn('approve', 'Sign in with Google', signIn));
        return;
      }

      const { ok, data } = await claimCode();
      if (!ok) {
        showContent(el('p', 'err', data?.error_description ?? 'Invalid or expired code.'));
        return;
      }

      if (data.status !== 'pending') {
        const p = el('p');
        p.append('This code has already been ');
        p.append(el('strong', null, data.status));
        p.append('.');
        showContent(p);
        return;
      }

      const emailStrong = el('strong', null, session.user.email);
      const p1 = el('p'); p1.append('Signed in as ', emailStrong);
      const codeSpan = el('span', 'code', userCode);
      const p2 = el('p'); p2.append('Authorize access for code: ', codeSpan);
      showContent(p1, p2, btn('approve', 'Approve', approve), btn('deny', 'Deny', deny));
    }

    init();
  </script>
</body>
</html>`;

export function devicePageHandler(c: Context) {
	return c.html(DEVICE_HTML);
}
