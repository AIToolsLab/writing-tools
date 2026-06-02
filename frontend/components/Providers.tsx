'use client';

import { PostHogErrorBoundary, PostHogProvider } from '@posthog/react';
import { Button, Reshaped } from 'reshaped';
import 'reshaped/themes/slate/theme.css';
import ChatContextWrapper from '@/contexts/chatContext';

// PostHog configuration - project token is safe to commit publicly
const POSTHOG_KEY = 'phc_p3Br0zRnw7PdTVpdNI92vvBTWcBBY0jvkHO8dNvkCTl';
const POSTHOG_HOST = 'https://e.thoughtful-ai.com/';

function PostHogErrorFallback() {
	return (
		<div style={{ padding: '20px', textAlign: 'center' }}>
			<h2>Something went wrong</h2>
			<p>An error has been logged. Please refresh the page.</p>
			<Button color="primary" variant="solid" onClick={() => window.location.reload()}>
				Refresh
			</Button>
		</div>
	);
}

// App-wide client providers: analytics (PostHog), the Reshaped theme, and the chat
// message context that persists across tab switches. (Jotai's Provider lives in the root
// layout.)
export default function Providers({ children }: { children: React.ReactNode }) {
	return (
		<PostHogProvider
			apiKey={POSTHOG_KEY}
			options={{
				api_host: POSTHOG_HOST,
				capture_exceptions: true,
			}}
		>
			<PostHogErrorBoundary fallback={<PostHogErrorFallback />}>
				<ChatContextWrapper>
					<Reshaped theme="slate">{children}</Reshaped>
				</ChatContextWrapper>
			</PostHogErrorBoundary>
		</PostHogProvider>
	);
}
