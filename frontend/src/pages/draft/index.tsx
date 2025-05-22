import { useState, useContext, Fragment } from 'react';
import { UserContext } from '@/contexts/userContext';
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
// import classes from './styles.module.css';
import SavedGenerations from './savedGenerations';
import { getBefore } from '@/utilities/selectionUtil';
import { useDocContext } from '@/utilities';

const visibleNameForMode = {
	'Completion': 'Suggestions',
	'Question': 'Questions',
	'Keywords': 'Keywords',
	'RMove': 'Rhetorical Move'
};

const obscuredAlphabetForMode = {
	'Completion': 'A',
	'Question': 'B',
	'Keywords': 'C',
	'RMove': 'D'
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



export default function Draft({ editorAPI }: { editorAPI: EditorAPI }) {
	const { username } = useContext(UserContext);
	const docContext = useDocContext(editorAPI);
	const [genCtxText, updateGenCtxText] = useState('');

	const [isLoading, setIsLoading] = useState(false);

	// TODO: Consider using a "hook" for the toast temporary msg
	const [copied, _setCopied] = useState(false);
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

	const IS_OBSCURED = false;

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
			const response = await fetch(`${SERVER_URL}/generation`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
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


	// Tailwind replacement for error, init, result, spinner, and icon containers
	let results = null;
	if (errorMsg !== '')
		results = (
			<div className="mx-4 p-4 transition text-red-600 text-center">
				<div className="text-base">{ errorMsg }</div>
			</div>
		);
	else if (generationMode === 'None' || generation === null)
		if (!docContext.beforeCursor.trim())
			results = (
				<div className="mt-4 mx-4 p-4 transition">
					<div className="text-sm text-gray-500 text-center transition">Write something in the document to get started!</div>
				</div>
			);
		else
			results = (
				<div className="mt-4 mx-4 p-4 transition">
					<div className="text-sm text-gray-500 text-center transition">Click a button to generate a suggestion.</div>
				</div>
			);
	else
		results = (
			<div className="mt-1 mx-2 p-4 border border-gray-300 rounded-2xl transition flex">
				<div>
					<div
						className="text-xs text-gray-400 pb-1 cursor-pointer hover:text-black"
						onMouseEnter={ () => setTooltipVisible('GenCtx') }
						onMouseLeave={ () => setTooltipVisible(null) }
					>
						{ genCtxText.length > 100 ? '...' : '' }
						{ genCtxText.substring(genCtxText.length - 100) }
					</div>

					{ /* Question: do we need this? */ }
					{ false && tooltipVisible === 'GenCtx' && (
						<div
							className="absolute top-[18%] left-1/2 -translate-x-1/2 bg-gray-100 bg-opacity-70 text-gray-500 px-3 py-2 rounded text-xs font-light whitespace-nowrap z-50 opacity-100 pointer-events-none shadow-md"
						>
							{ 'Generated based on this document text' }
						</div>
					) }
					<div className="text-base whitespace-pre-wrap transition flex-col animate-fadeIn">
						<GenerationResult generation={ generation } />
					</div>
				</div>
				<div className="flex flex-col justify-center items-center ml-auto">
					<div className="bg-white rounded-lg p-1">
						{ iconFunc(generationMode) }
					</div>
				</div>
			</div>
		);

	if (isLoading && !generation)
		results = (
			<div className="flex z-[999] justify-center items-center p-4">
				<div className="border-4 border-blue-300 border-t-white rounded-full w-8 h-8 animate-spin"></div>
			</div>
		);

	return (
		<div className="flex flex-col gap-2 relative p-2">

			{ /* Document Context Text Container */ }
			<div className="text-xs p-2 m-2 shadow-[0_6px_10px_0_rgba(147,123,109,0.1)]">
				<h4 className="text-xs mt-0.5 mb-1">Suggestions will be generated using:</h4>
				<p className="break-all whitespace-normal">
					{ getBefore(docContext).length > 100 ? '...' : '' }
					{ getBefore(docContext).substring(getBefore(docContext).length - 100) }
					{ /* { JSON.stringify(docContext) } */ }
				</p>
			</div>

			<div>
				{ /* Generation Option Buttons */ }
				<div
					className="flex flex-row justify-center mt-4 mb-4 relative"
					onMouseEnter={ () => setTooltipVisible('Disabled') }
					onMouseLeave={ () => setTooltipVisible(null) }
				>
					{ ['Completion', 'Question', 'Keywords', 'RMove'].map(mode => (
						<Fragment key={ mode }>
							<button
								className="bg-white text-base font-semibold w-[42px] h-[42px] flex justify-center items-center border border-gray-100 transition duration-150 cursor-pointer rounded-full m-1 disabled:cursor-default hover:enabled:bg-gray-100 hover:enabled:shadow-[0_6px_10px_0_rgba(120,60,20,0.1)] hover:enabled:rotate-6"
								disabled={ docContext.beforeCursor === '' || isLoading }
								onClick={ async () => {
									log({ username, interaction: `${mode}_Frontend`, prompt: getBefore(docContext) });
									if (getBefore(docContext) === '') return;
									updateGenerationMode(mode);
									getGeneration(username, `${mode}_Backend`, getBefore(docContext));
								} }
								onMouseEnter={ () => setTooltipVisible(mode) }
								onMouseLeave={ () => setTooltipVisible(null) }
							>
								{ IS_OBSCURED ? obscuredAlphabetForMode[mode as keyof typeof obscuredAlphabetForMode] : visibleIconForMode[mode as keyof typeof visibleIconForMode] }
							</button>
							{ tooltipVisible === mode && (
								<div className="absolute top-[120%] left-1/2 -translate-x-1/2 bg-gray-100 bg-opacity-90 text-gray-700 px-3 py-2 rounded text-xs font-light whitespace-nowrap z-50 opacity-100 pointer-events-none shadow-md">
									{ IS_OBSCURED ? 'Get New Completion' : `Get New ${ visibleNameForMode[mode as keyof typeof visibleNameForMode] }` }
								</div>
							) }
						</Fragment>
					)) }
					</div>

				<div className="mx-2">
					<div className="text-[0.75rem] text-gray-400 text-center">Please note that the quality of AI-generated text may vary</div>
				</div>
			</div>

			<div>
				{ /* Result of the generation */ }
				<div className="my-2">{ results }</div>

				{ /* Close and Save button container */ }
				<div className="flex flex-row m-2 justify-center items-center relative">
					{ copied && (
						<div className="flex justify-center items-center animate-fade mr-auto">
							<div className="text-green-700 font-light pr-1">Copied!</div>
							<FcCheckmark />
						</div>
					) }
					{ saved && (
						<div className="flex justify-center items-center animate-fade mr-auto">
							<div className="text-indigo-400 font-light pr-1">Saved</div>
							<AiOutlineSave className="text-indigo-400" />
						</div>
					) }
					{ generationMode !== 'None' && !isLoading && generation && errorMsg === '' && (
						<div className="bg-gray-200 inline-flex flex-row justify-center items-center ml-auto rounded-xl p-1 shadow-md">
							<div
								className="cursor-pointer bg-gray-200 rounded-lg p-1 mx-0.5 flex justify-end items-center shadow-sm transition hover:bg-gray-300"
								onClick={ () => {
									updateGenerationMode('None');
									updateGeneration(null);
									results = null;
								} }
								onMouseEnter={ () => setTooltipVisible('Close') }
								onMouseLeave={ () => setTooltipVisible(null) }
							>
								<AiOutlineClose className="text-sm text-gray-500 transition hover:text-gray-700 hover:rotate-180" />
							</div>
							{ tooltipVisible === 'Close' && (
								<div className="absolute top-[120%] right-[10%] bg-gray-200 bg-opacity-90 text-gray-700 px-2 py-1 rounded text-xs font-light whitespace-nowrap z-50 opacity-100 pointer-events-none shadow-md">Close</div>
							) }
							<div
								className="cursor-pointer bg-gray-200 rounded-lg p-1 mx-0.5 flex justify-end items-center shadow-sm transition hover:bg-gray-300"
								onClick={ () => {
									// Save the generation
									save(generation, docContext.beforeCursor);

									setSaved(true);
									setTimeout(() => setSaved(false), 2000);
								} }
								onMouseEnter={ () => setTooltipVisible('Save') }
								onMouseLeave={ () => setTooltipVisible(null) }
							>
								<AiOutlineStar className={ saved ? 'text-yellow-400 text-base transition' : 'text-gray-500 text-base transition hover:text-gray-700 hover:rotate-90' } />
							</div>
							{ tooltipVisible === 'Save' && (
								<div className="absolute top-[120%] right-0 bg-gray-200 bg-opacity-90 text-gray-700 px-2 py-1 rounded text-xs font-light whitespace-nowrap z-50 opacity-100 pointer-events-none shadow-md">Save</div>
							) }
						</div>
					) }
				</div>

				{ /* Saved generations */ }
				<SavedGenerations
					docContext={ docContext }
					saved={ saved }
					isLoading={ isLoading }
					savedItems={ savedItems }
					deleteSavedItem={ deleteSavedItem }
				/>
			</div>
		</div>
	);
}
