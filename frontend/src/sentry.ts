import * as Sentry from '@sentry/react';

// Initialize Sentry for error tracking
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;

if (SENTRY_DSN) {
	Sentry.init({
		dsn: SENTRY_DSN,
		integrations: [
			Sentry.browserTracingIntegration(),
			Sentry.replayIntegration(),
		],
		tracesSampleRate: 0.1, // Sample 10% of transactions for performance monitoring
		replaysSessionSampleRate: 0.1, // Sample 10% of sessions for replay
		replaysOnErrorSampleRate: 1.0, // Always capture replays for sessions with errors
		environment: import.meta.env.MODE || 'development',
	});
	console.log('Sentry SDK initialized for error tracking');
} else {
	console.log('Sentry DSN not found - error tracking disabled');
}
