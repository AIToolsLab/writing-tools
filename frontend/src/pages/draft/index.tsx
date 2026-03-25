/**
 * @format
 */

import { useAtomValue } from 'jotai';
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { Remark } from 'react-remark';
import { log, SERVER_URL } from '@/api';
import { useAccessToken } from '@/contexts/authTokenContext';
import { EditorContext } from '@/contexts/editorContext';
import { studyDataAtom } from '@/contexts/studyContext';
import { usernameAtom } from '@/contexts/userContext';
import { useDocContext } from '@/utilities';
import { iconFunc } from './iconFunc';
import classes from './styles.module.css';

const visibleNameForMode = {
	example_sentences: 'Examples of what you could write next:',
	analysis_readerPerspective: 'Possible questions your reader might have:',
	proposal_advice: 'Advice for your next words:',
	complete_document: 'Complete Document',
	example_rewording: 'Example rewordings of your selected text:',
	no_ai: 'No AI',
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

const modes = ['example_sentences', 'analysis_readerPerspective', 'proposal_advice', 'example_rewording'];

interface SuggestionRequest {
	docContext: DocContext;
	type: string;
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
		accessToken: string,
		username: string,
	): Promise<GenerationResult> {
		this.requestInFlight = request;
		try {
			const response = await fetch(`${SERVER_URL}/get_suggestion`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${accessToken}`,
				},
				body: JSON.stringify({
					username: username,
					gtype: request.type,

					doc_context: request.docContext,
				}),
				signal: AbortSignal.timeout(20000),
			});
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const generated = (await response.json()) as GenerationResult;
			// Set previousRequest only when the response is successful
			this.previousRequest = request;
			return generated;
		} catch (err: any) {
			let errMsg = '';
			if (err.name === 'AbortError')
				errMsg = `Generating a suggestion took too long, please try again.`;
			else errMsg = `${err.name}: ${err.message}. Please try again.`;
			throw new Error(errMsg);
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
					{visibleNameForMode[generation.generation_type as keyof typeof visibleNameForMode]}
				</div>
			) : null}
			<div className={classes.generationContent}>
				<Remark>{formattedResult}</Remark>
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
		<div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
			{savedItems.map((savedItem, index) => (
				<div
					key={savedItem.dateSaved.toString()}
					className={classes.resultItem}
					style={{ animationDelay: `${index * 0.05}s` }}
					onMouseEnter={(e) => {
						const deleteBtn = e.currentTarget.querySelector('[data-delete]') as HTMLElement;
						if (deleteBtn) deleteBtn.style.opacity = '1';
					}}
					onMouseLeave={(e) => {
						const deleteBtn = e.currentTarget.querySelector('[data-delete]') as HTMLElement;
						if (deleteBtn) deleteBtn.style.opacity = '0';
					}}
				>
					<div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', width: '100%' }}>
						<div style={{ flex: 1, minWidth: 0 }}>
							<_GenerationResult generation={savedItem.generation} />
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

/**
 * Call a callback function at a specified interval, with the ability to reset the interval.
 *
 * @param callback The function to be called on each interval.
 * @param interval The interval duration in milliseconds.
 * @returns A function to reset the interval.
 */
function useResettableInterval(callback: () => void, interval: number) {
	const timerRef = useRef<NodeJS.Timeout | null>(null);
	const callbackRef = useRef(callback);

	useEffect(() => {
		callbackRef.current = callback;
	}, [callback]);

	useEffect(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
		}
		if (interval <= 0) {
			timerRef.current = null;
			return;
		}
		timerRef.current = setInterval(() => {
			callbackRef.current();
		}, interval);
		return () => {
			if (timerRef.current) {
				clearInterval(timerRef.current);
			}
		};
	}, [interval]);

	return useCallback(() => {
		if (timerRef.current) {
			clearInterval(timerRef.current);
		}
		timerRef.current = setInterval(() => {
			callbackRef.current();
		}, interval);
	}, [interval]);
}

export default function Draft() {
	const editorAPI = useContext(EditorContext);
	const docContextSnapshot = useDocContext(editorAPI);
	const username = useAtomValue(usernameAtom);
	const studyData = useAtomValue(studyDataAtom);
	const { getAccessToken, authErrorType } = useAccessToken();
	const [isLoading, setIsLoading] = useState(false);
	const [savedItems, updateSavedItems] = useState<SavedItem[]>([]);
	const [errorMsg, updateErrorMsg] = useState('');
	const [activeMode, setActiveMode] = useState<string | null>(null);
	const fetcherRef = useRef<Fetcher | null>(null);

	const getFetcher = useCallback((): Fetcher => {
		if (!fetcherRef.current) {
			fetcherRef.current = new Fetcher();
		}
		return fetcherRef.current;
	}, []);
	const docContextRef = useRef<DocContext>(docContextSnapshot);
	docContextRef.current = docContextSnapshot;

	// console.log({
	// 	before: docContextSnapshot.beforeCursor.slice(-50),
	// 	selected: docContextSnapshot.selectedText,
	// 	after: docContextSnapshot.afterCursor.slice(0, 50),
	// });

	const isStudy = studyData !== null;
	const currentCondition = isStudy ? studyData.condition : null;
	const isNoAI = currentCondition === 'no_ai';
	const autoRefreshInterval = isStudy && !isNoAI ? studyData.autoRefreshInterval : 0;
	const modesToShow = useMemo(
		() => (isStudy ? [studyData.condition] : modes),
		[isStudy, studyData],
	);

	const shouldAutoRefresh = autoRefreshInterval > 0;

	const save = useCallback(
		(generation: GenerationResult, document: DocContext) => {
			log({
				username: username,
				event: 'ShowSuggestion',
				prompt: document,
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
		[username],
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

			log({
				username: username,
				event: 'Delete',
				prompt: savedItems[savedItemIdx].document,
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
			updateErrorMsg('');
			if (isUserInitiated) {
				setIsLoading(true);
			}
			try {
				const token = await getAccessToken();
				const suggestion = await getFetcher().fetchSuggestion(
					suggestionRequest,
					token,
					username,
				);
				// Suggestion text might be empty
				if (suggestion.result === '') {
					console.warn('Received empty suggestion.');
				} else {
					save(suggestion, suggestionRequest.docContext);
				}
			} catch (err: any) {
				const errMsg: string =
					err.message ||
					'An error occurred while generating the suggestion.';
				log({
					username: username,
					event: 'generation_error',

					generation_type: suggestionRequest.type,
					docContext: suggestionRequest.docContext,
					result: errMsg,
				});
				updateErrorMsg(errMsg);
			}

			setIsLoading(false);
		},
		[getAccessToken, getFetcher, username, save],
	);

	const autoRefreshCallback = useCallback(() => {
		if (!shouldAutoRefresh) {
			return;
		}
		const request = {
			docContext: docContextRef.current,
			type: modesToShow[0],
		};
		if (getFetcher().requestInFlight) {
			console.warn(
				'Auto-refresh skipped because a request is already in flight.',
			);
			return;
		}
		const prevRequest = getFetcher().previousRequest;
		if (
			prevRequest &&
			JSON.stringify(prevRequest.docContext) === JSON.stringify(docContextRef.current) &&
			prevRequest.type === modesToShow[0]
		) {
			console.warn(
				'Auto-refresh skipped because the previous request is the same as the current one.',
			);
			return;
		}
		log({
			username: username,
			event: 'auto_refresh',

			generation_type: modesToShow[0],
			docContext: docContextRef.current,
		});
		getSuggestion(request, false);
	}, [getFetcher, getSuggestion, modesToShow, shouldAutoRefresh, username]);

	const resetAutoRefresh = useResettableInterval(
		autoRefreshCallback,
		autoRefreshInterval,
	);

	if (authErrorType !== null) {
		return <div>Please reauthorize.</div>;
	}

	// Handle no_ai condition with static message
	if (isNoAI) {
		return (
			<div className="flex flex-col flex-1">
				<div className="flex flex-col flex-1 gap-2 relative p-2">
					<div className="mt-4 ml-4 mr-4 p-4 text-center text-stone-700">
						AI suggestions are unavailable for this task. (Please do not use any other AI systems either.)
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={classes.app}>
			<div className={classes.body}>
					
				<div className="flex flex-col flex-1 overflow-hidden">
					<div className="flex flex-col flex-1 gap-2 relative p-2 overflow-hidden">
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
										className={`${classes.featureCard} ${isActive ? 'active' : ''}`}
										onClick={() => {
											setActiveMode(mode);
											log({
												username: username,
												event: 'request_suggestion',
												generation_type: mode,
												docContext: docContextRef.current,
											});
											resetAutoRefresh();
											const request = {
												docContext: docContextRef.current,
												type: mode,
											};
											getSuggestion(request, true);
										}}
										disabled={isLoading}
										type="button"
										aria-label={meta?.name}
										title={meta?.description}
									>
										{Icon ? <Icon className={classes.featIcon} /> : null}
										{meta ? (
											<>
												<div className={classes.featName}>{meta.name}</div>
												<div className={classes.featDesc}>{meta.description}</div>
											</>
										) : null}
										<div className={classes.activeDot}></div>
									</button>
								);
							})}
						</div>
						{/* Results Area */}
						<div className={`${classes.resultsArea} ${savedItems.length > 0 ? classes.hasContent : ''}`}>
							{errorMsg ? (
								<div className={classes.errorMessage}>
									{errorMsg}
								</div>
							) : null}
							{!errorMsg && savedItems.length === 0 && !isLoading ? (
								<div className={classes.emptyStateContainer}>
									<div className={classes.emptyTitle}>No suggestions yet</div>
									<div className={classes.emptyHint}>
										Click a button above to generate suggestions for your text
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
						Please note that AI suggestions may vary in quality. Always review suggestions carefully before using them.
					</div>
				</div>

			</div>
		</div>
			);
		}
		
