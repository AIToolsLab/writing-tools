import type { Context } from 'hono';

// Debug simulator for the device authorization flow.
// Registered only when auth is enabled AND DEBUG=true (see index.ts).
// Mimics the constrained client (Word task pane / editor.html):
//   - credentials: "omit" throughout — no cookies, proves token-only path
//   - access token held in memory only, never stored in localStorage
//   - opens the approval page as a link the user clicks (maps to
//     open external browser in the real Word add-in)
function buildDebugDeviceHtml(serializedClientId: string) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Device Flow Debug — Writing Tools Backend</title>
  <style>
    body { font-family: sans-serif; max-width: 560px; margin: 2.5rem auto; padding: 0 1.5rem; line-height: 1.5; }
    h1 { font-size: 1.3rem; }
    button { padding: 0.6rem 1.25rem; cursor: pointer; font-size: 1rem; border-radius: 6px; border: 1px solid #ccc; margin: 0.25rem 0.5rem 0.25rem 0; }
    .primary { background: #2563eb; color: white; border-color: #2563eb; }
    .muted { color: #666; font-size: 0.85rem; }
    .code { font-family: monospace; font-size: 1.4rem; letter-spacing: 0.15em; background: #f4f4f4; padding: 0.35rem 0.8rem; border-radius: 6px; }
    pre { background: #f4f4f4; padding: 0.75rem; border-radius: 6px; white-space: pre-wrap; word-break: break-all; font-size: 0.8rem; }
    .ok { color: #16a34a; font-weight: bold; }
    .err { color: #dc2626; font-weight: bold; }
    #status { margin-top: 1rem; }
    #log { margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Device Flow Debug</h1>
  <p class="muted">
    Simulates a constrained client (no cookies). All requests use
    <code>credentials: "omit"</code>. Success depends only on the Bearer token.
  </p>

  <div>
    <button class="primary" id="start">Start device login</button>
    <button id="check">Call /api/protected with token</button>
    <button id="clear">Clear token</button>
  </div>

  <div id="status"></div>
  <div id="log"></div>

  <script>
    const BASE = window.location.origin;
    const CLIENT_ID = ${serializedClientId};
    const GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

    const statusEl = document.getElementById('status');
    const logEl = document.getElementById('log');
    let polling = false;
    // Access token held in memory only — never written to localStorage.
    let accessToken = null;

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    }
    function setStatus(...nodes) {
      statusEl.replaceChildren(...nodes.map(n =>
        typeof n === 'string' ? document.createTextNode(n) : n
      ));
    }
    function log(text) {
      const pre = document.createElement('pre');
      pre.textContent = text;
      logEl.prepend(pre);
    }

    async function startFlow() {
      if (polling) return;
      setStatus('Requesting device code…');
      const res = await fetch(BASE + '/api/auth/device/code', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID, scope: 'openid profile email' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(el('span', 'err', 'device/code failed: ' + JSON.stringify(data)));
        return;
      }

      log('device/code →\\n' + JSON.stringify(data, null, 2));

      // Show the approval link — user clicks to open in external browser.
      // In production Word opens new tab in the external system browser
      const codeSpan = el('span', 'code', data.user_code);
      const link = document.createElement('a');
      link.href = data.verification_uri_complete;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Open approval page →';
      const muted = el('span', 'muted', 'Polling every ' + data.interval + 's once you approve…');
      const p1 = document.createElement('span'); p1.append('User code: ', codeSpan);
      setStatus(p1, document.createElement('br'), link, document.createElement('br'), muted);

      pollForToken(data.device_code, data.interval);
    }

    async function pollForToken(deviceCode, intervalSec) {
      polling = true;
      let interval = intervalSec;

      const tick = async () => {
        if (!polling) return;
        const res = await fetch(BASE + '/api/auth/device/token', {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: GRANT, device_code: deviceCode, client_id: CLIENT_ID }),
        });
        const data = await res.json();

        if (res.ok && data.access_token) {
          polling = false;
          accessToken = data.access_token;
          // Log success without rendering the raw token value.
          log('device/token → SUCCESS (token held in memory)');
          setStatus(el('span', 'ok', 'Token received.'), ' Now click "Call /api/protected with token".');
          return;
        }

        switch (data.error) {
          case 'authorization_pending':
            setTimeout(tick, interval * 1000);
            break;
          case 'slow_down':
            interval += 5;
            log('slow_down → backing off to ' + interval + 's');
            setTimeout(tick, interval * 1000);
            break;
          case 'access_denied':
            polling = false;
            setStatus(el('span', 'err', 'Access denied.'), ' The user denied the request.');
            break;
          case 'expired_token':
            polling = false;
            setStatus(el('span', 'err', 'Code expired.'), ' Start the flow again.');
            break;
          default:
            polling = false;
            setStatus(el('span', 'err', 'Stopped: ' + JSON.stringify(data)));
        }
      };

      setTimeout(tick, interval * 1000);
    }

    async function callProtected() {
      if (!accessToken) {
        setStatus(el('span', 'err', 'No token.'), ' Run the device login first.');
        return;
      }
      const res = await fetch(BASE + '/api/protected', {
        credentials: 'omit',
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      const data = await res.json();
      log('/api/protected → ' + res.status + '\\n' + JSON.stringify(data, null, 2));
      if (res.ok) {
        setStatus(el('span', 'ok', String(res.status)), ' — authenticated as ' + data.email);
      } else {
        setStatus(el('span', 'err', String(res.status)), ' — ' + JSON.stringify(data));
      }
    }

    function clearToken() {
      accessToken = null;
      polling = false;
      setStatus('Token cleared.');
    }

    document.getElementById('start').onclick = startFlow;
    document.getElementById('check').onclick = callProtected;
    document.getElementById('clear').onclick = clearToken;
  </script>
</body>
</html>`;
}

export function createDebugDeviceHandler(clientId: string) {
	const serializedClientId = JSON.stringify(clientId);
	return (c: Context) => c.html(buildDebugDeviceHtml(serializedClientId));
}
