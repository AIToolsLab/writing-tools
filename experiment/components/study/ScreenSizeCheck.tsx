'use client';

import { useEffect, useState } from 'react';
import { checkScreenSize } from '@/lib/browserMetadata';
import { MIN_SCREEN_HEIGHT, MIN_SCREEN_WIDTH } from '@/lib/studyConfig';

interface ScreenSizeCheckProps {
  children: React.ReactNode;
}

export default function ScreenSizeCheck({ children }: ScreenSizeCheckProps) {
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const check = checkScreenSize();
    setIsValid(check.valid);
    if (!check.valid) {
      setErrorMessage(
        check.reason ||
          'Your screen size is not compatible with this study.'
      );
    }
  }, []);

  if (isValid === null) {
    return <div className="p-4">Checking system requirements...</div>;
  }

  if (!isValid) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h2 className="text-2xl font-bold text-red-600 mb-4">
            System Requirements Not Met
          </h2>
          <p className="text-gray-700 mb-6">{errorMessage}</p>
          <div className="bg-blue-50 p-4 rounded mb-6">
            <p className="text-sm font-semibold mb-2">
              Minimum requirements:
            </p>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>Screen resolution: {MIN_SCREEN_WIDTH}x{MIN_SCREEN_HEIGHT} or larger</li>
              <li>Desktop or laptop computer (no mobile devices)</li>
              <li>Modern web browser with JavaScript enabled</li>
            </ul>
          </div>
          <p className="text-sm text-gray-600">
            Please try again with a compatible device or window size.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
