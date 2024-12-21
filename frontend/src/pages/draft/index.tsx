import { useState, useEffect, useContext, Fragment } from 'react';

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

import classes from './styles.module.css';
import SavedGenerations from './savedGenerations';

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
	const {
		addSelectionChangeHandler,
		removeSelectionChangeHandler,
		getDocContext,
		getCursorPosInfo
	} = editorAPI;

	const [docContext, updateDocContext] = useState('');
	const [_cursorPos, updateCursorPos] = useState(0);
	const [_cursorAtEnd, updateCursorAtEnd] = useState(true);
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

	async function handleSelectionChanged() {
		const docText = await getDocContext(true);
		updateDocContext(docText);
		const { charsToCursor, docLength } = await getCursorPosInfo();
		updateCursorPos(charsToCursor);
		updateCursorAtEnd(charsToCursor >= docLength);
	}

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

	/**
	 * useEffect to ensure that event handlers are set up only once
	 * and cleaned up when the component is unmounted.
	 * Note that dependencies are empty, so this effect only runs once.
	 */
	useEffect(() => {
		// Handle initial selection change
		handleSelectionChanged();

		// Handle subsequent selection changes
		addSelectionChangeHandler(handleSelectionChanged);

		// Cleanup
		return () => {
			removeSelectionChangeHandler(handleSelectionChanged);
		};
	}, []);

	let results = null;

	if (errorMsg !== '')
		results = (
			<div className={ classes.errorTextWrapper }>
				<div className={ classes.errorText }>{ errorMsg }</div>
			</div>
		);
	else if (generationMode === 'None' || generation === null)
		if (!docContext.trim())
			results = (
				<div className={ classes.initTextWrapper }>
					<div className={ classes.initText }>
						Write something in the document to get started!
					</div>
				</div>
			);
		else
			results = (
				<div className={ classes.initTextWrapper }>
					<div className={ classes.initText }>
						Click a button to generate a suggestion.
					</div>
				</div>
			);
	else
		results = (
			// <div className={ classes.resultTextWrapper }>
			// 	<div className={ classes.resultText }>{ generation }</div>
			// </div>
			<div className={ classes.resultTextWrapper }>
				<div>
					<div
						className={ classes.genCtxText }
						onMouseEnter={ () => setTooltipVisible('GenCtx') }
						onMouseLeave={ () => setTooltipVisible(null) }
					>
						{ genCtxText.length > 100 ? '...' : '' }
						{ genCtxText.substring(genCtxText.length - 100) }
					</div>

					{ /* Question: do we need this? */ }
					{ false && tooltipVisible === 'GenCtx' && (
						<div
							className={ [
								classes.disabledTooltip,
								classes.tooltip_genCtxText
							].join(' ') }
						>
							{ 'Generated based on this document text' }
						</div>
					) }
					<div className={ classes.resultText }>
						<GenerationResult generation={ generation } />
					</div>
				</div>
				<div className={ classes.genIconsContainer }>
					<div
						className={
							!IS_OBSCURED
								? classes.genTypeIconWrapper
								: classes.genTypeIconWrapper_obscured
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
		<div className={ classes.container }>

			{ /* Document Context Text Container */ }
			<div className={ classes.contextText }>
				<h4>Suggestions will be generated using:</h4>
				<p>
					{ docContext.length > 100 ? '...' : '' }
					{ docContext.substring(docContext.length - 100) }
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
								disabled={ docContext.trim() === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: `${mode}_Frontend`,
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode(mode);
									getGeneration(
										username,
										`${mode}_Backend`,
										docContext
									);
								} }
								onMouseEnter={ () =>
									setTooltipVisible(mode)
								}
								onMouseLeave={ () => setTooltipVisible(null) }
							>
								{ IS_OBSCURED ? obscuredAlphabetForMode[mode as keyof typeof obscuredAlphabetForMode] : visibleIconForMode[mode as keyof typeof visibleIconForMode] }
							</button>

							{ tooltipVisible === mode && (
								<div className={ classes.tooltip }>
									{ IS_OBSCURED
										? 'Get New Completion'
										: `Get New ${ visibleNameForMode[mode as keyof typeof visibleNameForMode] }` }
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
					{ /* Question: do we need this? */ }
					{ copied && (
						<div className={ classes.utilStateWrapper }>
							<div className={ classes.copiedStateText }>
								Copied!
							</div>

							<FcCheckmark />
						</div>
					) }

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
										save(generation, docContext);

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
					docContext= { docContext }
					saved={ saved }
					isLoading={ isLoading }
					savedItems={ savedItems }
					deleteSavedItem={ deleteSavedItem }
				/>
			</div>
		</div>
	);
}
