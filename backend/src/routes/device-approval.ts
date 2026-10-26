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
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,400..700&display=swap" rel="stylesheet" />
  <style>
    /* Thoughtful's app palette (navbar/draft/revise): warm paper, warm grey
       rules, near-black ink; blue only for links. */
    :root {
      --desk: #f1eee7; --sheet: #ffffff; --paper: #faf8f4; --ink: #1c1c1c; --muted: #6b6b6b;
      --faint: #b3aba0; --rule: #e4e0d8; --link: #2d5be3; --focus: rgba(45, 91, 227, 0.3);
      --btn-ink: #1c1c1c; --btn-ink-hover: #3a3a3a; --btn-text: #fafaf8;
      --err: #a3261d; --err-bg: #fbf1ee; --err-rule: #efcdc6; --ok: #1b7a4e; --ok-bg: #edf7f2;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --desk: #161513; --sheet: #1f1e1b; --paper: #272522; --ink: #ece8e1; --muted: #a39d93;
        --faint: #7a746b; --rule: #34312c; --link: #8aa7ff; --focus: rgba(138, 167, 255, 0.35);
        --btn-ink: #ece8e1; --btn-ink-hover: #ffffff; --btn-text: #1c1c1c;
        --err: #f2a99f; --err-bg: #2b1a17; --err-rule: #4a2a24; --ok: #7fd1a8; --ok-bg: #16261e;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: flex-start; justify-content: center;
      padding: 10vh 16px 32px; background: var(--desk); color: var(--ink);
      font: 15px/1.55 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
    }
    .sheet {
      width: 100%; max-width: 420px; background: var(--sheet); border: 1px solid var(--rule);
      border-radius: 4px; padding: 30px 28px 28px;
      box-shadow: 0 1px 0 var(--rule), 0 14px 30px -18px rgba(60, 45, 20, 0.28);
    }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; font-size: 0.85rem; font-weight: 600; letter-spacing: 0.01em; }
    .brand svg { color: var(--ink); flex: none; }
    .steps { list-style: none; display: flex; gap: 6px; margin: 0 0 18px; padding: 0; font-size: 0.75rem; color: var(--faint); }
    .steps li { display: flex; align-items: center; gap: 6px; }
    .steps li + li::before { content: ''; width: 14px; height: 1px; background: var(--rule); }
    .steps li.current { color: var(--ink); font-weight: 600; }
    .steps li.done { color: var(--muted); }
    h1 { font-size: 1.45rem; line-height: 1.25; font-weight: 600; letter-spacing: -0.015em; margin: 0 0 6px; }
    .lede { color: var(--muted); margin: 0; }
    #content { margin-top: 24px; display: flex; flex-direction: column; gap: 14px; }
    #content:empty { display: none; }
    #content p { margin: 0; }
    #status { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
    #status:empty { display: none; }
    #status p { margin: 0; }
    .muted { color: var(--muted); font-size: 0.9rem; }
    .account { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; padding: 0 0 14px; border-bottom: 1px solid var(--rule); font-size: 0.88rem; color: var(--muted); }
    .account strong { color: var(--ink); font-weight: 600; word-break: break-all; }
    label { font-weight: 600; font-size: 0.9rem; }
    .code-input {
      width: 100%; font: 500 1.4rem/1 'DM Mono', ui-monospace, Consolas, monospace; letter-spacing: 0.3em;
      text-align: center; text-transform: uppercase; padding: 14px 12px; border-radius: 4px;
      border: 1px solid var(--rule); background: var(--paper); color: var(--ink);
    }
    .code-input::placeholder { color: var(--faint); letter-spacing: 0.3em; }
    .code-input:focus { outline: none; border-color: var(--ink); box-shadow: 0 0 0 3px var(--focus); }
    .deny-line { text-align: center; font-size: 0.85rem; color: var(--muted); }
    .actions { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
    .btn { width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 10px; padding: 11px 16px; font: inherit; font-weight: 600; border-radius: 4px; border: 1px solid transparent; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s; }
    .btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--focus); }
    .btn:disabled { opacity: 0.55; cursor: default; }
    .primary { background: var(--btn-ink); color: var(--btn-text); }
    .primary:hover:not(:disabled) { background: var(--btn-ink-hover); }
    .secondary { background: transparent; color: var(--ink); border-color: var(--rule); }
    .secondary:hover:not(:disabled) { border-color: var(--faint); }
    .link { background: none; border: none; padding: 0; font: inherit; font-size: 0.85rem; color: var(--link); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
    .link:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
    .err, .ok { padding: 10px 12px; border-radius: 4px; font-size: 0.9rem; }
    .err { color: var(--err); background: var(--err-bg); border: 1px solid var(--err-rule); }
    .ok { color: var(--ok); background: var(--ok-bg); }
    .result { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 0 2px; }
    .result h2 { font-size: 1.15rem; font-weight: 600; margin: 6px 0 0; }
    .result p { color: var(--muted); }
    .result-icon { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; }
    .ok-icon { background: var(--ok-bg); color: var(--ok); }
    .neutral-icon { background: var(--paper); color: var(--muted); border: 1px solid var(--rule); }
  </style>
</head>
<body>
  <main class="sheet">
    <div class="brand">
      <!-- The Thoughtful mark: a sheet with a pencil (frontend/public/assets/logo_black*). -->
      <svg width="24" height="30" viewBox="0 0 24 30" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="1" y="1" width="22" height="28" stroke-width="1.6" />
        <path d="M12 7H6v10h10v-5" stroke-width="1.6" />
        <path d="M10 13l6-6" stroke-width="2.4" />
      </svg>
      ${PRODUCT_NAME}
    </div>
    <ol class="steps" aria-label="Progress">
      <li data-step="1">Sign in</li>
      <li data-step="2">Approve</li>
    </ol>
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
    // Mark the step indicator: steps before n are done, n is current. n = 3
    // marks both done (after approve/deny).
    function setStep(n) {
      document.querySelectorAll('.steps li').forEach((li) => {
        const k = Number(li.dataset.step);
        li.classList.toggle('done', k < n);
        li.classList.toggle('current', k === n);
        if (k === n) li.setAttribute('aria-current', 'step');
        else li.removeAttribute('aria-current');
      });
    }
    function icon(id) {
      return document.getElementById(id).content.firstElementChild.cloneNode(true);
    }
    function actions(...buttons) {
      const d = el('div', 'actions');
      d.append(...buttons);
      return d;
    }
    // Freeze the content area's controls while a request is in flight, so a double
    // click or a second Enter can't send the same claim/approve/deny twice.
    let busy = false;
    function setBusy(next) {
      busy = next;
      content.querySelectorAll('button, input').forEach((c) => { c.disabled = next; });
    }
    // Final state after approve/deny: replaces the content with a centred result.
    function showResult(kind, title, text) {
      const ic = el('div', 'result-icon ' + (kind === 'ok' ? 'ok-icon' : 'neutral-icon'));
      ic.append(icon(kind === 'ok' ? 'icon-check' : 'icon-x'));
      const box = el('div', 'result');
      box.append(ic, el('h2', null, title), el('p', null, text));
      setStep(3);
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
    // restart button. Unknown errors leave the code entry in place so
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
        showContent(); // the code entry is useless for a dead code
        setStatus(
          el('p', 'err', action + ' failed: this code is no longer valid — it likely expired.'),
          el('p', null, 'Codes only last a few minutes. Start sign-in again in ${PRODUCT_NAME} to get a fresh code, then enter it here.'),
          btn('primary', 'Enter a new code', () => init()),
        );
      } else {
        // Leave the code entry intact so the user can simply retry.
        setStatus(el('span', 'err', action + ' failed: ' + JSON.stringify(data)));
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

    // One click: claim the typed code for this account, then approve (or deny) it.
    // Better Auth needs both calls in order; there is no separate confirm screen,
    // because typing the code from the task pane is what shows intent, and a
    // confirm screen could only repeat that same code back.
    async function submitCode(raw, action) {
      if (busy) return;
      const userCode = normalizeCode(raw);
      if (!userCode) {
        setStatus(el('span', 'err', 'Enter the code first.'));
        return;
      }
      setStatus(el('span', 'muted', action === 'deny' ? 'Denying…' : 'Approving…'));
      setBusy(true);
      try {
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
        if (action === 'deny') await denyRequest(userCode);
        else await approveRequest(userCode);
      } catch {
        setStatus(el('p', 'err', 'Network error. Check your connection and try again.'));
      } finally {
        setBusy(false);
      }
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
      const approveBtn = btn('primary', 'Approve', () => submitCode(input.value, 'approve'));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitCode(input.value, 'approve');
      });
      input.placeholder = 'XXXXXXXX';
      const denyP = el('p', 'deny-line');
      denyP.append('Not you? ', linkButton('Deny this request', () => submitCode(input.value, 'deny')));
      setStep(2);
      showContent(who, p, input, actions(approveBtn), denyP);
      input.focus();
    }

    function googleButton() {
      const b = btn('secondary google', '', signIn);
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
        setStep(1);
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
