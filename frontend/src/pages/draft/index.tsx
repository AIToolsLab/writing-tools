import { useState, useContext, Fragment } from 'react';
import { UserContext } from '@/contexts/userContext';
import { EditorContext } from '@/contexts/editorContext';
import { Remark } from 'react-remark';
import { FcCheckmark } from 'react-icons/fc';
import {
	AiOutlineClose,
	AiOutlineQuestion,
	AiOutlineAlignLeft,
	AiOutlineHighlight,
	AiOutlineBank,
	AiOutlineStar,
	AiOutlineSave
} from 'react-icons/ai';
import { iconFunc } from './iconFunc';
import { SERVER_URL, log } from '@/api';
import classes from './styles.module.css';
import SavedGenerations from './savedGenerations';
import { getBefore } from '@/utilities/selectionUtil';
import { useDocContext } from '@/utilities';
import { useAccessToken } from '@/contexts/authTokenContext';

const visibleNameForMode = {
	'Completion': 'Suggestions',
	'Question': 'Questions',
	'Keywords': 'Keywords',
	'RMove': 'Rhetorical Move'
};

const visibleIconForMode = {
	'Completion': <AiOutlineAlignLeft />,
	'Question': <AiOutlineQuestion />,
	'Keywords': <AiOutlineHighlight />,
	'RMove': <AiOutlineBank />
};


function GenerationResult({ generation }: { generation: GenerationResult }) {
	return <Remark>{ generation.result }</Remark>;
}

export default function Draft() {
	const editorAPI = useContext(EditorContext);
	const docContext = useDocContext(editorAPI);
	const { username } = useContext(UserContext);
	const { getAccessToken, authErrorType } = useAccessToken();
	const [genCtxText, updateGenCtxText] = useState('');

	const [isLoading, setIsLoading] = useState(false);

	// TODO: Consider using a "hook" for the toast temporary msg
	const [saved, setSaved] = useState(false);

	// State for saved page
	const [savedItems, updateSavedItems] = useState<SavedItem[]>([]);

	// Tooltip visibility
	const [tooltipVisible, setTooltipVisible] = useState<string | null>(null);

	// eslint-disable-next-line prefer-const
	const [generation, updateGeneration] = useState<GenerationResult | null>(
		null
	);

	// Update Error Message
	const [errorMsg, updateErrorMsg] = useState('');

	const [generationMode, updateGenerationMode] = useState('None');



	// Save the generation
	function save(generation: GenerationResult, document: string) {
		const newSaved = [...savedItems];

		// Don't re-save things that are already saved
		if (
			newSaved.filter(
				item =>
					item.generation === generation && item.document === document
			).length > 0
		)
			return;

		newSaved.unshift({
			document: document,
			generation: generation,
			dateSaved: new Date()
		});

		log({
			username: username,
			interaction: 'Save',
			prompt: document,
			result: generation
		});

		updateSavedItems(newSaved);
	}

	// Delete a saved item
	function deleteSavedItem(dateSaved: Date) {
		const newSaved = [...savedItems].filter(
			savedItem => savedItem.dateSaved !== dateSaved
		);

		log({
			username: username,
			interaction: 'Delete',
			prompt: savedItems.filter(
				savedItem => savedItem.dateSaved === dateSaved
			)[0].document,
			result: savedItems.filter(
				savedItem => savedItem.dateSaved === dateSaved
			)[0].generation
		});

		updateSavedItems(newSaved);
	}


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
			updateGeneration((await response.json()) as GenerationResult);
			updateGenCtxText(contextText);
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
				interaction: type,
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
	else if (generationMode === 'None' || generation === null)
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
						onMouseEnter={ () => setTooltipVisible('GenCtx') }
						onMouseLeave={ () => setTooltipVisible(null) }
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
						{ iconFunc(generationMode) }
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
					{ getBefore(docContext).length > 100 ? '...' : '' }
					{ getBefore(docContext).substring(getBefore(docContext).length - 100) }
					{ /* { JSON.stringify(docContext) } */ }
				</p>
			</div>

			<div>
				{ /* Generation Option Buttons */ }
				<div
					className={ classes.optionsContainer }
					onMouseEnter={ () => setTooltipVisible('Disabled') }
					onMouseLeave={ () => setTooltipVisible(null) }
				>
					{ ['Completion', 'Question', 'Keywords', 'RMove'].map(mode => {
						return (
							<Fragment key={ mode }>
							<button
								className={ classes.optionsButton }
								disabled={ docContext.beforeCursor === '' || isLoading }
								onClick={ async () => {
									// if (docContext.beforeCursor !== '') {
									// 	await selectToCursor();
									// }

									log({
										username: username,
										interaction: `${mode}_Frontend`,
										prompt: getBefore(docContext)
									});
									if (getBefore(docContext) === '') return;

									updateGenerationMode(mode);
									getGeneration(
										username,
										`${mode}_Backend`,
										getBefore(docContext)
									);
								} }
								onMouseEnter={ () =>
									setTooltipVisible(mode)
								}
								onMouseLeave={ () => setTooltipVisible(null) }
							>
							   { visibleIconForMode[mode as keyof typeof visibleIconForMode] }
							</button>

							{ tooltipVisible === mode && (
								<div className={ classes.tooltip }>
								   { `Get New ${ visibleNameForMode[mode as keyof typeof visibleNameForMode] }` }
								</div>
							) }
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

				{ /* Close and Save button container */ }
				<div className={ classes.utilsContainer }>
					{ saved && (
						<div className={ classes.utilStateWrapper }>
							<div className={ classes.savedStateText }>Saved</div>

							<AiOutlineSave className={ classes.savedStateIcon } />
						</div>
					) }

					{ generationMode !== 'None' &&
						!isLoading &&
						generation &&
						errorMsg === '' && (
							<div className={ classes.buttonsWrapper }>
								<div
									className={ classes.utilIconWrapper }
									onClick={ () => {
										updateGenerationMode('None');
										updateGeneration(null);
										results = null;
									} }
									onMouseEnter={ () =>
										setTooltipVisible('Close')
									}
									onMouseLeave={ () => {
										setTooltipVisible(null);
									} }
								>
									<AiOutlineClose
										className={ classes.closeIcon }
									/>
								</div>

								{ tooltipVisible === 'Close' && (
									<div
										className={ [
											classes.utilTooltip,
											classes.utilTooltip_close
										].join(' ') }
									>
										Close
									</div>
								) }

								<div
									className={ classes.utilIconWrapper }
									onClick={ () => {
										// Save the generation
										save(generation, docContext.beforeCursor);

										setSaved(true);
										setTimeout(() => setSaved(false), 2000);
									} }
									onMouseEnter={ () =>
										setTooltipVisible('Save')
									}
									onMouseLeave={ () => {
										setTooltipVisible(null);
									} }
								>
									<AiOutlineStar
										className={
											saved
												? classes.saved
												: classes.saveIcon
										}
									/>
								</div>
								{ tooltipVisible === 'Save' && (
									<div
										className={ [
											classes.utilTooltip,
											classes.utilTooltip_save
										].join(' ') }
									>
										Save
									</div>
								) }
							</div>
						) }
				</div>

				{ /* Saved generations */ }
				<SavedGenerations
					saved={ saved }
					savedItems={ savedItems }
					deleteSavedItem={ deleteSavedItem }
				/>
			</div>
		</div>
	);
}
