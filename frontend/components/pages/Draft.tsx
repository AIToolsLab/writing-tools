'use client';

import { useAtomValue } from 'jotai';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Remark } from 'react-remark';
import { EditorContext } from '@/contexts/editorContext';
import { usernameAtom } from '@/contexts/userContext';
import { log } from '@/lib/log';
import type { DocContext, GenerationResult, SavedItem } from '@/lib/types';
import { useDocContext } from '@/lib/useDocContext';
import classes from './Draft.module.css';
import { iconFunc } from './iconFunc';

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
}

class Fetcher {
	requestInFlight: SuggestionRequest | null;
	previousRequest: SuggestionRequest | null;

	constructor() {
		this.requestInFlight = null;
		this.previousRequest = null;
	}

	async fetchSuggestion(request: SuggestionRequest): Promise<GenerationResult> {
		this.requestInFlight = request;
		try {
			// The model call now happens server-side; the browser just posts the request.
			const response = await fetch('/api/draft', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(20000),
			});

			if (!response.ok) {
				throw new Error(`Request failed with status ${response.status}`);
			}

			const result = (await response.json()) as GenerationResult;
			this.previousRequest = request;
			return result;
		} catch (err) {
			const error = err as Error;
			let errMsg = '';
			if (error.name === 'AbortError' || error.name === 'TimeoutError')
				errMsg = `Generating a suggestion took too long, please try again.`;
			else errMsg = `${error.name}: ${error.message}. Please try again.`;
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

export default function Draft() {
	const editorAPI = useContext(EditorContext);
	const docContextSnapshot = useDocContext(editorAPI);
	const username = useAtomValue(usernameAtom);
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
	useEffect(() => {
		docContextRef.current = docContextSnapshot;
	}, [docContextSnapshot]);

	const modesToShow = modes;

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
			const savedItemIdx = savedItems.findIndex(
				(savedItem) => savedItem.dateSaved === dateSaved,
			);
			if (savedItemIdx === -1) {
				console.warn('Saved item not found for deletion');
				return savedItems;
			}
			const newSaved = savedItems.filter((savedItem) => savedItem.dateSaved !== dateSaved);

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
		async function getSuggestion(suggestionRequest: SuggestionRequest, isUserInitiated = true) {
			updateErrorMsg('');
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
				const suggestion = await getFetcher().fetchSuggestion(suggestionRequest);
				// The AI sometimes returns "[]" (an empty JSON array) as plain text
				// when it has nothing to say. Treat that the same as an empty response
				// so we don't show a useless "[]" bullet to the user.
				const isEmpty =
					suggestion.result.trim() === '' || suggestion.result.trim() === '[]';
				if (isEmpty) {
					console.warn('Received empty suggestion.');
				} else {
					save(suggestion, suggestionRequest.docContext);
				}
			} catch (err) {
				const errMsg: string =
					(err as Error).message || 'An error occurred while generating the suggestion.';
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
		[getFetcher, save, username],
	);

	useEffect(() => {
		return () => {
			fetcherRef.current = null;
		};
	}, []);

	return (
		<div className={classes.app}>
			<div className={classes.body}>
				<div className="flex flex-1 flex-col overflow-hidden">
					<div className="relative flex flex-1 flex-col gap-2 overflow-hidden p-2">
						{/* Instruction */}
						<div className={classes.instruction}>CLICK A DESIRED BUTTON</div>

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
						<div
							className={`${classes.resultsArea} ${savedItems.length > 0 ? classes.hasContent : ''}`}
						>
							{errorMsg ? <div className={classes.errorMessage}>{errorMsg}</div> : null}
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
								<SavedGenerations savedItems={savedItems} deleteSavedItem={deleteSavedItem} />
							) : null}
						</div>
					</div>

					<div className={classes.disclaimer}>
						Please note that AI suggestions may vary in quality. Always review suggestions
						carefully before using them.
					</div>
				</div>
			</div>
		</div>
	);
}
