import type { Context } from 'hono';

// Browser-facing device authorization approval page at GET /api/device.
// Must be on the backend's origin so Google session cookies reach Better Auth.
// Registered whenever auth is enabled (see index.ts).

// User-facing product name, in one place so it's tunable. Interpolated into the
// template below (static HTML and the inline script alike). Cross-app naming
// (manifest DisplayName, frontend) is a broader cleanup tracked separately.
const PRODUCT_NAME = 'Thoughtful AI Tools';

const DEVICE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authorize ${PRODUCT_NAME}</title>
  <style>
    :root {
      --bg: #f5f6f8; --card: #ffffff; --text: #111827; --muted: #6b7280;
      --border: #e5e7eb; --field: #f9fafb; --primary: #2563eb; --primary-hover: #1d4ed8;
      --focus: rgba(37, 99, 235, 0.35); --err: #b91c1c; --err-bg: #fef2f2; --err-border: #fecaca;
      --ok: #15803d; --ok-bg: #f0fdf4;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1115; --card: #181b21; --text: #e5e7eb; --muted: #9ca3af;
        --border: #2a2f38; --field: #111317; --primary: #3b82f6; --primary-hover: #60a5fa;
        --focus: rgba(59, 130, 246, 0.45); --err: #fca5a5; --err-bg: #2a1215; --err-border: #5b1d22;
        --ok: #86efac; --ok-bg: #0f2418;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: flex-start; justify-content: center;
      padding: 12vh 16px 32px; background: var(--bg); color: var(--text);
      font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--border);
      border-radius: 14px; padding: 32px 28px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06);
    }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; color: var(--muted); font-size: 0.85rem; font-weight: 500; }
    .brand-mark { width: 28px; height: 28px; border-radius: 7px; background: var(--primary); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 0.95rem; }
    h1 { font-size: 1.35rem; line-height: 1.3; font-weight: 650; margin: 0 0 6px; }
    .lede { color: var(--muted); margin: 0; }
    #content { margin-top: 24px; display: flex; flex-direction: column; gap: 14px; }
    #content:empty { display: none; }
    #content p { margin: 0; }
    #status { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
    #status:empty { display: none; }
    #status p { margin: 0; }
    .muted { color: var(--muted); font-size: 0.9rem; }
    .account { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--field); font-size: 0.9rem; }
    .account strong { font-weight: 600; word-break: break-all; }
    label { font-weight: 550; font-size: 0.9rem; }
    .code, .code-input { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: 0.18em; text-align: center; }
    .code { display: block; font-size: 1.7rem; font-weight: 600; padding: 14px 12px; border-radius: 10px; background: var(--field); border: 1px solid var(--border); }
    .code-input { width: 100%; font-size: 1.35rem; text-transform: uppercase; padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--field); color: var(--text); }
    .code-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px var(--focus); }
    .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
    .btn { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 11px 16px; font: inherit; font-weight: 600; border-radius: 10px; border: 1px solid transparent; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
    .btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--focus); }
    .btn:disabled { opacity: 0.6; cursor: default; }
    .primary { background: var(--primary); color: #fff; }
    .primary:hover:not(:disabled) { background: var(--primary-hover); }
    .secondary { background: transparent; color: var(--text); border-color: var(--border); }
    .secondary:hover:not(:disabled) { border-color: var(--muted); }
    .link { background: none; border: none; padding: 0; font: inherit; font-size: 0.85rem; color: var(--primary); text-decoration: underline; cursor: pointer; }
    .link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 3px; }
    .err, .ok { padding: 10px 12px; border-radius: 10px; font-size: 0.9rem; }
    .err { color: var(--err); background: var(--err-bg); border: 1px solid var(--err-border); }
    .ok { color: var(--ok); background: var(--ok-bg); }
    .result { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 8px 0 4px; }
    .result h2 { font-size: 1.15rem; margin: 4px 0 0; }
    .result p { color: var(--muted); }
    .result-icon { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; }
    .ok-icon { background: var(--ok-bg); color: var(--ok); }
    .neutral-icon { background: var(--field); color: var(--muted); border: 1px solid var(--border); }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand"><span class="brand-mark" aria-hidden="true">T</span>${PRODUCT_NAME}</div>
    <h1>Authorize ${PRODUCT_NAME}</h1>
    <p class="lede">A device is requesting access to your ${PRODUCT_NAME} account.</p>
    <div id="content"><p class="muted">Loading…</p></div>
    <div id="status" role="status" aria-live="polite"></div>
  </main>

  <!-- Static icons, cloned by icon() (never built from dynamic strings). -->
  <template id="icon-google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg></template>
  <template id="icon-check"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></template>
  <template id="icon-x"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></template>

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
      const b = el('button', 'btn ' + cls, label);
      b.type = 'button';
      b.onclick = handler;
      return b;
    }
    function icon(id) {
      return document.getElementById(id).content.firstElementChild.cloneNode(true);
    }
    function actions(...buttons) {
      const d = el('div', 'actions');
      d.append(...buttons);
      return d;
    }
    // Disable every button in the content area while a request is in flight, so a
    // double click can't send the same claim/approve/deny twice.
    function setBusy(busy) {
      content.querySelectorAll('button').forEach((b) => { b.disabled = busy; });
    }
    // Final state after approve/deny: replaces the content with a centred result.
    function showResult(kind, title, text) {
      const ic = el('div', 'result-icon ' + (kind === 'ok' ? 'ok-icon' : 'neutral-icon'));
      ic.append(icon(kind === 'ok' ? 'icon-check' : 'icon-x'));
      const box = el('div', 'result');
      box.append(ic, el('h2', null, title), el('p', null, text));
      setStatus();
      showContent(box);
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
      // Return to this same page (without any query) after Google sign-in. OAuth
      // failures come back here too, tagged ?auth_error=1 (errorCallbackURL) —
      // without it, Better Auth renders its default error page whose "Go Home"
      // link points at the backend root, a 404 dead end for the user.
      const callbackURL = window.location.origin + window.location.pathname;
      const res = await fetch(BASE + '/api/auth/sign-in/social', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL,
          errorCallbackURL: callbackURL + '?auth_error=1',
        }),
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

    // Render a device-endpoint failure. Expired/invalid codes replace the
    // approval UI (retrying a dead code is pointless) with guidance plus a
    // restart button. Unknown errors leave the Approve/Deny buttons in place so
    // a transient failure (network blip, momentary 500) stays retryable — the
    // common case here is a code that expired between the device showing it and
    // the user clicking Approve (e.g. a slow 2FA detour during Google sign-in).
    function renderDeviceError(data, action) {
      const desc = String((data && (data.error_description || data.error)) || '');
      // Better Auth's device endpoint returns OAuth-style errors. Observed live for
      // a dead/wrong code: { error: 'invalid_request', error_description: 'Invalid
      // user code' }; an expired code surfaces error: 'expired_token'. Match those
      // codes; the description regex is a defensive fallback only.
      const codeGone =
        data?.error === 'expired_token' ||
        data?.error === 'invalid_request' ||
        /invalid user code|expired/i.test(desc);
      if (codeGone) {
        showContent(); // the Approve/Deny buttons are useless for a dead code
        setStatus(
          el('p', 'err', action + ' failed: this code is no longer valid — it likely expired.'),
          el('p', null, 'Codes only last a few minutes. Start sign-in again in ${PRODUCT_NAME} to get a fresh code, then enter it here.'),
          btn('primary', 'Enter a new code', () => init()),
        );
      } else {
        // Leave content (Approve/Deny) intact so the user can simply retry.
        setStatus(el('span', 'err', action + ' failed: ' + JSON.stringify(data)));
      }
    }

    async function approve(userCode) {
      setBusy(true);
      try {
        await approveRequest(userCode);
      } catch {
        setStatus(el('p', 'err', 'Approve failed: network error. Check your connection and try again.'));
      } finally {
        setBusy(false);
      }
    }
    async function approveRequest(userCode) {
      const res = await fetch(BASE + '/api/auth/device/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showResult('ok', 'Device authorized', 'You can close this tab and return to ${PRODUCT_NAME}.');
      } else {
        renderDeviceError(data, 'Approve');
      }
    }

    async function deny(userCode) {
      setBusy(true);
      try {
        await denyRequest(userCode);
      } catch {
        setStatus(el('p', 'err', 'Deny failed: network error. Check your connection and try again.'));
      } finally {
        setBusy(false);
      }
    }
    async function denyRequest(userCode) {
      const res = await fetch(BASE + '/api/auth/device/deny', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        showResult('denied', 'Request denied', 'The device will not be granted access.');
      } else {
        renderDeviceError(data, 'Deny');
      }
    }

    // Signed in: show the approve/deny step for a claimed, pending code.
    function showApproval(session, userCode) {
      setStatus();
      const p1 = el('p', 'account');
      const who = el('span');
      who.append('Signed in as ', el('strong', null, session.user.email));
      p1.append(who);
      showContent(p1, el('p', null, 'Authorize access for code:'), el('div', 'code', userCode), actions(
        btn('primary', 'Approve', () => approve(userCode)),
        btn('secondary', 'Deny', () => deny(userCode))));
    }

    async function submitCode(session, raw) {
      const userCode = normalizeCode(raw);
      if (!userCode) {
        setStatus(el('span', 'err', 'Enter the code first.'));
        return;
      }
      setStatus(el('span', 'muted', 'Checking code…'));
      setBusy(true);
      let claimed;
      try {
        claimed = await claimCode(userCode);
      } catch {
        setStatus(el('p', 'err', 'Could not check the code: network error. Try again.'));
        return;
      } finally {
        setBusy(false);
      }
      const { ok, data } = claimed;
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
      const b = el('button', 'link', label);
      b.type = 'button';
      b.onclick = handler;
      return b;
    }

    // Signed in: prompt for the code shown on the requesting device.
    function showCodeEntry(session) {
      // Show which account is about to authorize the device, and let the user switch
      // if it's the wrong one.
      const who = el('p', 'account');
      const whoText = el('span');
      whoText.append('Signed in as ', el('strong', null, session.user.email));
      who.append(whoText, linkButton('Use a different account', switchAccount));

      const p = el('label', null, 'Enter the code shown in ${PRODUCT_NAME}:');
      p.htmlFor = 'user-code';
      const input = el('input', 'code-input');
      input.id = 'user-code';
      input.type = 'text';
      input.setAttribute('autocomplete', 'one-time-code');
      input.setAttribute('autocapitalize', 'characters');
      input.setAttribute('spellcheck', 'false');
      const cont = btn('primary', 'Continue', () => submitCode(session, input.value));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitCode(session, input.value);
      });
      showContent(who, p, input, actions(cont));
      input.focus();
    }

    function googleButton() {
      const b = btn('secondary', '', signIn);
      b.append(icon('icon-google'), document.createTextNode('Sign in with Google'));
      return b;
    }

    async function init() {
      // An OAuth failure routed back via errorCallbackURL lands here with
      // ?auth_error=1. Show an honest retry UI, and clean the URL so a refresh
      // doesn't re-show a stale error.
      const authError = new URLSearchParams(window.location.search).has('auth_error');
      if (authError) {
        history.replaceState(null, '', window.location.pathname);
      }
      const session = await getSession();
      if (!session) {
        const nodes = [
          el('p', null, 'Sign in with Google, then enter the code shown in ${PRODUCT_NAME}.'),
          actions(googleButton()),
        ];
        if (authError) {
          nodes.unshift(el('p', 'err', "Google sign-in didn't complete. Nothing was authorized — you can try again."));
        }
        showContent(...nodes);
        return;
      }
      setStatus();
      showCodeEntry(session);
    }

    init();
  </script>
</body>
</html>`;

export function devicePageHandler(c: Context) {
	return c.html(DEVICE_HTML);
}
