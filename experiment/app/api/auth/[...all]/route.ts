/**
 * Required Better Auth handler. Mounts the Better Auth API at /api/auth/*.
 * Even though no auth features are in use, this route must exist for
 * Better Auth to initialise correctly.
 */
import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth);
