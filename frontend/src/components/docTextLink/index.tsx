/**
 * Doctext links — the citations in a model reply that point at the writer's own
 * text, and jump to it when clicked.
 *
 * Revise's visualizations are built out of them; Chat cites the same way when
 * it refers to a specific passage. Everything a page needs is here: the hook
 * that owns the jump, the markdown renderer that turns `doctext:` links into
 * live ones, and the status region that announces the result.
 */
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from 'react';

import { referenceLog, type LogPage } from '@/api/logging';
import { EditorContext } from '@/contexts/editorContext';
import { useLog } from '@/hooks/useLog';
import Markdown, {
	defaultUrlTransform,
	type Components,
	type UrlTransform,
} from '@/components/markdown';
import { jumpToDocText, parseDocTextHref } from './docTextJump';
import classes from './styles.module.css';

export { jumpToDocText, parseDocTextHref } from './docTextJump';

/**
 * State of the one in-flight jump, shared with every rendered doctext link.
 *
 * Clicking a link is not instant — on the Google Docs surface finding and
 * selecting the quoted text is an Apps Script round-trip — so the link that was
 * clicked has to say so, or the click reads as a dead link and the writer
 * clicks again. Passing this through context (rather than closing over it) is
 * what lets the anchor component be defined once at module scope: React
 * remounts a subtree whose component identity changed, so an anchor rebuilt on
 * each render would throw away the result the writer is reading.
 */
export interface DocJump {
	onJump: (href: string) => void;
	/** The link currently being resolved, if any. */
	pendingHref: string | null;
	/** The link whose text could not be found on the last attempt. */
	failedHref: string | null;
}

const DocJumpContext = createContext<DocJump>({
	onJump: () => {},
	pendingHref: null,
	failedHref: null,
});

function DocTextAnchor(props: React.ComponentProps<'a'>) {
	const { href, children, ...rest } = props;
	const { onJump, pendingHref, failedHref } = useContext(DocJumpContext);
	const isPending = Boolean(href) && href === pendingHref;
	const hasFailed = Boolean(href) && href === failedHref;

	return (
		<a
			{...rest}
			href={href}
			className={`${classes.docLinkText} ${classes.docLink} ${
				isPending ? classes.docLinkPending : ''
			}`}
			aria-busy={isPending || undefined}
			onClick={(e) => {
				e.preventDefault();
				if (href) onJump(href);
			}}
		>
			{children}
			{/*
			 * Decoration only: what a screen reader hears comes from
			 * `<DocJumpStatus>`, which is in the DOM before the jump starts. A
			 * live region inserted at the same moment its text appears is not
			 * reliably announced.
			 */}
			{isPending ? (
				<span className={classes.linkSpinner} aria-hidden="true" />
			) : null}
			{hasFailed ? (
				<span className={classes.linkFailed} aria-hidden="true">
					not found in the document
				</span>
			) : null}
		</a>
	);
}

/** Defined once, at module scope, for the reason given on {@link DocJump}. */
const docTextComponents: Components = { a: DocTextAnchor };

/**
 * React Markdown's default transform allows only a safe list of schemes — http,
 * mailto and friends — and blanks out everything else, which is what keeps a
 * `javascript:` URL in model output from becoming a live link. `doctext:` is
 * ours and has to be let through, or the citations render as links that do
 * nothing when clicked. Every other scheme still goes through the default.
 */
const allowDocTextUrls: UrlTransform = (url) =>
	url.startsWith('doctext:') ? url : defaultUrlTransform(url);

/**
 * Owns the one in-flight jump for a page. `page` scopes the events it logs.
 */
export function useDocJump(page: LogPage): DocJump {
	const editorAPI = useContext(EditorContext);
	const log = useLog();
	const [pendingHref, setPendingHref] = useState<string | null>(null);
	const [failedHref, setFailedHref] = useState<string | null>(null);
	// Only the newest click owns the shared pending/failed state; an earlier,
	// slower search must not clear the indicator out from under it.
	const jumpSeqRef = useRef(0);

	const handleJump = useCallback(
		(href: string) => {
			const text = parseDocTextHref(href);
			if (text === null) return;
			referenceLog.clicked(log, page, { target: text });

			const seq = ++jumpSeqRef.current;
			setPendingHref(href);
			setFailedHref(null);
			const startedAt = Date.now();

			void (async (): Promise<void> => {
				const { found, attempts } = await jumpToDocText(
					(phrase) => editorAPI.selectPhrase(phrase),
					text,
				);

				if (!found) console.warn('Failed to select phrase:', text);
				referenceLog.resolved(log, page, {
					target: text,
					found,
					attempts,
					durationMs: Date.now() - startedAt,
				});

				// A click the writer has already replaced with another one no
				// longer owns the indicator.
				if (jumpSeqRef.current !== seq) return;
				setPendingHref(null);
				setFailedHref(found ? null : href);
			})();
		},
		[editorAPI, log, page],
	);

	return useMemo<DocJump>(
		() => ({ onJump: handleJump, pendingHref, failedHref }),
		[handleJump, pendingHref, failedHref],
	);
}

/**
 * The screen-reader announcement for a jump in progress. Render it once per
 * page, outside whatever the jump changes, so it is in the DOM before the
 * writer clicks — a live region added at the same time as its text is not
 * reliably announced.
 */
export function DocJumpStatus({ jump }: { jump: DocJump }) {
	return (
		<div
			className={classes.visuallyHidden}
			role="status"
			aria-live="polite"
		>
			{jump.pendingHref
				? 'Finding that text in your document…'
				: jump.failedHref
					? "Couldn't find that text in your document."
					: ''}
		</div>
	);
}

/**
 * Model output rendered as markdown, with `doctext:` links wired to `jump`.
 * Use this instead of `<Markdown>` wherever a reply may cite the document.
 */
export function DocTextMarkdown({
	jump,
	children,
}: {
	jump: DocJump;
	children: string;
}) {
	return (
		<DocJumpContext.Provider value={jump}>
			<Markdown
				components={docTextComponents}
				urlTransform={allowDocTextUrls}
			>
				{children}
			</Markdown>
		</DocJumpContext.Provider>
	);
}
