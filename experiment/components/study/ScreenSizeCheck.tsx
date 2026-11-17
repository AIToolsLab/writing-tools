'use client';

import { useSyncExternalStore } from 'react';
import { checkScreenSize } from '@/lib/browserMetadata';
import { MIN_SCREEN_HEIGHT, MIN_SCREEN_WIDTH } from '@/lib/studyConfig';

interface ScreenSizeCheckProps {
  children: React.ReactNode;
}

type ScreenSizeState = { width: number; height: number } | null;

let cachedSnapshot: ScreenSizeState = null;

function getSnapshot(): ScreenSizeState {
  const next: ScreenSizeState = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  if (
    cachedSnapshot === null ||
    cachedSnapshot.width !== next.width ||
    cachedSnapshot.height !== next.height
  ) {
    cachedSnapshot = next;
  }
  return cachedSnapshot;
}

function getServerSnapshot(): ScreenSizeState {
  return null;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

export default function ScreenSizeCheck({ children }: ScreenSizeCheckProps) {
  const size = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (size === null) {
    return <div className="p-4">Checking system requirements...</div>;
  }

  const check = checkScreenSize(size.width, size.height);

  if (!check.valid) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md">
          <h2 className="text-2xl font-bold text-red-600 mb-4">
            System Requirements Not Met
          </h2>
          <p className="text-gray-700 mb-6">
            {check.reason ||
              'Your screen size is not compatible with this study.'}
          </p>
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
