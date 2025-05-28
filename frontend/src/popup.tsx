import { AuthorizationServiceConfiguration, RedirectRequestHandler, AuthorizationRequest, BaseTokenRequestHandler, TokenRequest, GRANT_TYPE_AUTHORIZATION_CODE, FetchRequestor } from '@openid/appauth';

const googleAuthConfig = JSON.parse(process.env.GOOGLE_AUTH_CONFIG || '{}');
if (!googleAuthConfig.clientId) {
	document.body.innerText = 'Google Auth client ID is not configured.';
}


const GOOGLE_CLIENT_ID = googleAuthConfig.client_id;
const REDIRECT_URI = window.location.origin + '/popup.html';
const SCOPE = 'openid email profile';

async function runPKCEFlow() {
  // 1. Discover endpoints (or hardcode as below)
  const serviceConfig = new AuthorizationServiceConfiguration({
    authorization_endpoint: googleAuthConfig.auth_uri,
    token_endpoint: googleAuthConfig.token_uri,
  });

  // 2. Handle redirect back from Google
  const requestHandler = new RedirectRequestHandler(new LocalStorageBackend(), window.location, new DefaultCrypto());
  const tokenHandler = new BaseTokenRequestHandler(new FetchRequestor());

  // If this is the redirect back from Google, complete the flow
  const request = await requestHandler.completeAuthorizationRequestIfPossible();
  if (request) {
    // Exchange code for tokens
    const tokenRequest = new TokenRequest({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      grant_type: GRANT_TYPE_AUTHORIZATION_CODE,
      code: request.code,
      extras: { code_verifier: request.internal.code_verifier }
    });

    try {
      const tokenResponse = await tokenHandler.performTokenRequest(serviceConfig, tokenRequest);
      // Send tokens to parent
      Office.context.ui.messageParent(JSON.stringify({
        status: 'success',
        accessToken: tokenResponse.accessToken,
        idToken: tokenResponse.idToken,
      }));
    }
	catch (err: any) {
      Office.context.ui.messageParent(JSON.stringify({
        status: 'error',
        error: err.toString(),
      }));
    }
    return;
  }

  // 3. If not a redirect, start the auth flow
  const authRequest = new AuthorizationRequest({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    response_type: AuthorizationRequest.RESPONSE_TYPE_CODE,
    state: undefined,
    extras: { prompt: 'select_account' }
  }, new DefaultCrypto());

  // This will redirect to Google, then back to this page
  requestHandler.performAuthorizationRequest(serviceConfig, authRequest);
}

Office.onReady(() => {
  runPKCEFlow();
});
