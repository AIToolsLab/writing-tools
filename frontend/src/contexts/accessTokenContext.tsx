import React, { createContext, useContext, useState, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";

interface AccessTokenContextType {
  accessToken: string | null;
  consentNeeded: boolean;
  loginNeeded: boolean;
  refreshAccessToken: () => Promise<{ success: boolean; token?: string; error?: string }>;
  doConsent: () => Promise<void>;
  doLogin: () => Promise<void>;
  errorType: string | null;
}

const AccessTokenContext = createContext<AccessTokenContextType>({
  accessToken: null,
  consentNeeded: false,
  loginNeeded: false,
  refreshAccessToken: async () => ({ success: false }),
  doConsent: async () => {},
  doLogin: async () => {},
  errorType: null,
});

export const AccessTokenProvider = ({ children }: { children: React.ReactNode }) => {
  const {
    getAccessTokenSilently,
    getAccessTokenWithPopup,
    loginWithPopup,
    isAuthenticated,
  } = useAuth0();

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [consentNeeded, setConsentNeeded] = useState(false);
  const [loginNeeded, setLoginNeeded] = useState(false);
  const [errorType, setErrorType] = useState<string | null>(null);

  // Called after backend says "token invalid/expired"
  const refreshAccessToken = useCallback(async () => {
    setConsentNeeded(false);
    setLoginNeeded(false);
    setErrorType(null);
    try {
      const token = await getAccessTokenSilently();
      // Successfully got a new token. Clear any previous errors.
      setAccessToken(token);
      setLoginNeeded(false);
      setConsentNeeded(false);
      setErrorType(null);
      return { success: true, token };
    } catch (e: unknown) {
      const error = e as { error?: string };
      /* TODO: we might not always need to login again, sometimes we can just ask for consent.
      But we need to ensure that popup works with the Word API.
      */
      if (true /*error.error === "consent_required" || error.error === "missing_refresh_token"*/) {
          setLoginNeeded(true);
          setErrorType("login_required");
        } else if (error.error === "login_required") {
          setConsentNeeded(true);
          setErrorType("consent_required");
      }
      setAccessToken(null);
      return { success: false, error: error.error };
    }
  }, [getAccessTokenSilently]);

  // UI calls this after user clicks "Allow Access"
  // TODO: make sure this works with the Word API
  const doConsent = useCallback(async () => {
    await getAccessTokenWithPopup();
    setConsentNeeded(false);
    setErrorType(null);
    await refreshAccessToken();
  }, [getAccessTokenWithPopup, refreshAccessToken]);

  // UI calls this after user clicks "Log in again"
  const doLogin = useCallback(async () => {
    // TODO: remove this, we're depending on the caller to call the correct login method
    await loginWithPopup();
    setLoginNeeded(false);
    setErrorType(null);
    await refreshAccessToken();
  }, [loginWithPopup, refreshAccessToken]);

  React.useEffect(() => {
    if (isAuthenticated) {
      refreshAccessToken();
    }
  }, [isAuthenticated, refreshAccessToken]);

  return (
    <AccessTokenContext.Provider
      value={{
        accessToken,
        consentNeeded,
        loginNeeded,
        refreshAccessToken,
        doConsent,
        doLogin,
        errorType,
      }}
    >
      {children}
    </AccessTokenContext.Provider>
  );
};

export const useAccessToken = () => useContext(AccessTokenContext);