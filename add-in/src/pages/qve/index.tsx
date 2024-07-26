import { useState, useEffect, useContext } from 'react';

import { UserContext } from '@/contexts/userContext';

import { Remark } from 'react-remark';
import ReactWordcloud from 'react-wordcloud';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';
import { FcCheckmark } from 'react-icons/fc';
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

import { SERVER_URL, log } from '@/api';

import classes from './styles.module.css';

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

	const [copied, _setCopied] = useState(false);
	const [saved, setSaved] = useState(false);

	// State for saved page
	const [isSavedOpen, setSavedOpen] = useState(false);
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
		const docText = await getDocContext(true);
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
					<div className={ classes.genTypeIconWrapper }>
						{ generationMode === 'Completion' ? (
							<AiOutlineAlignLeft
								className={ classes.savedTypeIcon }
							/>
						) : generationMode === 'Question' ? (
							<AiOutlineQuestion
								className={ classes.savedTypeIcon }
							/>
						) : generationMode === 'Keywords' ? (
							<AiOutlineHighlight
								className={ classes.savedTypeIcon }
							/>
						) : generationMode === 'RMove' ? (
							<AiOutlineBank className={ classes.savedTypeIcon } />
						) : null }
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
			<div className={ classes.contextText }>
				<h4>Suggestions will be generated using:</h4>

				<p>
					{ docContext.length > 100 ? '...' : '' }
					{ docContext.substring(docContext.length - 100) }
				</p>
			</div>

			<div>
				<div
					className={ classes.optionsContainer }
					onMouseEnter={ () => setTooltipVisible('Disabled') }
					onMouseLeave={ () => setTooltipVisible(null) }
				>
					<>
						<div className={ classes.optionsButtonWrapperTwo }>
							<button
								className={ classes.optionsButton }
								disabled={ docContext.trim() === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Completion_Frontend',
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode('Completion');
									getGeneration(
										username,
										'Completion_Backend',
										docContext
									);
								} }
								onMouseEnter={ () =>
									setTooltipVisible('Completion')
								}
								onMouseLeave={ () => setTooltipVisible(null) }
							>
								<AiOutlineAlignLeft />
							</button>

							{ tooltipVisible === 'Completion' && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_e
									].join(' ') }
								>
									Get New Completion
								</div>
							) }

							<button
								className={ classes.optionsButton }
								disabled={ docContext.trim() === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Question_Frontend',
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode('Question');
									getGeneration(
										username,
										'Question_Backend',
										docContext
									);
								} }
								onMouseEnter={ () =>
									setTooltipVisible('Question')
								}
								onMouseLeave={ () => setTooltipVisible(null) }
							>
								<AiOutlineQuestion />
							</button>

							{ tooltipVisible === 'Question' && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_q
									].join(' ') }
								>
									Get New Question
								</div>
							) }
						</div>

						<div className={ classes.optionsButtonWrapperTwo }>
							<button
								className={ classes.optionsButton }
								disabled={ docContext.trim() === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Keywords_Frontend',
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode('Keywords');
									getGeneration(
										username,
										'Keywords_Backend',
										docContext
									);
								} }
								onMouseEnter={ () =>
									setTooltipVisible('Keywords')
								}
								onMouseLeave={ () => setTooltipVisible(null) }
							>
								<AiOutlineHighlight />
							</button>

							{ tooltipVisible === 'Keywords' && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_k
									].join(' ') }
								>
									Get New Keywords
								</div>
							) }

							<button
								className={ classes.optionsButton }
								disabled={ docContext.trim() === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: 'RMove_Frontend',
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode('RMove');
									getGeneration(
										username,
										'RMove_Backend',
										docContext
									);
								} }
								onMouseEnter={ () => setTooltipVisible('RMove') }
								onMouseLeave={ () => setTooltipVisible(null) }
							>
								<AiOutlineBank />
							</button>

							{ tooltipVisible === 'RMove' && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_s
									].join(' ') }
								>
									Get New Rhetorical Move
								</div>
							) }
						</div>
					</>
				</div>

				<div className={ classes.noteTextWrapper }>
					<div className={ classes.noteText }>
						Please note that the quality of AI-generated text may
						vary
					</div>
				</div>
			</div>

			<div>
				<div className={ classes.reflectionContainer }>{ results }</div>

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

				<div className={ classes.historyContainer }>
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
												classes.genTypeIconWrapper
											}
										>
											{ savedItem.generation
												.generation_type ===
											'Completion' ? (
												<AiOutlineAlignLeft
													className={
														classes.savedTypeIcon
													}
												/>
											) : savedItem.generation
													.generation_type ===
											  'Question' ? (
												<AiOutlineQuestion
													className={
														classes.savedTypeIcon
													}
												/>
											) : savedItem.generation
													.generation_type ===
											  'Keywords' ? (
												<AiOutlineHighlight
													className={
														classes.savedTypeIcon
													}
												/>
											) : savedItem.generation
													.generation_type ===
											  'RMove' ? (
												<AiOutlineBank
													className={
														classes.savedTypeIcon
													}
												/>
											) : null }
										</div>
									</div>
								</div>
							))
						) }
					</div>
				</div>
			</div>
		</div>
	);
}
