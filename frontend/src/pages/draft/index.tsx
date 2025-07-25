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
import { AiOutlineClose, AiOutlineReload } from 'react-icons/ai';
import { Remark } from 'react-remark';
import { log, SERVER_URL } from '@/api';
import { useAccessToken } from '@/contexts/authTokenContext';
import { EditorContext } from '@/contexts/editorContext';
import { studyConditionAtom } from '@/contexts/studyContext';
import { usernameAtom } from '@/contexts/userContext';
import { useDocContext } from '@/utilities';
import { iconFunc } from './iconFunc';
import classes from './styles.module.css';

const visibleNameForMode = {
	example_sentences: 'Examples',
	analysis_describe: 'Analysis',
	proposal_advice: 'Advice',
};

const modes = ['example_sentences', 'analysis_describe', 'proposal_advice'];

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
					// eslint-disable-next-line camelcase
					doc_context: request.docContext,
				}),
				signal: AbortSignal.timeout(20000),
			});
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			const generated = (await response.json()) as GenerationResult;
			return generated;
		} catch (err: any) {
			let errMsg = '';
			if (err.name === 'AbortError')
				errMsg = `Generating a suggestion took too long, please try again.`;
			else errMsg = `${err.name}: ${err.message}. Please try again.`;
			throw new Error(errMsg);
		} finally {
			this.previousRequest = request;
			this.requestInFlight = null;
		}
	}
}

function GenerationResult({ generation }: { generation: GenerationResult }) {
	return (
		<div className="prose">
			<div className="text-bold">
				{
					visibleNameForMode[
						generation.generation_type as keyof typeof visibleNameForMode
					]
				}
			</div>{' '}
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
					savedItems.map((savedItem) => (
						<div
							key={savedItem.dateSaved.toString()}
							className={classes.historyItem}
						>
							<div className={classes.historyText}>
								<GenerationResult
									generation={savedItem.generation}
								/>
							</div>
							<div className={classes.savedIconsContainer}>
								<div
									className={
										classes.historyCloseButtonWrapper
									}
									onClick={() =>
										deleteSavedItem(savedItem.dateSaved)
									}
								>
									<AiOutlineClose
										className={classes.historyCloseButton}
									/>
								</div>
							</div>
						</div>
					))
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
	const studyCondition = useAtomValue(studyConditionAtom);
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

	const isStudy = studyCondition !== null;
	const modesToShow = useMemo(
		() => (isStudy ? [studyCondition] : modes),
		[isStudy, studyCondition],
	);

	const shouldAutoRefresh = isStudy;

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
				save(suggestion, suggestionRequest.docContext);
			} catch (err: any) {
				const errMsg: string =
					err.message ||
					'An error occurred while generating the suggestion.';
				log({
					username: username,
					event: 'generation_error',
					// eslint-disable-next-line camelcase
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
			prevRequest.docContext === docContextRef.current &&
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
			// eslint-disable-next-line camelcase
			generation_type: modesToShow[0],
			docContext: docContextRef.current,
		});
		getSuggestion(request, false);
	}, [getFetcher, getSuggestion, modesToShow, shouldAutoRefresh, username]);

	const resetAutoRefresh = useResettableInterval(
		autoRefreshCallback,
		10000, // 10 seconds
	);

	if (authErrorType !== null) {
		return <div>Please reauthorize.</div>;
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
		<>
			<div className=" flex flex-col gap-2 relative p-2 h-[73vh]">
				<div>
					{/* Generation Option Buttons */}
					<div className={classes.optionsContainer}>
						{modesToShow.map((mode) => {
							return (
								<Fragment key={mode}>
									<button
										type="button"
										className={classes.optionsButton}
										disabled={isLoading}
										onClick={() => {
											log({
												username: username,
												event: 'request_suggestion',
												// eslint-disable-next-line camelcase
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
									>
										{isStudy ? (
											<AiOutlineReload />
										) : (
											iconFunc(mode)
										)}
										{/* { isStudy ? "Refresh" : visibleNameForMode[mode as keyof typeof visibleNameForMode] } */}
									</button>
								</Fragment>
							);
						})}
					</div>
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
		</>
	);
}
