'use client';

import { useEffect, useState } from 'react';
import { EditorContext } from '@/lib/contexts/editorContext';
import { wordEditorAPI } from '@/lib/wordEditorAPI';

/**
 * Taskpane layout with Office.js initialization
 * This layout wraps all taskpane pages and ensures Office.js is ready
 */
export default function TaskpaneLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOfficeReady, setIsOfficeReady] = useState(false);
  const [officeError, setOfficeError] = useState<string | null>(null);

  useEffect(() => {
    // Check if Office.js is available
    if (typeof Office === 'undefined') {
      setOfficeError('Office.js is not loaded. This page must be loaded within Microsoft Office.');
      return;
    }

    // Wait for Office.js to initialize
    Office.onReady((info) => {
      if (info.host === Office.HostType.Word) {
        setIsOfficeReady(true);
      } else {
        setOfficeError(`This add-in requires Microsoft Word. Current host: ${info.host}`);
      }
    });
  }, []);

  if (officeError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-red-50">
        <div className="text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-red-800 mb-2">Office.js Error</h1>
          <p className="text-red-700">{officeError}</p>
        </div>
      </div>
    );
  }

  if (!isOfficeReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Office Add-in...</p>
        </div>
      </div>
    );
  }

  return (
    <EditorContext.Provider value={wordEditorAPI}>
      <div className="min-h-screen bg-white">
        {children}
      </div>
    </EditorContext.Provider>
  );
}
