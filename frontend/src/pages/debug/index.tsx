/**
 * Debug page — shows the document context exactly as the model receives it.
 *
 * Nothing else in the sidebar surfaces `getDocContext()`. Every page folds it
 * into a prompt and shows you the model's reply, so when the serialization is
 * wrong the only symptom is an answer that seems slightly confused about the
 * document — which is indistinguishable from the model simply being wrong.
 * That made the Google Docs Markdown mapping effectively unobservable on the
 * surface it matters most.
 *
 * This page is deliberately unstyled-looking and read-only: it is an inspection
 * window, not a feature. It works on every surface (Word, Google Docs, the
 * standalone editor), which also makes it the quickest way to compare how the
 * two editors serialize the same document.
 */
import { useCallback, useContext, useEffect, useState } from 'react';
import { Button } from 'reshaped';
import { detectPlatform } from '@/api';
import { EditorContext } from '@/contexts/editorContext';
import classes from './styles.module.css';

/**
 * Where the cursor sits, or where the selection begins and ends. Rendered into
 * the text because a caret is otherwise invisible in a `<pre>` — and "is the
 * cursor where I think it is" is most of what this page is for.
 */
const CURSOR_MARK = '⟦cursor⟧';
const SELECTION_OPEN = '⟦selection⟧';
const SELECTION_CLOSE = '⟦/selection⟧';

interface Snapshot {
	platform: string;
	documentLabel: string;
	annotated: string;
	docText: string;
	paragraphs: string[];
	capturedAt: string;
}

/** Renders the context back into one string with the cursor made visible. */
function annotate(context: DocContext): string {
	const { beforeCursor, selectedText, afterCursor } = context;
	if (selectedText) {
		return `${beforeCursor}${SELECTION_OPEN}${selectedText}${SELECTION_CLOSE}${afterCursor}`;
	}
	return `${beforeCursor}${CURSOR_MARK}${afterCursor}`;
}

export default function Debug() {
	const editorAPI = useContext(EditorContext);
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [copied, setCopied] = useState(false);

	const capture = useCallback(async () => {
		setLoading(true);
		setError(null);
		setCopied(false);
		try {
			// Sequential rather than parallel: on Google Docs each of these is an
			// Apps Script round-trip, and firing them together has them race for
			// the same execution slot.
			const context = await editorAPI.getDocContext();
			const docText = await editorAPI.getDocText();
			const paragraphs = await editorAPI.getParagraphs();

			setSnapshot({
				platform: detectPlatform(),
				documentLabel: context.documentLabel ?? '(none)',
				annotated: annotate(context),
				docText,
				paragraphs,
				capturedAt: new Date().toLocaleTimeString(),
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [editorAPI]);

	useEffect(() => {
		void capture();
	}, [capture]);

	const copy = useCallback(async () => {
		if (!snapshot) return;
		try {
			await navigator.clipboard.writeText(snapshot.docText);
			setCopied(true);
		} catch {
			// Clipboard access is blocked in some sandboxed iframes. The text is
			// on screen and selectable either way, so this is not worth an error.
			setCopied(false);
		}
	}, [snapshot]);

	return (
		<div className={classes.container}>
			<p className={classes.intro}>
				The document exactly as the model receives it. On Google Docs
				that is Markdown — headings as <code>#</code>, list items as{' '}
				<code>-</code> or <code>1.</code>
			</p>

			<div className={classes.actions}>
				<Button
					onClick={() => void capture()}
					disabled={loading}
					size="small"
				>
					{loading ? 'Reading…' : 'Refresh'}
				</Button>
				<Button
					onClick={() => void copy()}
					disabled={!snapshot}
					size="small"
					variant="ghost"
				>
					{copied ? 'Copied' : 'Copy'}
				</Button>
			</div>

			{error ? <p className={classes.error}>{error}</p> : null}

			{snapshot ? (
				<>
					<dl className={classes.facts}>
						<dt>Platform</dt>
						<dd>{snapshot.platform}</dd>
						<dt>Document</dt>
						<dd>{snapshot.documentLabel}</dd>
						<dt>Characters</dt>
						<dd>{snapshot.docText.length}</dd>
						<dt>Paragraphs</dt>
						<dd>{snapshot.paragraphs.length}</dd>
						<dt>Read at</dt>
						<dd>{snapshot.capturedAt}</dd>
					</dl>

					<section>
						<h3 className={classes.heading}>Context</h3>
						<pre className={classes.output}>
							{snapshot.annotated}
						</pre>
					</section>

					<section>
						<h3 className={classes.heading}>Paragraphs</h3>
						<ol className={classes.paragraphs}>
							{snapshot.paragraphs.map((paragraph, index) => (
								// Position is the identity here — two paragraphs can hold the
								// same text, and the list is rebuilt wholesale on every read.
								// biome-ignore lint/suspicious/noArrayIndexKey: index is the identity
								<li key={index}>
									<code>{paragraph}</code>
								</li>
							))}
						</ol>
					</section>
				</>
			) : null}
		</div>
	);
}
