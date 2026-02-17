/**
 * @format
 */

import { useAtomValue } from 'jotai';
import {
	Fragment,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { AiOutlineDelete, AiOutlineReload } from 'react-icons/ai';
import { Remark } from 'react-remark';
import { TransitionGroup, CSSTransition } from 'react-transition-group';
import { Button } from 'reshaped';
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

function GenerationResult({ generation }: { generation: GenerationResult }) {
	const showTitle = generation.generation_type !== 'complete_document';
	return (
		<div className="prose">
			{showTitle ? (
				<div className="text-bold">
					{
						visibleNameForMode[
						generation.generation_type as keyof typeof visibleNameForMode
						]
					}
				</div>
			) : null}{' '}
			<Remark>{generation.result}</Remark>
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
	const nodeRefs = useRef<Map<string, React.RefObject<HTMLDivElement>>>(new Map());

	// Create or get ref for each item
	const getNodeRef = useCallback((key: string) => {
		if (!nodeRefs.current.has(key)) {
			nodeRefs.current.set(key, { current: null });
		}
		const ref = nodeRefs.current.get(key);
		if (!ref) {
			throw new Error(`Failed to create ref for key: ${key}`);
		}
		return ref;
	}, []);

	// Clean up refs for removed items
	useEffect(() => {
		const currentKeys = new Set(savedItems.map(item => item.dateSaved.toString()));
		for (const [key] of nodeRefs.current) {
			if (!currentKeys.has(key)) {
				nodeRefs.current.delete(key);
			}
		}
	}, [savedItems]);

	return (
		<div className={classes.historyContainer}>
			<div className={classes.historyItemContainer}>
				{savedItems.length === 0 ? (
					<div className={classes.historyEmptyWrapper}>
						<div className={classes.historyText}>
							No suggestions...
						</div>
					</div>
				) : (
					<TransitionGroup>
						{savedItems.map((savedItem) => {
							const key = savedItem.dateSaved.toString();
							const nodeRef = getNodeRef(key);

							return (
								<CSSTransition
									key={key}
									nodeRef={nodeRef}
									timeout={300}
									classNames="saved-item"
								>
									<div
										ref={nodeRef}
										className={classes.historyItem}
									>
										<div className={classes.historyText}>
											<GenerationResult
												generation={savedItem.generation}
											/>
										</div>
										<div className={classes.savedIconsContainer}>
											<Button
												variant="ghost"
												color="neutral"
												size="small"
												rounded
												onClick={() =>
													deleteSavedItem(savedItem.dateSaved)
												}
												attributes={{
													'aria-label': 'Delete suggestion',
													title: 'Delete suggestion',
												}}
												icon={AiOutlineDelete}
											/>
										</div>
									</div>
								</CSSTransition>
							);
						})}
					</TransitionGroup>
				)}
			</div>
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

	let alerts = null;

	if (errorMsg !== '')
		alerts = (
			<div className="mr-[16px] ml-[16px] p-[16px] duration-150">
				<div className="text-base text-red-500 text-center">
					{errorMsg}
				</div>
			</div>
		);
	else if (savedItems.length === 0)
		alerts = (
			<div className="mt-4 ml-4 mr-4 p-0 transition duration-150">
				<div className="text-sm text-stone-950 text-center transition duration-150">
					Click the button above to generate a suggestion.
				</div>
			</div>
		);

	if (isLoading)
		alerts = (
			<div className={classes.spinnerWrapper}>
				<div className={classes.loader}></div>
			</div>
		);

	return (
		<div className="flex flex-col flex-1">
			<div className="flex flex-col flex-1 gap-2 relative p-2">
				<div className="flex justify-center gap-1 my-1">
					{/* Generation Option Buttons */}
					{modesToShow.map((mode) => {
						return (
							<Fragment key={mode}>
								<Button
									type="button"
									variant="outline"
									color="neutral"
									size="medium"
									rounded
									disabled={isLoading}
									attributes={{
										title: isStudy ? "Refresh" : visibleNameForMode[mode as keyof typeof visibleNameForMode]
									}}
									onClick={() => {
										log({
											username: username,
											event: 'request_suggestion',

											generation_type: mode,
											docContext:
												docContextRef.current,
										});

										resetAutoRefresh();
										const request = {
											docContext:
												docContextRef.current,
											type: mode,
										};
										getSuggestion(request, true);
									}}
									icon={isStudy ? AiOutlineReload : iconFunc(mode)}
								>
									{isStudy ? "Refresh" : null}
								</Button>
							</Fragment>
						);
					})}
				</div>
				{alerts}

				<SavedGenerations
					savedItems={savedItems}
					deleteSavedItem={deleteSavedItem}
				/>
			</div>

			<div className={classes.noteTextWrapper}>
				<div className={classes.noteText}>
					Please note that the quality of AI-generated text may vary
				</div>
			</div>
		</div>
	);
}
