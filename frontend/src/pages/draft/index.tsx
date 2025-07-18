/**
 * @format
 */

import { useAtomValue } from 'jotai';
import { Fragment, useCallback, useContext, useState } from 'react';
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
					savedItems.map((savedItem, index) => (
						<div
							key={index}
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

export default function Draft() {
	const editorAPI = useContext(EditorContext);
	const docContext = useDocContext(editorAPI);
	const username = useAtomValue(usernameAtom);
	const studyCondition = useAtomValue(studyConditionAtom);
	const { getAccessToken, authErrorType } = useAccessToken();
	const [isLoading, setIsLoading] = useState(false);
	const [savedItems, updateSavedItems] = useState<SavedItem[]>([]);
	const [errorMsg, updateErrorMsg] = useState('');

	const isStudy = studyCondition !== null;
	const modesToShow = isStudy ? [studyCondition] : modes;

	function save(generation: GenerationResult, document: DocContext) {
		updateSavedItems(savedItems => [
			{
				document: document,
				generation: generation,
				dateSaved: new Date(),
			},
			...savedItems,
		]);
	}

	function deleteSavedItem(dateSaved: Date) {
		updateSavedItems(savedItems => {
			if (savedItems.length === 0) {
				console.warn('No saved items to delete');
				return savedItems;
			}
			// Find the index of the item to be deleted
			const savedItemIdx = savedItems.findIndex(
				savedItem => savedItem.dateSaved === dateSaved,
			);
			if (savedItemIdx === -1) {
				console.warn('Saved item not found for deletion');
				return savedItems;
			}
			// Create a new array without the item to be deleted
			const newSaved = savedItems.filter(
				savedItem => savedItem.dateSaved !== dateSaved,
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
		async function getSuggestion(type: string) {
			updateErrorMsg('');
			setIsLoading(true);
			try {
				const token = await getAccessToken();
				const response = await fetch(`${SERVER_URL}/get_suggestion`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({
						username: username,
						gtype: type,
						// eslint-disable-next-line camelcase
						doc_context: docContext,
					}),
					signal: AbortSignal.timeout(20000),
				});
				if (!response.ok) {
					throw new Error(`HTTP error! status: ${response.status}`);
				}
				updateErrorMsg('');
				const generated = (await response.json()) as GenerationResult;
				save(generated, docContext);
			} catch (err: any) {
				setIsLoading(false);
				let errMsg = '';
				if (err.name === 'AbortError')
					errMsg = `Generating a suggestion took too long, please try again.`;
				else errMsg = `${err.name}: ${err.message}. Please try again.`;

				updateErrorMsg(errMsg);
				log({
					username: username,
					event: 'generation_error',
					// eslint-disable-next-line camelcase
					generation_type: type,
					docContext: docContext,
					result: errMsg,
				});
				return;
			}

			setIsLoading(false);
		},
		[getAccessToken, docContext, username],
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
		if (!docContext.beforeCursor.trim())
			alerts = (
				<div className="mt-4 ml-4 mr-4 p-4 transition duration-150">
					<div className="text-sm text-gray-500 text-center transition duration-150">
						Write something in the document to get started!
					</div>
				</div>
			);
		else
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
						{modesToShow.map(mode => {
							return (
								<Fragment key={mode}>
									<button
										className={classes.optionsButton}
										disabled={
											docContext.beforeCursor === '' ||
											isLoading
										}
										onClick={() => {
											log({
												username: username,
												event: 'request_suggestion',
												// eslint-disable-next-line camelcase
												generation_type: mode,
												docContext: docContext,
											});

											getSuggestion(mode);
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
