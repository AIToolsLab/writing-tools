'use client';

import { useEffect } from 'react';

/**
 * Office ribbon command handler
 * This page handles commands triggered from the Office ribbon
 */
export default function CommandsPage() {
  useEffect(() => {
    if (typeof Office === 'undefined') return;

    Office.onReady(() => {
      // Register command handlers
      Office.actions.associate('ShowTaskpane', () => {
        // Show the taskpane
        Office.addin.showAsTaskpane();
      });
    });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-600">Office command handler loaded</p>
    </div>
  );
}
