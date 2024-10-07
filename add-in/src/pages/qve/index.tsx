import { useState, useEffect, useContext } from 'react';

import { UserContext } from '@/contexts/userContext';

import { Remark } from 'react-remark';
import ReactWordcloud from 'react-wordcloud';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';
import { FcCheckmark } from 'react-icons/fc';
import { Toggle } from '@fluentui/react/lib/Toggle';
import {
	AiOutlineClose,
	AiOutlineQuestion,
	AiOutlineAlignLeft,
	AiOutlineHighlight,
	AiOutlineBank,
	AiOutlineStar,
	AiOutlineSave,
	AiOutlineUp,
	AiOutlineDown
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

const USE_WORDCLOUD = false;

function GenerationResult({ generation }: { generation: GenerationResult }) {
	if (USE_WORDCLOUD && generation.generation_type === 'Keywords') {
		// Show all keywords as a word cloud
		const keywords = generation.extra_data.words_by_pos;
		// Collect all of the words
		const words: string[] = [];
		for (const pos in keywords) {
			words.push(...keywords[pos]);
		}
		return (
			<ReactWordcloud
				words={ words.map(word => ({ text: word, value: 1 })) }
				options={ {
					rotations: 0
				} }
			/>
		);
	}
	return <Remark>{ generation.result }</Remark>;
}

export default function QvE({ editorAPI }: { editorAPI: EditorAPI }) {
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

	// TODO: Consider using a "hook" for the toast temporarym msg
	const [copied, _setCopied] = useState(false);
	const [saved, setSaved] = useState(false);

	// State for saved page
	const [savedItems, updateSavedItems] = useState<SavedItem[]>([]);

	// Tooltip visibility
	const [tooltipVisible, setTooltipVisible] = useState<string | null>(null);
	const [copyWarningTooltipVisible, setCopyWarningTooltipVisible] =
		useState<boolean>(false);

	// eslint-disable-next-line prefer-const
	const [generation, updateGeneration] = useState<GenerationResult | null>(
		null
	);

	// Update Error Message
	const [errorMsg, updateErrorMsg] = useState('');

	const [generationMode, updateGenerationMode] = useState('None');
	const [positionalSensitivity, setPositionalSensitivity] = useState(true);

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

	async function getAndUpdateDocContext() {
		const docText = await getDocContext(positionalSensitivity);
		updateDocContext(docText);
	}

	async function getAndUpdateCursorPosInfo() {
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
				signal: AbortSignal.timeout(7000)
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
	 * Note that dependences are empty, so this effect only runs once.
	 */
	useEffect(() => {
		// Handle initial selection change
		getAndUpdateDocContext();
		getAndUpdateCursorPosInfo();

		// Handle subsequent selection changes
		addSelectionChangeHandler(getAndUpdateDocContext);
		addSelectionChangeHandler(getAndUpdateCursorPosInfo);

		// Cleanup
		return () => {
			removeSelectionChangeHandler(getAndUpdateDocContext);
			removeSelectionChangeHandler(getAndUpdateCursorPosInfo);
		};
	}, [positionalSensitivity]);

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
				<Spinner size={ SpinnerSize.large } />
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
							<>
							<button key={ mode }
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
							</>
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
										setCopyWarningTooltipVisible(false);
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
										setCopyWarningTooltipVisible(false);
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

				{  /* <div className={ classes.historyContainer }>
					<div className={ classes.historyButtonWrapper }>
						<button
							className={ classes.historyButton }
							disabled={ docContext.trim() === '' || isLoading }
							onClick={ () => {
								// Toggle between the current page and the saved page
								setSavedOpen(!isSavedOpen);
							} }
							onMouseEnter={ () => setTooltipVisible('Saved') }
							onMouseLeave={ () => {
								setTooltipVisible(null);
								setCopyWarningTooltipVisible(false);
							} }
						>
							<div
								className={
									classes.savedPageIconIndicatorContainer
								}
							>
								<AiOutlineStar
									className={
										isSavedOpen || saved
											? classes.savedPageIconActive
											: classes.savedPageIcon
									}
								/>
								{ isSavedOpen ? (
									<AiOutlineUp
										className={
											classes.savedPageIconIndicator
										}
									/>
								) : (
									<AiOutlineDown
										className={
											classes.savedPageIconIndicator
										}
									/>
								) }
							</div>
						</button>
						{ tooltipVisible === 'Saved' &&
							(!isSavedOpen ? (
								<div className={ classes.savedPageTooltip }>
									Show Saved Items
								</div>
							) : (
								<div className={ classes.savedPageTooltip }>
									Hide Saved Items
								</div>
							)) }
					</div>

					<div className={ classes.historyItemContainer }>
						{ isSavedOpen && savedItems.length === 0 ? (
							<div className={ classes.historyEmptyWrapper }>
								<div className={ classes.historyText }>
									No saved generations...
								</div>
							</div>
						) : (
							isSavedOpen &&
							savedItems.length !== 0 &&
							savedItems.map((savedItem, index) => (
								<div
									key={ index }
									className={ classes.historyItem }
								>
									<div className={ classes.historyText }>
										<p
											className={ classes.historyDoc }
											onClick={ () => {
												// Show the whole document text
											} }
										>
											...
											{ savedItem.document.substring(
												savedItem.document.length - 100
											) }
										</p>

										<GenerationResult
											generation={ savedItem.generation }
										/>
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
												!IS_OBSCURED
													? classes.genTypeIconWrapper
													: classes.genTypeIconWrapper_obscured
											}
										>
											{ savedItem.generation
												.generation_type ===
											'Completion' ? (
												IS_OBSCURED ? (
													'a'
												) : (
													<AiOutlineAlignLeft
														className={
															classes.savedTypeIcon
														}
													/>
												)
											) : savedItem.generation
													.generation_type ===
											  'Question' ? (
												IS_OBSCURED ? (
													'b'
												) : (
													<AiOutlineQuestion
														className={
															classes.savedTypeIcon
														}
													/>
												)
											) : savedItem.generation
													.generation_type ===
											  'Keywords' ? (
												IS_OBSCURED ? (
													'c'
												) : (
													<AiOutlineHighlight
														className={
															classes.savedTypeIcon
														}
													/>
												)
											) : savedItem.generation
													.generation_type ===
											  'RMove' ? (
												IS_OBSCURED ? (
													'd'
												) : (
													<AiOutlineBank
														className={
															classes.savedTypeIcon
														}
													/>
												)
											) : null }
										</div>
									</div>
								</div>
							))
						) }
					</div>
				</div> */  }

			</div>
		</div>
	);
}
