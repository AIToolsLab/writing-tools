'use client';

import { useSyncExternalStore } from 'react';
import { getLogStatus, getServerLogStatus, subscribeLogStatus } from '@/lib/logging';

/**
 * Explains why the study isn't advancing when a page transition is blocked
 * on failing log uploads. Renders nothing otherwise.
 */
export default function LogStatusBanner() {
  const { redirectPending, failing } = useSyncExternalStore(
    subscribeLogStatus,
    getLogStatus,
    getServerLogStatus
  );
  if (!redirectPending || !failing) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[100] bg-amber-100 border-b border-amber-400 px-4 py-3 text-center text-amber-900"
    >
      We&apos;re having trouble saving your responses. Please check your internet connection
      and keep this page open; you&apos;ll continue automatically once everything is saved.
    </div>
  );
}
