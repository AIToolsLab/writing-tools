import { betterAuth } from 'better-auth';

/**
 * Better Auth instance used solely for rate limiting.
 * No authentication features are enabled — the auth handler at
 * /api/auth/[...all] is required boilerplate for Better Auth to initialise.
 *
 * Rate limiting works by passing a bodyless probe request through
 * auth.handler() at the top of each protected route. Better Auth tracks
 * requests per IP using the customRules below and returns 429 when the
 * limit is exceeded, including an X-Retry-After header.
 */
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-secret',
  rateLimit: {
    enabled: true,
    window: 60,  // seconds
    max: 100,    // default limit (not used — customRules override per-path)
    customRules: {
      // Allow up to 20 suggestion requests per IP per minute
      '/api/writing-support': { window: 60, max: 20 },
    },
  },
});
