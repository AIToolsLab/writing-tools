'use client';

import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

/**
 * Auth0 popup callback page
 * This page is opened in an Office dialog and communicates the result back to the parent
 */
export default function PopupPage() {
  const { isAuthenticated, isLoading, error, loginWithRedirect } = useAuth0();

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      // Send success message to parent window (Office dialog)
      if (typeof Office !== 'undefined' && Office.context?.ui?.messageParent) {
        Office.context.ui.messageParent('success');
      } else if (window.opener) {
        // Fallback for non-Office environments
        window.opener.postMessage('auth-success', window.location.origin);
        window.close();
      }
    } else if (error) {
      console.error('Auth error:', error);
      if (typeof Office !== 'undefined' && Office.context?.ui?.messageParent) {
        Office.context.ui.messageParent('error');
      }
    } else {
      // Not authenticated yet, trigger login
      loginWithRedirect({
        authorizationParams: {
          redirect_uri: window.location.href,
        },
      });
    }
  }, [isAuthenticated, isLoading, error, loginWithRedirect]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        {isLoading && (
          <>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Authenticating...</p>
          </>
        )}
        {error && (
          <>
            <div className="text-6xl mb-4">⚠️</div>
            <p className="text-red-600">Authentication failed</p>
            <p className="text-sm text-gray-600 mt-2">{error.message}</p>
          </>
        )}
        {isAuthenticated && (
          <>
            <div className="text-6xl mb-4">✓</div>
            <p className="text-green-600">Authentication successful</p>
          </>
        )}
      </div>
    </div>
  );
}
