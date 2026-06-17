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
    .code-input { font-family: monospace; font-size: 1.3rem; letter-spacing: 0.12em; text-transform: uppercase; padding: 0.6rem 0.8rem; border-radius: 6px; border: 1px solid #ccc; width: 100%; box-sizing: border-box; margin-bottom: 0.9rem; }
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

    // The user code is typed here, never carried in the URL. That forces the user to
    // read it from the requesting device (their taskpane), which is what proves intent.
    function normalizeCode(raw) {
      return (raw || '').toUpperCase().replace(/[\\s-]/g, '');
    }

    async function getSession() {
      const res = await fetch(BASE + '/api/auth/get-session', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.user ? data : null;
    }

    async function claimCode(userCode) {
      const res = await fetch(
        BASE + '/api/auth/device?user_code=' + encodeURIComponent(userCode),
        { credentials: 'include' }
      );
      return { ok: res.ok, data: await res.json() };
    }

    async function signIn() {
      // Return to this same page (without any query) after Google sign-in.
      const callbackURL = window.location.origin + window.location.pathname;
      const res = await fetch(BASE + '/api/auth/sign-in/social', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', callbackURL }),
      });
      const data = await res.json();
      if (data?.url) window.location.href = data.url;
      else setStatus(el('span', 'err', 'Sign-in error: ' + JSON.stringify(data)));
    }

    async function switchAccount() {
      // Drop the current Better Auth session, then re-run Google sign-in. The provider
      // is configured with prompt=select_account, so the user can pick a different
      // account instead of silently reusing the current one.
      setStatus(el('span', 'muted', 'Switching account…'));
      try {
        await fetch(BASE + '/api/auth/sign-out', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch {
        // Ignore sign-out failure; re-running sign-in still lets them choose.
      }
      await signIn();
    }

    async function approve(userCode) {
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

    async function deny(userCode) {
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

    // Signed in: show the approve/deny step for a claimed, pending code.
    function showApproval(session, userCode) {
      setStatus();
      const emailStrong = el('strong', null, session.user.email);
      const p1 = el('p'); p1.append('Signed in as ', emailStrong);
      const codeSpan = el('span', 'code', userCode);
      const p2 = el('p'); p2.append('Authorize access for code: ', codeSpan);
      showContent(p1, p2,
        btn('approve', 'Approve', () => approve(userCode)),
        btn('deny', 'Deny', () => deny(userCode)));
    }

    async function submitCode(session, raw) {
      const userCode = normalizeCode(raw);
      if (!userCode) {
        setStatus(el('span', 'err', 'Enter the code first.'));
        return;
      }
      setStatus(el('span', 'muted', 'Checking code…'));
      const { ok, data } = await claimCode(userCode);
      if (!ok) {
        // Keep the input on screen so the user can correct and retry.
        setStatus(el('span', 'err', data?.error_description ?? 'Invalid or expired code. Check it and try again.'));
        return;
      }
      if (data.status !== 'pending') {
        const p = el('p');
        p.append('This code has already been ');
        p.append(el('strong', null, data.status));
        p.append('.');
        setStatus();
        showContent(p);
        return;
      }
      showApproval(session, userCode);
    }

    // A button styled as an inline text link.
    function linkButton(label, handler) {
      const b = el('button', null, label);
      b.style.background = 'none';
      b.style.border = 'none';
      b.style.padding = '0';
      b.style.margin = '0';
      b.style.color = '#2563eb';
      b.style.textDecoration = 'underline';
      b.style.cursor = 'pointer';
      b.style.fontSize = '0.9rem';
      b.onclick = handler;
      return b;
    }

    // Signed in: prompt for the code shown on the requesting device.
    function showCodeEntry(session) {
      // Show which account is about to authorize the device, and let the user switch
      // if it's the wrong one.
      const who = el('p', 'muted');
      who.append('Signed in as ', el('strong', null, session.user.email));
      const switchP = el('p');
      switchP.append(linkButton('Use a different account', switchAccount));

      const p = el('p', null, 'Enter the code shown in Writing Tools:');
      const input = el('input', 'code-input');
      input.type = 'text';
      input.setAttribute('autocomplete', 'one-time-code');
      input.setAttribute('autocapitalize', 'characters');
      input.setAttribute('spellcheck', 'false');
      const cont = btn('approve', 'Continue', () => submitCode(session, input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitCode(session, input.value);
      });
      showContent(who, switchP, p, input, cont);
      input.focus();
    }

    async function init() {
      const session = await getSession();
      if (!session) {
        showContent(
          el('p', null, 'Sign in with Google, then enter the code shown in Writing Tools.'),
          btn('approve', 'Sign in with Google', signIn),
        );
        return;
      }
      showCodeEntry(session);
    }

    init();
  </script>
</body>
</html>`;

export function devicePageHandler(c: Context) {
	return c.html(DEVICE_HTML);
}
