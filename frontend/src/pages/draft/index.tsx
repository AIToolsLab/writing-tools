/**
 * @format
 */

import { type ModelMessage } from 'ai';
import { useCallback, useContext, useRef, useState } from 'react';
import {
	describeGenerationError,
	type GenerationErrorInfo,
} from '@/api/errors';
import { generateFullText } from '@/api/generate';
import { draftLog } from '@/api/logging';
import { languageModel, openaiProviderOptions } from '@/api/openai';
import { buildMessages, DRAFT_INSTRUCTIONS } from '@/api/prompts';
import { ErrorNotice, GenerationErrorNotice } from '@/components/errorNotice';
import BriefSection from '@/components/briefSection';
import Markdown from '@/components/markdown';
import {
	formatDocBriefForPrompt,
	useDocBrief,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
import { useLog } from '@/hooks/useLog';
import { useDocContext } from '@/utilities';
import { iconFunc } from './iconFunc';
import { useResettableInterval } from './useResettableInterval';
import classes from './styles.module.css';

const visibleNameForMode = {
	example_sentences: 'Examples of what you could write next:',
	analysis_readerPerspective: 'Possible questions your reader might have:',
	proposal_advice: 'Advice for your next words:',
	complete_document: 'Complete Document',
	example_rewording: 'Example rewordings of your selected text:',
};

const modeMeta: Record<string, { name: string; description: string }> = {
	example_sentences: {
		name: 'Examples',
		description: 'See what you could write next',
	},
	analysis_readerPerspective: {
		name: 'Questions',
		description: 'Understand reader perspective',
	},
	proposal_advice: {
		name: 'Advice',
		description: 'Get suggestions for next words',
	},
	example_rewording: {
		name: 'Rewording',
		description: 'Explore alternative phrasings',
	},
};

const modes = [
	'example_sentences',
	'analysis_readerPerspective',
	'proposal_advice',
	'example_rewording',
];

interface SuggestionRequest {
	docContext: DocContext;
	type: string;
	/** The document's brief, prompt-formatted; null when the writer set none. */
	brief: string | null;
}

class Fetcher {
	requestInFlight: SuggestionRequest | null;
	previousRequest: SuggestionRequest | null;

	constructor() {
		this.requestInFlight = null;
		this.previousRequest = null;
	}

	async fetchSuggestion(
		request: SuggestionRequest,
	): Promise<GenerationResult> {
		this.requestInFlight = request;
		try {
			const messages = buildMessages(
				request.type,
				request.docContext,
				request.brief,
			) as ModelMessage[];

			// generateFullText, not `streamText(...).text`: the latter resolves to
			// an empty string when the generation failed, which is how a quota
			// error used to surface as "No suggestions yet".
			const result = await generateFullText({
				model: languageModel,
				providerOptions: openaiProviderOptions,
				instructions: DRAFT_INSTRUCTIONS,
				messages,
				abortSignal: AbortSignal.timeout(20000),
			});

			this.previousRequest = request;
			return { generation_type: request.type, result, extra_data: {} };
		} finally {
			this.requestInFlight = null;
		}
	}
}

function formatDraftSuggestionAsBullets(result: string) {
	const trimmedResult = result.trim();
	if (!trimmedResult) return trimmedResult;

	const hasMarkdownList = /^(?:\s*[-*+]\s+|\s*\d+\.\s+)/m.test(trimmedResult);
	if (hasMarkdownList) return trimmedResult;

	const lines = trimmedResult
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);

	const bulletItems =
		lines.length > 1
			? lines
			: trimmedResult
					.split(/(?<=[.!?])\s+(?=[A-Z0-9"])/)
					.map((item) => item.trim())
					.filter(Boolean);

	return bulletItems.map((item) => `- ${item}`).join('\n');
}

function _GenerationResult({ generation }: { generation: GenerationResult }) {
	const showTitle = generation.generation_type !== 'complete_document';
	const formattedResult =
		generation.generation_type === 'complete_document'
			? generation.result
			: formatDraftSuggestionAsBullets(generation.result);

	return (
		<div className={classes.generationResult}>
			{showTitle ? (
				<div className={classes.generationTitle}>
					{
						visibleNameForMode[
							generation.generation_type as keyof typeof visibleNameForMode
						]
					}
				</div>
			) : null}
			<div className={classes.generationContent}>
				<Markdown>{formattedResult}</Markdown>
			</div>
		</div>
	);
}

function SavedGenerations({
	savedItems,
	deleteSavedItem,
}: {
	savedItems: SavedItem[];
	deleteSavedItem: (dateSaved: Date) => void;
}) {
	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: '6px',
				width: '100%',
			}}
		>
			{savedItems.map((savedItem, index) => (
				<div
					key={savedItem.dateSaved.toString()}
					className={classes.resultItem}
					style={{ animationDelay: `${index * 0.05}s` }}
					onMouseEnter={(e) => {
						const deleteBtn = e.currentTarget.querySelector(
							'[data-delete]',
						) as HTMLElement;
						if (deleteBtn) deleteBtn.style.opacity = '1';
					}}
					onMouseLeave={(e) => {
						const deleteBtn = e.currentTarget.querySelector(
							'[data-delete]',
						) as HTMLElement;
						if (deleteBtn) deleteBtn.style.opacity = '0';
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'flex-start',
							gap: '8px',
							width: '100%',
						}}
					>
						<div style={{ flex: 1, minWidth: 0 }}>
							<_GenerationResult
								generation={savedItem.generation}
							/>
						</div>
						<button
							data-delete
							onClick={() => deleteSavedItem(savedItem.dateSaved)}
							style={{
								background: 'transparent',
								border: 'none',
								cursor: 'pointer',
								color: 'var(--text-tertiary)',
								fontSize: '14px',
								opacity: 0,
								transition: 'opacity .15s',
								padding: '2px',
								flexShrink: 0,
							}}
							aria-label="Delete suggestion"
							title="Delete suggestion"
						>
							✕
						</button>
					</div>
				</div>
			))}
		</div>
	);
}

