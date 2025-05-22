import { useAuth0 } from '@auth0/auth0-react';
import { createContext, useContext, useState } from 'react';

interface AccessTokenContextType {
    // Called by the API code to get an access token
    getAccessToken: () => Promise<string>;
    // Called by the API code to report an auth-related error from the backend
    reportAuthError: (error: any) => void;
    // Stores the error type if an error occurs
    authErrorType: string | null;
}

const AccessTokenContext = createContext<AccessTokenContextType>({
  getAccessToken: async () => {
    // eslint-disable-next-line no-console
    console.warn('getAccessToken called before provider is initialized');
    return '';
  },
  reportAuthError: () => {
    // eslint-disable-next-line no-console
    console.warn('reportAuthError called before provider is initialized');
  },
  authErrorType: null,
});

export function AccessTokenProvider({ children }: { children: React.ReactNode }) {
  const {
    getAccessTokenSilently,
  } = useAuth0();

  const [authErrorType, setAuthErrorType] = useState<string | null>(null);

  return (
    <AccessTokenContext.Provider
      value={ {
        getAccessToken: async () => {
            try {
                const token = await getAccessTokenSilently();
                setAuthErrorType(null); // Clear any previous error
                return token;
            }
 catch (e: any) {
                setAuthErrorType(e.error);
                // reraise the error to be handled by the caller
                throw e;
            }
        },
        reportAuthError: (error: any) => {
            setAuthErrorType(error.error);
        },
        authErrorType: authErrorType,
      } }
    >
      { children }
    </AccessTokenContext.Provider>
  );
}

export const useAccessToken = () => useContext(AccessTokenContext);
