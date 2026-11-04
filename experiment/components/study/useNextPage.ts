'use client';

import { useSearchParams } from 'next/navigation';
import { getNextPage } from '@/lib/studyConfig';
import { studyParamsAtom } from '@/contexts/StudyContext';
import { useAtomValue } from 'jotai';

/**
 * The URL for the next page in the study sequence, preserving the current query parameters but updating `page`.
 *
 * The returned URL is relative (e.g. `/study?username=...&page=intro`). Pages
 * that need an absolute URL (e.g. ConsentPage's external redirect) can wrap it
 * with `new URL(nextUrl, window.location.origin)`.
 */
export function useNextPageUrl() {
  const searchParams = useSearchParams();
  const { page } = useAtomValue(studyParamsAtom);
  const params = new URLSearchParams(searchParams.toString());
  params.set('page', getNextPage(page)!);
  return `/study?${params.toString()}`;
}
