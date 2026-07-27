/**
 * @format
 */

import { type ModelMessage } from 'ai';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Remark } from 'react-remark';
import {
	AiOutlineFileText,
	AiOutlineBulb,
	AiOutlineProject,
	AiOutlineCompass,
	AiOutlineLink,
	AiOutlineStar,
	AiOutlineBook,
	AiOutlineMessage,
	AiOutlineSwap,
	AiOutlinePlus,
	AiOutlineThunderbolt,
	AiOutlineEdit,
	AiOutlineQuestionCircle
} from 'react-icons/ai';
import { isRunningInGoogleDocs } from '@/api';
import {
	describeGenerationError,
	type GenerationErrorInfo,
} from '@/api/errors';
import { streamTextDeltas } from '@/api/generate';
import { reviseLog } from '@/api/logging';
import { languageModel, openaiProviderOptions } from '@/api/openai';
import { GenerationErrorNotice, ErrorNotice } from '@/components/errorNotice';
import BriefSection from '@/components/briefSection';
import {
	type DocBrief,
	formatDocBriefForPrompt,
	useDocBrief,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
import { useLog } from '@/hooks/useLog';
import { useDocContext } from '@/utilities';
import TagLinker from '../tag-linker';
import { jumpToDocText, parseDocTextHref } from './docTextJump';
import classes from './styles.module.css';

interface Prompt {
	keyword: string;
	prompt: string;
	isOverall?: boolean;
	icon?: React.ComponentType;
	category?: 'structure' | 'content' | 'analysis';
}

const promptList: Prompt[] = [
	{
		keyword: 'Hierarchical Outline',
		prompt: 'Create a hierarchical outline of the document.',
		isOverall: true,
		icon: AiOutlineFileText,
		category: 'structure',
	},
	{
		keyword: 'Inspirational Exemplar',
		prompt: "Imagine an exemplar document with a similar rhetorical situation to this document (e.g., that might be published in the same venue) but a different specific message. Suppose that the document was written exceptionally well, by a famous author. What would that document look like? Provide a two-level *outline* of that exemplar document. For each outline point, provide (1) a short quote from the imagined exemplar and (2) a reference (in link format) to similar material in the actual writer's current (provided) document. If the writer's document does not yet contain a section that corresponds to the imagined exemplar section, reference a part of the document that it could be added near.",
		isOverall: true,
		icon: AiOutlineBulb,
		category: 'structure',
	},
	{
		keyword: "Possible Structure",
		prompt: 'Imagine 3 possible overall structures for this document. For each structure, provide a short description of the structure and then a two-level outline of the structure. For each outline point, provide a reference (in link format) to material in the writer\'s current (provided) document that could be used as a starting point for that section.',
		isOverall: true,
		icon: AiOutlineProject,
		category: 'structure',
	},
	{
		keyword: 'Where to Work Next',
		prompt: 'List 7 places in the document that the writer could direct their attention to next. Respond with a Markdown list, most important first, where each item contains a doctext link to a specific part of the document, followed by a very short description of what aspect of that location could use attention. Include both places that the author has explicitly labeled as needing work (e.g., using TODO, brackets, all-caps, or other markers) and places that were not explicitly labeled but that could use work based on the content.',
		isOverall: true,
		icon: AiOutlineCompass,
		category: 'structure',
	},
	{
		keyword: "Related parts",
		prompt: "Consider the part of the document near the cursor. List other parts of the document that are related to this part. Organize the list by type of relationship.",
		isOverall: true,
		icon: AiOutlineLink,
		category: 'structure',
	},
	{
		keyword: 'Main Point',
		prompt: 'List the main points that the writer is making.',
		icon: AiOutlineStar,
		category: 'content',
	},
	{
		keyword: 'Important Concepts',
		prompt: 'List the most important concepts.',
		icon: AiOutlineBook,
		category: 'content',
	},
	{
		keyword: 'Claims and Arguments',
		prompt: 'List the claims or arguments presented.',
		icon: AiOutlineMessage,
		category: 'analysis',
	},
	{
		keyword: 'Counterarguments',
		prompt: 'List potential counterarguments to the claims presented.',
		icon: AiOutlineSwap,
		category: 'analysis',
	},
	{
		keyword: 'Further Evidence',
		prompt: 'List further evidence or examples you would like to see to support the claims presented.',
		icon: AiOutlinePlus,
		category: 'analysis',
	},
	{
		keyword: 'Outside the Box',
		prompt: 'List outside-the-box questions or ideas that are directly related to this text.',
		icon: AiOutlineThunderbolt,
		category: 'analysis',
	},
	{
		keyword: 'Questions Addressed by Writer',
		prompt: 'List questions that the writer seems to be addressing in this text.',
		icon: AiOutlineEdit,
		category: 'analysis',
	},
	{
		keyword: 'Questions a Reader Might Have',
		prompt: 'List questions that a reader might have about this text.',
		icon: AiOutlineQuestionCircle,
		category: 'analysis',
	},
];

const systemPrompt = `\
We are powering a tool that is designed to help people write thoughtfully, with full cognitive engagement in their work, thinking about their complete rhetorical situation.

The user is currently in a "visualization" part of the tool, where the tool promises to help the writer visualize their document to help them understand what points they are making, what their current structure is, what are the concepts and relationships in their document, and many other possible visualizations. The appropriate visualization will depend on the document, the writer, and the context.

Our response MUST reference specific parts of the document. We use Markdown links to reference document text: [link text](link target). Guidelines:

- The **link target** (example: doctext:A%20short%20quote%20from%20the%20document) must:
  - be present
  - start with "doctext:"
  - be a short URL-component-encoded verbatim quote from the document text
  - must not exceed 240 characters
  - must be taken from a single line of the source text
  - must not be surrounded by quotation marks
- The **link text** should be a short (under 6 words) *description* of the link target, such as "second paragraph of Introduction" or "first time concept __ is introduced".

When generating a visualization, it is critical that we remain faithful to the document provided. If we ever realize that we've deviated from the document text, even slightly, we must include a remark to that effect in [square brackets] as soon as possible after the deviation.`;


function getDocTextAsPrompt(
	docContext: DocContext,
	brief: DocBrief,
	contextChars = 100,
) {
	let prompt = ``;

	// The writer's brief comes first: it frames how to read everything below it.
	const briefBlock = formatDocBriefForPrompt(brief);
	if (briefBlock) {
		prompt += `${briefBlock}\n\n`;
	}

	if (docContext.contextData && docContext.contextData.length > 0) {
		const contextSections = docContext.contextData.map(section => {
			return `<context title="${section.title}">\n${section.content}</context>`;
		}).join("\n\n");
		prompt += `<additional-context><!-- Note: will *not* be visible to the reader of the document -->\n\n${contextSections}</additional-context>`;
	}

	prompt += `<writer-doc-so-far>
${docContext.beforeCursor}${docContext.selectedText}${docContext.afterCursor}
</writer-doc-so-far>
`;

	const beforeCursorTrim = docContext.beforeCursor.slice(-contextChars);
	const afterCursorTrim = docContext.afterCursor.slice(0, contextChars);
	if (docContext.selectedText === '') {
		prompt += `\n\n## Text Right Before the Cursor\n\n"${beforeCursorTrim}"`;
	} else {
		prompt += `\n\n## Current Selection\n\n${docContext.selectedText}`;
		prompt += `\n\n## Text Nearby The Selection\n\n"${beforeCursorTrim}${docContext.selectedText}${afterCursorTrim}"`;
	}
	return prompt;
}

class Visualization {
	response: string;
	id: string;
	references: string[] = [];
	/** Set when the generation failed; rendered in place of a result. */
	error: GenerationErrorInfo | null = null;
	/** False until the stream ends, so the panel can show per-feature progress. */
	done = false;

	constructor(
		public prompt: string,
		public docContext: DocContext,
		/** The feature this came from — for the result's label and its Retry. */
		public feature: Prompt,
	) {
		this.prompt = prompt;
		this.docContext = docContext;
		this.response = '';
		// Counter, not a timestamp: features run back-to-back and two created in
		// the same millisecond would collide as React keys (an immediate failure
		// takes almost no time at all).
		this.id = `viz-${++visualizationCounter}`;
	}
}

let visualizationCounter = 0;

/**
 * State of the one in-flight jump, shared with every rendered doctext link.
 *
 * Clicking a link is not instant — on the Google Docs surface finding and
 * selecting the quoted text is an Apps Script round-trip — so the link that was
 * clicked has to say so, or the click reads as a dead link and the writer
 * clicks again. Passing this through context (rather than closing over it) is
 * what lets the anchor component be defined once at module scope: `<Remark>`
 * re-parses and remounts its output whenever the component identity it is given
 * changes, which would throw away the result the writer is reading.
 */
interface DocJump {
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
			className={`text-blue-500 hover:underline ${classes.docLink} ${
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
			 * Decoration only: what a screen reader hears comes from the one
			 * live region in the result panel, which is in the DOM before the
			 * jump starts. A live region inserted at the same moment its text
			 * appears is not reliably announced.
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

export default function Revise() {
	const editorAPI = useContext(EditorContext);
	const {
		docContext,
		isLoading: docContextLoading,
		refresh: refreshDocContext,
	} = useDocContext(editorAPI);
	const log = useLog();
	const activeRequestControllerRef = useRef<AbortController | null>(null);
	const [_loading, setLoading] = useState(false);
	const [_customPrompts, _setCustomPrompts] = useState<Prompt[]>([]);
	const [_selectedCustomPrompt, _setSelectedCustomPrompt] = useState<
		number | null
	>(null);
	const [visualizations, setVisualizations] = useState<Visualization[]>([]);
	const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
	const { brief } = useDocBrief();
	const [isRunning, setIsRunning] = useState(false);
	const [pendingHref, setPendingHref] = useState<string | null>(null);
	const [failedHref, setFailedHref] = useState<string | null>(null);
	// Only the newest click owns the shared pending/failed state; an earlier,
	// slower search must not clear the indicator out from under it.
	const jumpSeqRef = useRef(0);

	// Read at request time, like the document context is, so a run always uses
	// the brief as it stands — without rebuilding the request callbacks on every
	// keystroke in the brief section.
	const briefRef = useRef(brief);
	briefRef.current = brief;

	const handleJump = useCallback(
		(href: string) => {
			const text = parseDocTextHref(href);
			if (text === null) return;
			reviseLog.referenceClicked(log, { target: text });

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
				reviseLog.referenceResolved(log, {
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
		[editorAPI, log],
	);

	const docJump = useMemo<DocJump>(
		() => ({ onJump: handleJump, pendingHref, failedHref }),
		[handleJump, pendingHref, failedHref],
	);

	useEffect(() => {
		return () => {
			// Cleanup on unmount: stop any in-flight stream to avoid post-unmount updates.
			activeRequestControllerRef.current?.abort();
		};
	}, []);

	const requestVisualization = useCallback(
		async (prompt: Prompt) => {
			// Only one active request is allowed; cancel any previous stream first.
			activeRequestControllerRef.current?.abort();
			const requestController = new AbortController();
			activeRequestControllerRef.current = requestController;

			const request = prompt.isOverall
				? prompt.prompt
				: `Go part-by-part through the document. For each part, please do the following: ${prompt.prompt}`;

			// Pull the current document context at request time rather than
			// tracking it continuously.
			const currentContext = await refreshDocContext();

			const newViz = new Visualization(request, currentContext, prompt);
			setVisualizations((prev) => [...prev, newViz]);

			reviseLog.visualizationRequested(log, {
				feature: prompt.keyword,
				isOverall: Boolean(prompt.isOverall),
				docContext: currentContext,
			});

			const docTextAsPrompt = getDocTextAsPrompt(currentContext, briefRef.current);

			const messages: ModelMessage[] = [
				{
					role: 'user',
					content: `${docTextAsPrompt}

<request>
${request}
</request>`,
				},
			];

			setLoading(true);

			// Re-publish the (mutated) visualization so React re-renders it.
			const publish = () => {
				setVisualizations((prev) => {
					const updated = [...prev];
					const index = updated.findIndex((v) => v.id === newViz.id);
					if (index !== -1) {
						updated[index] = newViz;
					}
					return updated;
				});
			};

			try {
				const deltas = streamTextDeltas({
					model: languageModel,
					providerOptions: openaiProviderOptions,
					instructions: systemPrompt,
					messages,
					maxOutputTokens: 5000,
					abortSignal: requestController.signal,
				});

				for await (const delta of deltas) {
					newViz.response += delta;
					publish();
				}

				newViz.done = true;
				publish();
				reviseLog.visualizationCompleted(log, {
					feature: prompt.keyword,
					response: newViz.response,
				});
			} catch (err) {
				if (requestController.signal.aborted) {
					return;
				}
				const info = describeGenerationError(err);
				console.error('Error fetching visualization:', err);
				// Show the failure on the feature that failed, keeping whatever text
				// had already streamed in.
				newViz.error = info;
				newViz.done = true;
				publish();
				reviseLog.visualizationError(log, {
					feature: prompt.keyword,
					error: info.detail,
					code: info.code,
				});
			} finally {
				// Ignore stale completions from older requests that were already replaced.
				if (activeRequestControllerRef.current === requestController) {
					activeRequestControllerRef.current = null;
					setLoading(false);
				}
			}
		},
		[refreshDocContext, log],
	);

	/** Re-run one feature, dropping the card that failed so it isn't duplicated. */
	const retryVisualization = useCallback(
		(viz: Visualization) => {
			setVisualizations((prev) => prev.filter((v) => v.id !== viz.id));
			void requestVisualization(viz.feature);
		},
		[requestVisualization],
	);

	const toggleFeature = useCallback(
		(keyword: string) => {
			// Log outside the state updater — updaters must stay pure (StrictMode
			// runs them twice in dev, which would double-log).
			const selected = !selectedFeatures.includes(keyword);
			reviseLog.featureToggled(log, { feature: keyword, selected });
			setSelectedFeatures((prev) =>
				prev.includes(keyword)
					? prev.filter((f) => f !== keyword)
					: [...prev, keyword],
			);
		},
		[selectedFeatures, log],
	);

	const runSelectedFeatures = useCallback(() => {
		if (selectedFeatures.length === 0) return;

		reviseLog.featuresRun(log, { features: selectedFeatures });
		setIsRunning(true);
		const selectedPrompts = promptList.filter(p => selectedFeatures.includes(p.keyword));
		
		// For now, run them sequentially
		let index = 0;
		const runNext = async () => {
			if (index < selectedPrompts.length) {
				await requestVisualization(selectedPrompts[index]);
				index++;
				runNext();
			} else {
				setIsRunning(false);
			}
		};
		
		runNext();
	}, [selectedFeatures, requestVisualization, log]);

	// Until the first read of the document lands, "empty" is not yet knowable —
	// on the Google Docs surface that read is an Apps Script round-trip, and
	// claiming the document is empty in the meantime is both wrong and alarming.
	if (docContextLoading) {
		return (
			<div className={classes.loadingState} role="status">
				<div className={classes.loaderDots}>
					<span></span>
					<span></span>
					<span></span>
				</div>
				Reading your document…
			</div>
		);
	}

	if (
		docContext.beforeCursor.length === 0 &&
		docContext.selectedText.length === 0 &&
		docContext.afterCursor.length === 0
	) {
		return (
			<div className="text-gray-500">
				The document seems to be empty. Write something first, and this
				panel will have material to work with.
			</div>
		);
	}

	return (
		<div className={classes.app}>
			{/* Tab bar - assuming this is handled at a higher level */}

			{/* Scrollable body */}
			<div className={classes.body}>
				{/* Cross-tab helper — only meaningful in Google Docs, which has tabs */}
				{isRunningInGoogleDocs() ? <TagLinker /> : null}

				{/* Section 1: Set your brief. Lives on the document and is shared
				    with every other page — see components/briefSection. */}
				<BriefSection page="revise" step={1} defaultOpen />

				{/* Section 2: Choose features to run */}
				<div className={classes.featuresSection}>
					<div className={classes.sectionLabel}>
						<span className={classes.sectionNumber}>2</span>
						Choose features to run
					</div>

					{/* Document structure */}
					<div className={classes.featGroup}>
						<div className={classes.featGroupLabel}>Document structure</div>
						<div className={classes.featGrid}>
							{promptList
								.filter((p) => p.category === 'structure')
								.map((prompt) => (
									<button
										key={prompt.keyword}
										className={`${classes.featBtn} ${selectedFeatures.includes(prompt.keyword) ? classes.on : ''}`}
										onClick={() => toggleFeature(prompt.keyword)}
									>
										<span className={classes.featDot}></span>
										<span className={classes.featLabel}>{prompt.keyword}</span>
									</button>
								))}
						</div>
					</div>

					{/* Content analysis */}
					<div className={classes.featGroup}>
						<div className={classes.featGroupLabel}>Content analysis</div>
						<div className={classes.featGrid}>
							{promptList
								.filter((p) => p.category === 'content')
								.map((prompt) => (
									<button
										key={prompt.keyword}
										className={`${classes.featBtn} ${selectedFeatures.includes(prompt.keyword) ? classes.on : ''}`}
										onClick={() => toggleFeature(prompt.keyword)}
									>
										<span className={classes.featDot}></span>
										<span className={classes.featLabel}>{prompt.keyword}</span>
									</button>
								))}
						</div>
					</div>

					{/* Critical analysis */}
					<div className={classes.featGroup}>
						<div className={classes.featGroupLabel}>Critical analysis</div>
						<div className={classes.featGrid}>
							{promptList
								.filter((p) => p.category === 'analysis')
								.map((prompt) => (
									<button
										key={prompt.keyword}
										className={`${classes.featBtn} ${selectedFeatures.includes(prompt.keyword) ? classes.on : ''}`}
										onClick={() => toggleFeature(prompt.keyword)}
									>
										<span className={classes.featDot}></span>
										<span className={classes.featLabel}>{prompt.keyword}</span>
									</button>
								))}
						</div>
					</div>

					{/* Result panel */}
					<div className={`${classes.resultPanel} ${visualizations.length > 0 ? classes.visible : ''}`}>
						{/*
						 * Announces what a clicked document link is doing. It lives
						 * here, always mounted, so the announcement fires when the
						 * text changes rather than when the element appears.
						 */}
						<div
							className={classes.visuallyHidden}
							role="status"
							aria-live="polite"
						>
							{pendingHref
								? 'Finding that text in your document…'
								: failedHref
									? "Couldn't find that text in your document."
									: ''}
						</div>
						{isRunning ? <div className={classes.loadingState}>
								<div className={classes.loaderDots}>
									<span></span><span></span><span></span>
								</div>
								Running {selectedFeatures.length} feature{selectedFeatures.length > 1 ? 's' : ''}...
							</div> : null}
						{visualizations.map((viz, index) => {
							const lineCount = viz.response.split('\n').length;
							return (
								<div key={viz.id}>
									{index > 0 && <div style={{ borderTop: '1.5px solid var(--border)' }}></div>}
									<div className={classes.resultHeader}>
										<span className={classes.resultTag}>
											{viz.feature.keyword}
										</span>
										<span className={classes.resultMeta}>
											{viz.error
												? 'Failed'
												: `${lineCount} result${lineCount > 1 ? 's' : ''}`}
										</span>
									</div>
									<div className={classes.resultItem} style={{ animationDelay: `${index * 0.04}s` }}>
										{viz.response ? (
											<DocJumpContext.Provider value={docJump}>
												<Remark
													rehypeReactOptions={{
														components: {
															a: DocTextAnchor,
														},
													}}
												>
													{viz.response}
												</Remark>
											</DocJumpContext.Provider>
										) : null}
										{viz.error ? (
											<GenerationErrorNotice
												info={viz.error}
												title={`${viz.feature.keyword} failed`}
												onRetry={() => retryVisualization(viz)}
											/>
										) : null}
										{/* A finished-but-empty run is a real outcome, not a blank card. */}
										{!viz.error && viz.done && viz.response.trim() === '' ? (
											<ErrorNotice
												tone="info"
												title="Nothing came back"
												message="The model returned an empty response for this feature. Running it again often helps."
												onRetry={() => retryVisualization(viz)}
											/>
										) : null}
									</div>
								</div>
							);
						})}
					</div>
				</div>
			</div>

			{/* Sticky footer */}
			<div className={classes.footer}>
				<div className={classes.summaryRow}>
					{selectedFeatures.length === 0 ? (
						'Select features above to get started'
					) : (
						selectedFeatures.map(f => (
							<span key={f} className={classes.selectedTag}>{f}</span>
						))
					)}
				</div>
				<button 
					className={classes.runBtn} 
					disabled={selectedFeatures.length === 0 || isRunning}
					onClick={runSelectedFeatures}
				>
					{selectedFeatures.length > 0 
						? `Run ${selectedFeatures.length} feature${selectedFeatures.length > 1 ? 's' : ''}`
						: 'Run selected features'
					}
				</button>
			</div>
		</div>
	);
}
