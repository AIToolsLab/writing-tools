import { createContext, useContext, useState, useMemo } from 'react';

interface AccessTokenContextType {
	// Called by the API code to get an access token
	getAccessToken: () => Promise<string>;
	// Called by the API code to report an auth-related error from the backend
	reportAuthError: (error: {error: string}) => void;
	// Stores the error type if an error occurs
	authErrorType: string | null;
}

const AccessTokenContext = createContext<AccessTokenContextType>({
	getAccessToken: () => {
		console.warn('getAccessToken called before provider is initialized');
		return Promise.resolve('');
	},
	reportAuthError: () => {
		console.warn('reportAuthError called before provider is initialized');
	},
	authErrorType: null,
});

interface AccessTokenProviderProps {
	children: React.ReactNode;
	getAccessTokenSilently: () => Promise<string>;
}

export function AccessTokenProvider({
	children,
	getAccessTokenSilently,
}: AccessTokenProviderProps) {
	const [authErrorType, setAuthErrorType] = useState<string | null>(null);

	const contextValue = useMemo(() => ({
		getAccessToken: async () => {
			try {
				const token = await getAccessTokenSilently();
				setAuthErrorType(null); // Clear any previous error
				return token;
			} catch (e: unknown) {
				const error = e as {error: string};
				setAuthErrorType(error.error);
				// reraise the error to be handled by the caller
				throw e;
			}
		},
		reportAuthError: (error: {error: string}) => {
			setAuthErrorType(error.error);
		},
		authErrorType,
	}), [getAccessTokenSilently, authErrorType]);

	return (
		<AccessTokenContext.Provider value={contextValue}>
			{children}
		</AccessTokenContext.Provider>
	);
}

export const useAccessToken = () => useContext(AccessTokenContext);