export default function Draft() {
	const editorAPI = useContext(EditorContext);
	const { refresh: refreshDocContext } = useDocContext(editorAPI);
	const { brief } = useDocBrief();
	const log = useLog();
	// Read when a suggestion is requested, alongside the document context, so a
	// brief edited moments ago is the one that applies.
	const briefRef = useRef(brief);
	briefRef.current = brief;
	const [isLoading, setIsLoading] = useState(false);
	const [savedItems, updateSavedItems] = useState<SavedItem[]>([]);
	const [errorInfo, updateErrorInfo] = useState<GenerationErrorInfo | null>(
		null,
	);
	/** Set when a request succeeded but the model had nothing to say. */
	const [emptyResult, setEmptyResult] = useState(false);
	const [activeMode, setActiveMode] = useState<string | null>(null);
	const fetcherRef = useRef<Fetcher | null>(null);
	/** The last request, so the notice's Retry button can re-run it. */
	const lastRequestRef = useRef<SuggestionRequest | null>(null);

	const getFetcher = useCallback((): Fetcher => {
		if (!fetcherRef.current) {
			fetcherRef.current = new Fetcher();
		}
		return fetcherRef.current;
	}, []);

	const autoRefreshInterval = 0;
	const modesToShow = modes;

	const shouldAutoRefresh = autoRefreshInterval > 0;

	const save = useCallback(
		(generation: GenerationResult, document: DocContext) => {
			draftLog.suggestionShown(log, {
				generationType: generation.generation_type,
				docContext: document,
				result: generation,
			});
			updateSavedItems((savedItems) => [
				{
					document: document,
					generation: generation,
					dateSaved: new Date(),
				},
				...savedItems,
			]);
		},
		[log],
	);

	function deleteSavedItem(dateSaved: Date) {
		updateSavedItems((savedItems) => {
			if (savedItems.length === 0) {
				console.warn('No saved items to delete');
				return savedItems;
			}
			// Find the index of the item to be deleted
			const savedItemIdx = savedItems.findIndex(
				(savedItem) => savedItem.dateSaved === dateSaved,
			);
			if (savedItemIdx === -1) {
				console.warn('Saved item not found for deletion');
				return savedItems;
			}
			// Create a new array without the item to be deleted
			const newSaved = savedItems.filter(
				(savedItem) => savedItem.dateSaved !== dateSaved,
			);

			draftLog.suggestionDeleted(log, {
				generationType:
					savedItems[savedItemIdx].generation.generation_type,
				docContext: savedItems[savedItemIdx].document,
				result: savedItems[savedItemIdx].generation,
			});
			return newSaved;
		});
	}

	// Get a generation from the backend
	const getSuggestion = useCallback(
		async function getSuggestion(
			suggestionRequest: SuggestionRequest,
			isUserInitiated = true,
		) {
			updateErrorInfo(null);
			setEmptyResult(false);
			lastRequestRef.current = suggestionRequest;
			if (isUserInitiated) {
				setIsLoading(true);
			}
			// Rewording needs selected text to work — if nothing is selected,
			// show a message immediately without calling the backend
			if (
				suggestionRequest.type === 'example_rewording' &&
				!suggestionRequest.docContext.selectedText.trim()
			) {
				save(
					{
						generation_type: 'example_rewording',
						result: 'Please select some text to get rewording suggestions.',
						extra_data: {},
					},
					suggestionRequest.docContext,
				);
				setIsLoading(false);
				return;
			}
			try {
				const suggestion =
					await getFetcher().fetchSuggestion(suggestionRequest);
				// The AI sometimes returns "[]" (an empty JSON array) as plain text
				// when it has nothing to say. Treat that the same as an empty response
				// so we don't show a useless "[]" bullet to the user.
				const isEmpty =
					suggestion.result.trim() === '' ||
					suggestion.result.trim() === '[]';
				if (isEmpty) {
					// Nothing to show, but say so — silence reads as a broken button.
					console.warn('Received empty suggestion.');
					setEmptyResult(true);
					draftLog.suggestionEmpty(log, {
						generationType: suggestionRequest.type,
						docContext: suggestionRequest.docContext,
					});
				} else {
					save(suggestion, suggestionRequest.docContext);
				}
			} catch (err) {
				const info = describeGenerationError(err);
				console.error('Error fetching suggestion:', err);
				draftLog.generationError(log, {
					generationType: suggestionRequest.type,
					docContext: suggestionRequest.docContext,
					error: info.detail,
					code: info.code,
				});
				updateErrorInfo(info);
			}

			setIsLoading(false);
		},
		[getFetcher, save, log],
	);

	const retryLastRequest = useCallback(() => {
		const request = lastRequestRef.current;
		if (request) void getSuggestion(request, true);
	}, [getSuggestion]);

	const autoRefreshCallback = useCallback(async () => {
		if (!shouldAutoRefresh) {
			return;
		}
		if (getFetcher().requestInFlight) {
			console.warn(
				'Auto-refresh skipped because a request is already in flight.',
			);
			return;
		}
		// Pull the current document context at refresh time rather than tracking
		// it continuously.
		const docContext = await refreshDocContext();
		const request = {
			docContext,
			type: modesToShow[0],
			brief: formatDocBriefForPrompt(briefRef.current),
		};
		const prevRequest = getFetcher().previousRequest;
		if (
			prevRequest &&
			JSON.stringify(prevRequest.docContext) ===
				JSON.stringify(docContext) &&
			prevRequest.type === modesToShow[0]
		) {
			console.warn(
				'Auto-refresh skipped because the previous request is the same as the current one.',
			);
			return;
		}
		draftLog.autoRefresh(log, {
			generationType: modesToShow[0],
			docContext,
		});
		getSuggestion(request, false);
	}, [getFetcher, getSuggestion, shouldAutoRefresh, log, refreshDocContext]);

	const resetAutoRefresh = useResettableInterval(
		autoRefreshCallback,
		autoRefreshInterval,
	);

	return (
		<div className={classes.app}>
			<div className={classes.body}>
				<div className={classes.bodyColumn}>
					<div className={classes.bodyColumnInner}>
						{/* The document's brief — same section as on Revise, same
						    stored values; collapsed here since this page's job is
						    the buttons below it. */}
						<BriefSection page="draft" />

						{/* Instruction */}
						<div className={classes.instruction}>
							CLICK A DESIRED BUTTON
						</div>

						{/* Feature Grid */}
						<div className={classes.featureGrid}>
							{modesToShow.map((mode) => {
								const isActive = activeMode === mode;
								const Icon = iconFunc(mode);
								const meta = modeMeta[mode];

								return (
									<button
										key={mode}
										className={`${classes.featureCard} ${isActive ? classes.active : ''}`}
										onClick={() => {
											void (async () => {
												setActiveMode(mode);
												// Pull the current document context at click time.
												const docContext =
													await refreshDocContext();
												draftLog.suggestionRequested(
													log,
													{
														generationType: mode,
														docContext,
													},
												);
												resetAutoRefresh();
												getSuggestion(
													{
														docContext,
														type: mode,
														brief: formatDocBriefForPrompt(
															briefRef.current,
														),
													},
													true,
												);
											})();
										}}
										disabled={isLoading}
										type="button"
										aria-label={meta?.name}
										title={meta?.description}
									>
										{Icon ? (
											<Icon
												className={classes.featIcon}
											/>
										) : null}
										{meta ? (
											<>
												<div
													className={classes.featName}
												>
													{meta.name}
												</div>
												<div
													className={classes.featDesc}
												>
													{meta.description}
												</div>
											</>
										) : null}
										<div
											className={classes.activeDot}
										></div>
									</button>
								);
							})}
						</div>
						{/* Results Area */}
						<div
							className={`${classes.resultsArea} ${savedItems.length > 0 ? classes.hasContent : ''}`}
						>
							{errorInfo ? (
								<GenerationErrorNotice
									info={errorInfo}
									onRetry={retryLastRequest}
								/>
							) : null}
							{emptyResult && !errorInfo ? (
								<ErrorNotice
									tone="info"
									title="Nothing to suggest"
									message="The assistant had nothing to add for this text. Try again, select a different part of your document, or pick another option above."
									onRetry={retryLastRequest}
								/>
							) : null}
							{!errorInfo &&
							!emptyResult &&
							savedItems.length === 0 &&
							!isLoading ? (
								<div className={classes.emptyStateContainer}>
									<div className={classes.emptyTitle}>
										No suggestions yet
									</div>
									<div className={classes.emptyHint}>
										Click a button above to generate
										suggestions for your text
									</div>
								</div>
							) : null}
							{isLoading && savedItems.length === 0 ? (
								<div className={classes.skeletonContainer}>
									<div className={classes.skeleton}></div>
									<div className={classes.skeleton}></div>
									<div className={classes.skeleton}></div>
								</div>
							) : null}
							{savedItems.length > 0 ? (
								<SavedGenerations
									savedItems={savedItems}
									deleteSavedItem={deleteSavedItem}
								/>
							) : null}
						</div>
					</div>

					<div className={classes.disclaimer}>
						Please note that AI suggestions may vary in quality.
						Always review suggestions carefully before using them.
					</div>
				</div>
			</div>
		</div>
	);
}
