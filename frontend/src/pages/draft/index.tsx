import { SERVER_URL, log } from '@/api';
import { useAccessToken } from '@/contexts/authTokenContext';
import { EditorContext } from '@/contexts/editorContext';
import { usernameAtom } from '@/contexts/userContext';
import { useDocContext } from '@/utilities';
import { getBefore } from '@/utilities/selectionUtil';
import { Fragment, useContext, useState } from 'react';
import {
	AiOutlineClose,
} from 'react-icons/ai';
import { Remark } from 'react-remark';
import { iconFunc } from './iconFunc';
import classes from './styles.module.css';
import { useAtomValue } from 'jotai';

const visibleNameForMode = {
	'Completion': 'Suggestions',
	'Question': 'Questions',
	'Keywords': 'Keywords',
	'RMove': 'Rhetorical Move'
};


function GenerationResult({ generation }: { generation: GenerationResult }) {
	return <Remark>{ generation.result }</Remark>;
}

function SavedGenerations({ 
    savedItems, 
    deleteSavedItem,
}: { 
    savedItems: SavedItem[],
    deleteSavedItem: (dateSaved: Date) => void,
}) {


    return (
        <div className={ classes.historyContainer }>


            <div className={ classes.historyItemContainer }>

                { /* can we use || ? */ }

                { savedItems.length === 0 ? (
                    <div className={ classes.historyEmptyWrapper }>
                        <div className={ classes.historyText }>
                            No saved generations... 
                        </div>
                    </div>
                ) : (
                    savedItems.map((savedItem, index) => (
                        <div
                            key={ index }
                            className={ classes.historyItem }
                        >
                            <div className={ classes.historyText }>
                                <GenerationResult generation={ savedItem.generation } />
                            </div>
                            <div
                                className={ classes.savedIconsContainer }
                            >
                                <div
                                    className={
                                        classes.historyCloseButtonWrapper
                                    }
                                    onClick={ () =>
                                        deleteSavedItem(
                                            savedItem.dateSaved
                                        )
                                    }
                                >
                                    <AiOutlineClose
                                        className={
                                            classes.historyCloseButton
                                        }
                                    />
                                </div>
                                <div
                                    className={
                                        classes.genTypeIconWrapper
                                    }
                                >
                                    { iconFunc(savedItem.generation.generation_type) }
                                </div>
                            </div>
                        </div>
                    ))
                ) }
            </div>
        </div>

    );
}


