/**
 * Tools page — the sidebar's launch point for external writing tools
 * (docs/tool-launcher-plan.md, Phase 1).
 *
 * A registered first-party tool runs full-page on its own origin, not inside the
 * ~350px taskpane. Launching one mints a handoff grant (a bearer token scoped to
 * that tool, plus an optional read-only document snapshot) and opens the tool in the
 * user's real browser at `…#wt_grant=<id>`; the tool exchanges the grant for its
 * token. The paste-a-URL field is for ad-hoc launches — it opens the URL directly,
 * and such a tool signs in for itself via the device flow if it needs access.
 */
import { useContext, useState } from 'react';
import { Button } from 'reshaped';
import {
	createHandoff,
	openInBrowser,
	type ToolScope,
	withGrantFragment,
} from '@/api/handoff';
import { toolsLog } from '@/api/logging';
import { EditorContext } from '@/contexts/editorContext';
import { useAppAuth } from '@/contexts/appAuthContext';
import { useLog } from '@/hooks/useLog';
import classes from './styles.module.css';

export interface FirstPartyTool {
	/** Tool client_id — must also be listed in the backend device allowlist. */
	id: string;
	name: string;
	description: string;
	/** Where the tool is hosted (its own origin). */
	url: string;
	scopes: ToolScope[];
}

/**
 * Hardcoded first-party tools (Phase 1). Each id must be registered in the
 * backend's BETTER_AUTH_DEVICE_CLIENT_IDS allowlist, and the URL points at wherever
 * the tool is hosted. A manifest-driven registry replaces this list in a later phase.
 */
export function resolveMindmapToolUrl(
	explicit: string | undefined,
	isDevelopment: boolean,
): string {
	return (
		explicit ||
		(isDevelopment
			? 'http://localhost:5181/'
			: 'https://mindmap.thoughtful-ai.com/')
	);
}

export const MINDMAP_TOOL_URL = resolveMindmapToolUrl(
	import.meta.env.VITE_MINDMAP_TOOL_URL,
	import.meta.env.DEV,
);

export const FIRST_PARTY_TOOLS: FirstPartyTool[] = [
	{
		// Throwaway tool for exercising the handoff flow end-to-end in dev.
		// Served from sandbox/test-tool/ (see that dir's README). Remove before merge.
		id: 'test-tool',
		name: 'Platform API test tool',
		description:
			'Dev-only. Exchanges the handoff grant and lets you fire each Platform API v0 call (LLM proxy, log, doc re-fetch, revoke).',
		url: 'http://localhost:4000/',
		scopes: ['openai:chat', 'log:write', 'doc:read'],
	},
	{
		id: 'mindmap',
		name: 'Mindmap',
		description:
			'Explore your draft as a client-side mindmap. Opens in your browser with a read-only snapshot of your current document.',
		url: MINDMAP_TOOL_URL,
		scopes: ['openai:chat', 'doc:read'],
	},
];

const SCOPE_LABELS: Record<ToolScope, string> = {
	'openai:chat': 'AI access',
	'log:write': 'study logging',
	'doc:read': 'read your document',
	'doc:write': 'edit your document',
};

function isLaunchableUrl(raw: string): boolean {
	try {
		const u = new URL(raw);
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

export default function Tools() {
	const { getAccessToken } = useAppAuth();
	const editorAPI = useContext(EditorContext);
	const log = useLog();

	const [busyToolId, setBusyToolId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [adhocUrl, setAdhocUrl] = useState('');

	async function launch(tool: FirstPartyTool): Promise<void> {
		setError(null);
		setBusyToolId(tool.id);
		try {
			const token = await getAccessToken();
			// Only read the document when the tool asked for it — the snapshot leaves
			// our trust boundary, so we don't gather it speculatively.
			const doc = tool.scopes.includes('doc:read')
				? await editorAPI.getDocContext()
				: undefined;
			const { grantId } = await createHandoff(token, {
				toolClientId: tool.id,
				scopes: tool.scopes,
				doc,
			});
			openInBrowser(withGrantFragment(tool.url, grantId));
			void toolsLog.toolLaunched(log, {
				tool: tool.id,
				sharedDoc: doc !== undefined,
				scopes: tool.scopes,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			setError(`Couldn't launch ${tool.name}: ${message}`);
			void toolsLog.launchError(log, { tool: tool.id, error: message });
		} finally {
			setBusyToolId(null);
		}
	}

	function launchAdhoc(): void {
		setError(null);
		if (!isLaunchableUrl(adhocUrl)) {
			setError('Enter a valid http(s) URL.');
			return;
		}
		openInBrowser(adhocUrl);
		void toolsLog.adhocOpened(log);
	}

	return (
		<div className={classes.container}>
			<p className={classes.intro}>
				Launch a writing tool in your browser. It opens under your
				account, and gets only what its listed access covers.
			</p>

			{error ? <div className={classes.error}>{error}</div> : null}

			<ul className={classes.toolList}>
				{FIRST_PARTY_TOOLS.map((tool) => (
					<li key={tool.id} className={classes.tool}>
						<div className={classes.toolHeader}>
							<span className={classes.toolName}>
								{tool.name}
							</span>
						</div>
						<p className={classes.toolDesc}>{tool.description}</p>
						<div className={classes.scopes}>
							Wants:{' '}
							{tool.scopes.map((s) => SCOPE_LABELS[s]).join(', ')}
						</div>
						<Button
							color="primary"
							variant="solid"
							loading={busyToolId === tool.id}
							disabled={busyToolId !== null}
							onClick={() => void launch(tool)}
						>
							Launch
						</Button>
					</li>
				))}
			</ul>

			<div className={classes.adhoc}>
				<label className={classes.adhocLabel} htmlFor="adhoc-url">
					Or open a tool by URL
				</label>
				<p className={classes.adhocHint}>
					Opens directly in your browser. The tool signs you in itself
					(device flow); no document is shared.
				</p>
				<div className={classes.adhocRow}>
					<input
						id="adhoc-url"
						className={classes.adhocInput}
						type="url"
						inputMode="url"
						placeholder="https://…"
						value={adhocUrl}
						onChange={(e) => setAdhocUrl(e.target.value)}
					/>
					<Button
						color="neutral"
						variant="outline"
						disabled={adhocUrl.trim() === ''}
						onClick={launchAdhoc}
					>
						Open
					</Button>
				</div>
			</div>
		</div>
	);
}
