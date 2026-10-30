'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { getNextPage } from '@/lib/studyConfig';

/**
 * Returns a function that builds the URL for the next page in the study
 * sequence, preserving the current query parameters but updating `page`.
 *
 * The returned URL is relative (e.g. `/study?username=...&page=intro`). Pages
 * that need an absolute URL (e.g. ConsentPage's external redirect) can wrap it
 * with `new URL(getNextUrl(), window.location.origin)`.
 */
export function useNextPage(currentPage: string) {
  const searchParams = useSearchParams();

  return useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', getNextPage(currentPage)!);
    return `/study?${params.toString()}`;
  }, [searchParams, currentPage]);
}
