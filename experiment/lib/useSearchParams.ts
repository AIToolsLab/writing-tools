import { useRouterState } from '@tanstack/react-router'

/**
 * Compatibility hook that provides a URLSearchParams interface similar to Next.js's useSearchParams.
 * Reads search params from TanStack Router state reactively.
 */
export function useSearchParams(): URLSearchParams {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  return new URLSearchParams(searchStr)
}
