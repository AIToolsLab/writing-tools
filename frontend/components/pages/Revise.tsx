'use client';

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
	AiOutlineBook,
	AiOutlineBulb,
	AiOutlineCompass,
	AiOutlineEdit,
	AiOutlineFileText,
	AiOutlineLink,
	AiOutlineMessage,
	AiOutlinePlus,
	AiOutlineProject,
	AiOutlineQuestionCircle,
	AiOutlineStar,
	AiOutlineSwap,
	AiOutlineThunderbolt,
} from 'react-icons/ai';
import { Remark } from 'react-remark';
import { EditorContext } from '@/contexts/editorContext';
import type { DocContext } from '@/lib/types';
import { useDocContext } from '@/lib/useDocContext';
import classes from './Revise.module.css';

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
		prompt:
			"Imagine an exemplar document with a similar rhetorical situation to this document (e.g., that might be published in the same venue) but a different specific message. Suppose that the document was written exceptionally well, by a famous author. What would that document look like? Provide a two-level *outline* of that exemplar document. For each outline point, provide (1) a short quote from the imagined exemplar and (2) a reference (in link format) to similar material in the actual writer's current (provided) document. If the writer's document does not yet contain a section that corresponds to the imagined exemplar section, reference a part of the document that it could be added near.",
		isOverall: true,
		icon: AiOutlineBulb,
		category: 'structure',
	},
	{
		keyword: 'Possible Structure',
		prompt:
			"Imagine 3 possible overall structures for this document. For each structure, provide a short description of the structure and then a two-level outline of the structure. For each outline point, provide a reference (in link format) to material in the writer's current (provided) document that could be used as a starting point for that section.",
		isOverall: true,
		icon: AiOutlineProject,
		category: 'structure',
	},
	{
		keyword: 'Where to Work Next',
		prompt:
			'List 7 places in the document that the writer could direct their attention to next. Respond with a Markdown list, most important first, where each item contains a doctext link to a specific part of the document, followed by a very short description of what aspect of that location could use attention. Include both places that the author has explicitly labeled as needing work (e.g., using TODO, brackets, all-caps, or other markers) and places that were not explicitly labeled but that could use work based on the content.',
		isOverall: true,
		icon: AiOutlineCompass,
		category: 'structure',
	},
	{
		keyword: 'Related parts',
		prompt:
			'Consider the part of the document near the cursor. List other parts of the document that are related to this part. Organize the list by type of relationship.',
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
		prompt:
			'List further evidence or examples you would like to see to support the claims presented.',
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

class Visualization {
	response: string;
	id: string;
	references: string[] = [];

	constructor(
		public prompt: string,
		public docContext: DocContext,
	) {
		this.prompt = prompt;
		this.docContext = docContext;
		this.response = '';
		this.id = Date.now().toString();
	}
}

export default function Revise() {
	const editorAPI = useContext(EditorContext);
	const docContext = useDocContext(editorAPI);
	const activeRequestControllerRef = useRef<AbortController | null>(null);
	const [visualizations, setVisualizations] = useState<Visualization[]>([]);
	const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
	const [audience, setAudience] = useState('');
	const [guardrails, setGuardrails] = useState('');
	const [comments, setComments] = useState('');
	const [isRunning, setIsRunning] = useState(false);

	const clickCallbackRef = useRef((href: string) => {
		if (href.startsWith('doctext:')) {
			const text = decodeURIComponent(href.slice('doctext:'.length));
			(async () => {
				let currentlySearchingForText = text;
				while (currentlySearchingForText.length > 0) {
					try {
						await editorAPI.selectPhrase(currentlySearchingForText);
						return;
					} catch {
						// If selection fails, trim off a word on each side.
						const nextSearchText = currentlySearchingForText.split(' ').slice(1, -1).join(' ');
						if (nextSearchText === currentlySearchingForText) {
							// If trimming didn't change the text, break to avoid infinite loop.
							break;
						}
						currentlySearchingForText = nextSearchText;
						console.warn('Falling back to shorter text:', currentlySearchingForText);
					}
				}
				console.warn('Failed to select phrase:', text);
			})();
		}
	});
	// Stable anchor renderer for react-remark; reads the click handler from a ref at click
	// time (event handler), so the ref is never read during render.
	const AnchorWithCallback = useMemo(
		() =>
			function Anchor(props: React.ComponentProps<'a'>) {
				const { href, children, ...rest } = props;
				return (
					<a
						{...rest}
						href={href}
						className="text-blue-500 hover:underline"
						onClick={(e) => {
							e.preventDefault();
							if (href) clickCallbackRef.current?.(href);
						}}
					>
						{children}
					</a>
				);
			},
		[],
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

			const newViz = new Visualization(request, docContext);
			setVisualizations((prev) => [...prev, newViz]);

			try {
				// The model call now happens server-side; read the streamed text deltas.
				const response = await fetch('/api/revise', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ docContext, request }),
					signal: requestController.signal,
				});

				if (!response.ok || !response.body) {
					throw new Error(`Request failed with status ${response.status}`);
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					newViz.response += decoder.decode(value, { stream: true });
					setVisualizations((prev) => {
						const updated = [...prev];
						const index = updated.findIndex((v) => v.id === newViz.id);
						if (index !== -1) {
							updated[index] = newViz;
						}
						return updated;
					});
				}
			} catch (err) {
				if (requestController.signal.aborted) {
					return;
				}
				console.error('Error fetching visualization:', err);
			} finally {
				// Ignore stale completions from older requests that were already replaced.
				if (activeRequestControllerRef.current === requestController) {
					activeRequestControllerRef.current = null;
				}
			}
		},
		[docContext],
	);

	const toggleFeature = useCallback((keyword: string) => {
		setSelectedFeatures((prev) =>
			prev.includes(keyword) ? prev.filter((f) => f !== keyword) : [...prev, keyword],
		);
	}, []);

	const runSelectedFeatures = useCallback(() => {
		if (selectedFeatures.length === 0) return;

		setIsRunning(true);
		const selectedPrompts = promptList.filter((p) => selectedFeatures.includes(p.keyword));

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
	}, [selectedFeatures, requestVisualization]);

	if (
		docContext.beforeCursor.length === 0 &&
		docContext.selectedText.length === 0 &&
		docContext.afterCursor.length === 0
	) {
		return (
			<div className="text-gray-500">
				The document seems to be empty. Either you haven&apos;t written anything yet, or the
				text is still loading.
			</div>
		);
	}

	return (
		<div className={classes.app}>
			{/* Scrollable body */}
			<div className={classes.body}>
				{/* Section 1: Set your to-do */}
				<div className={classes.todoSection}>
					<div className={classes.sectionLabel}>
						<span className={classes.sectionNumber}>1</span>
						Set your to-do
					</div>

					<div className={classes.block}>
						<div className={classes.blockHead}>
							<div className={classes.blockTitle}>Audience</div>
							<div className={classes.blockHint}>Who are you writing this for?</div>
						</div>
						<textarea
							id="audienceInput"
							rows={2}
							placeholder="e.g. First-year college students with no background in the topic..."
							value={audience}
							onChange={(e) => setAudience(e.target.value)}
						/>
					</div>

					<div className={classes.block}>
						<div className={classes.blockHead}>
							<div className={classes.blockTitle}>Guardrails</div>
							<div className={classes.blockHint}>What should the AI avoid or preserve?</div>
						</div>
						<textarea
							id="guardrailInput"
							rows={2}
							placeholder="e.g. Don't change the opening paragraph, keep it under 400 words..."
							value={guardrails}
							onChange={(e) => setGuardrails(e.target.value)}
						/>
					</div>

					<div className={classes.block}>
						<div className={classes.blockHead}>
							<div className={classes.blockTitle}>Additional comments</div>
							<div className={classes.blockHint}>
								Anything else the AI should know before running?
							</div>
						</div>
						<textarea
							id="commentsInput"
							rows={3}
							placeholder="e.g. This is a draft for peer review. The argument isn't finished yet so don't flag gaps as errors..."
							value={comments}
							onChange={(e) => setComments(e.target.value)}
						/>
					</div>
				</div>

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
					<div
						className={`${classes.resultPanel} ${visualizations.length > 0 ? classes.visible : ''}`}
					>
						{isRunning ? (
							<div className={classes.loadingState}>
								<div className={classes.loaderDots}>
									<span></span>
									<span></span>
									<span></span>
								</div>
								Running {selectedFeatures.length} feature
								{selectedFeatures.length > 1 ? 's' : ''}...
							</div>
						) : null}
						{visualizations.map((viz, index) => (
							<div key={viz.id}>
								{index > 0 && <div style={{ borderTop: '1.5px solid var(--border)' }}></div>}
								<div className={classes.resultHeader}>
									<span className={classes.resultTag}>
										{promptList.find((p) => p.prompt === viz.prompt)?.keyword || 'Feature'}
									</span>
									<span className={classes.resultMeta}>
										{viz.response.split('\n').length} result
										{viz.response.split('\n').length > 1 ? 's' : ''}
									</span>
								</div>
								<div className={classes.resultItem} style={{ animationDelay: `${index * 0.04}s` }}>
									<Remark
										rehypeReactOptions={{
											components: {
												a: AnchorWithCallback,
											},
										}}
									>
										{viz.response}
									</Remark>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Sticky footer */}
			<div className={classes.footer}>
				<div className={classes.summaryRow}>
					{selectedFeatures.length === 0
						? 'Select features above to get started'
						: selectedFeatures.map((f) => (
								<span key={f} className={classes.selectedTag}>
									{f}
								</span>
							))}
				</div>
				<button
					className={classes.runBtn}
					disabled={selectedFeatures.length === 0 || isRunning}
					onClick={runSelectedFeatures}
				>
					{selectedFeatures.length > 0
						? `Run ${selectedFeatures.length} feature${selectedFeatures.length > 1 ? 's' : ''}`
						: 'Run selected features'}
				</button>
			</div>
		</div>
	);
}