export default function Draft() {
	const editorAPI = useContext(EditorContext);
	const docContext = useDocContext(editorAPI);
	const username = useAtomValue(usernameAtom);
	const { getAccessToken, authErrorType } = useAccessToken();
	const [genCtxText, updateGenCtxText] = useState('');

	const [isLoading, setIsLoading] = useState(false);

	// State for saved page
	const [savedItems, updateSavedItems] = useState<SavedItem[]>([]);

	// eslint-disable-next-line prefer-const
	const [generation, updateGeneration] = useState<GenerationResult | null>(
		null
	);

	// Update Error Message
	const [errorMsg, updateErrorMsg] = useState('');



	// Save the generation
	function save(generation: GenerationResult, document: DocContext) {
		const newSaved = [...savedItems, {
			document: document,
			generation: generation,
			dateSaved: new Date()
		}];

		updateSavedItems(newSaved);
	}

	// Delete a saved item
	function deleteSavedItem(dateSaved: Date) {
		const savedItemIdx = savedItems.findIndex(
			savedItem => savedItem.dateSaved === dateSaved
		);
		if (savedItemIdx === -1) {
			// eslint-disable-next-line no-console
			console.warn('Saved item not found for deletion');
			return;
		}
		// Create a new array without the item to be deleted
		const newSaved = [...savedItems].filter(
			savedItem => savedItem.dateSaved !== dateSaved
		);

		log({
			username: username,
			event: 'Delete',
			prompt: savedItems[savedItemIdx].document,
			result: savedItems[savedItemIdx].generation
		});

		updateSavedItems(newSaved);
	}

	const beforeContext = getBefore(docContext);


	// Get a generation from the backend
	async function getGeneration(
		username: string,
		type: string,
		contextText: string
	) {
		updateGeneration(null);
		updateErrorMsg('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		try {
			const token = await getAccessToken();
			const response = await fetch(`${SERVER_URL}/generation`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${token}`
				},
				body: JSON.stringify({
					username: username,
					gtype: type,
					prompt: contextText
				}),
				signal: AbortSignal.timeout(20000)
			});
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			updateErrorMsg('');
			const generated = await response.json() as GenerationResult;
			updateGeneration(generated);
			updateGenCtxText(contextText);
			save(generated, docContext);
		}
		catch (err: any) {
			setIsLoading(false);
			let errMsg = '';
			if (err.name === 'AbortError')
				errMsg = `${err.name}: Timeout. Please try again.`;
			else errMsg = `${err.name}: ${err.message}. Please try again.`;

			updateErrorMsg(errMsg);
			updateGeneration(null);
			log({
				username: username,
				event: "generation_error",
				// eslint-disable-next-line camelcase
				generation_type: type,
				prompt: contextText,
				result: errMsg
			});
			return;
		}

		setIsLoading(false);
	}


	// Temporarily select the text from the start to the cursor
	async function _selectToCursor(duration: number = 1000): Promise<void> {
    try {
			await Word.run(async (context: Word.RequestContext) => {
				// TODO: Instead, use the "wordSelection" from the wordEditorAPI.ts
				const body = context.document.body;
				const wordSelection = context.document
        .getSelection()
        .getTextRanges([' '], false);

				context.load(wordSelection, 'items');
				await context.sync();

				// Get the range from start to the end of current word
				const rangeToCursor = wordSelection.items[wordSelection.items.length-1].expandTo(body.getRange('Start'));

				// Select the range
				rangeToCursor.select();
				await context.sync();

				// Unselect after specified duration
				setTimeout(async () => {
					await Word.run(async (context: Word.RequestContext) => {
						const rangeToCursor = wordSelection.items[wordSelection.items.length-1].expandTo(body.getRange('Start'));
						rangeToCursor.select();
						await context.sync();
					});
				}, duration);
			});
    }
		catch (error) {
			// eslint-disable-next-line no-console
			console.error('Error highlighting text:', error);
    }
	}

	if (authErrorType !== null) {
        return (
            <div>
							Please reauthorize.
						</div>
        );
    }

	let results = null;

	if (errorMsg !== '')
		results = (
			<div className= "mr-[16px] ml-[16px] p-[16px] duration-150">
				<div className="text-base text-red-500 text-center">{ errorMsg }</div>
			</div>
		);
	else if (generation === null)
		if (!docContext.beforeCursor.trim())
			results = (
				<div className="mt-4 ml-4 mr-4 p-4 transition duration-150">
					<div className="text-sm text-gray-500 text-center transition duration-150">
						Write something in the document to get started!
					</div>
				</div>
			);
		else
			results = (
				<div className="mt-4 ml-4 mr-4 p-4 transition duration-150">
					<div className="text-sm text-gray-500 text-center transition duration-150">
						Click a button to generate a suggestion.
					</div>
				</div>
			);
	else
		results = (
			<div className="mt-1 mr-2 ml-2 p-4 border border-[#c8c8c8] rounded-[16px] transition duration-150 flex">
				<div>
					<div
						className= "text-[0.8rem] text-[#aaaaaa] pb-1 cursor-pointer hover:text-black"
					>
						{ genCtxText.length > 100 ? '...' : '' }
						{ genCtxText.substring(genCtxText.length - 100) }
					</div>

					<div className="text-base whitespace-pre-wrap transition duration-150 animate-fade-in">
						<GenerationResult generation={ generation } />
					</div>
				</div>
				<div className={ classes.genIconsContainer }>
					<div
						className={
								classes.genTypeIconWrapper
						}
					>
						{ iconFunc(generation.generation_type) }
					</div>
				</div>
			</div>
		);

	if (isLoading && !generation)
		results = (
			<div className={ classes.spinnerWrapper }>
				<div className={ classes.loader }></div>
			</div>
		);

	return (
		<div className=" flex flex-col gap-2 relative p-2">

			{ /* Document Context Text Container */ }
			<div className= "text-sm p-[8px] m-[8px] shadow-[0_6px_10px_-1px_rgba(147,123,109,0.1)]">
				<h4>Suggestions will be generated using:</h4>
				<p>
					{ beforeContext.length > 100 ? '...' : '' }
					{ beforeContext.substring(beforeContext.length - 100) }
					{ /* { JSON.stringify(docContext) } */ }
				</p>
			</div>

			<div>
				{ /* Generation Option Buttons */ }
				<div
					className={ classes.optionsContainer }
				>
					{ ['Completion', 'Question', 'Keywords', 'RMove'].map(mode => {
						return (
							<Fragment key={ mode }>
							<button
								className={ classes.optionsButton }
								disabled={ docContext.beforeCursor === '' || isLoading }
								title={ visibleNameForMode[mode as keyof typeof visibleNameForMode] }
								aria-label={ visibleNameForMode[mode as keyof typeof visibleNameForMode] }
								onClick={ async () => {
									log({
										username: username,
										event: "request_suggestion",
										// eslint-disable-next-line camelcase
										generation_type: mode,
										prompt: beforeContext
									});
									if (beforeContext === '') return;

									getGeneration(
										username,
										mode,
										beforeContext
									);
								} }
							>
							   { iconFunc(mode) }
							</button>
							</Fragment>
						);
					}) }
					</div>

				<div className={ classes.noteTextWrapper }>
					<div className={ classes.noteText }>
						Please note that the quality of AI-generated text may
						vary
					</div>
				</div>
			</div>

			<div>
				{ /* Result of the generation */ }
				<div className={ classes.reflectionContainer }>{ results }</div>

				{ /* Saved generations */ }
				<SavedGenerations
					savedItems={ savedItems }
					deleteSavedItem={ deleteSavedItem }
				/>
			</div>
		</div>
	);
}
