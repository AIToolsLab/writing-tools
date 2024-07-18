import { useState, useEffect, useContext } from 'react';

import { UserContext } from '@/contexts/userContext';

import { Remark } from 'react-remark';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';
import { FcCheckmark } from 'react-icons/fc';
import { Toggle } from '@fluentui/react/lib/Toggle';
import {
	AiOutlineCopy,
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

function sanitize(text: string): string {
	return text.replace('"', '').replace('\'', '');
}


export default function QvE() {
	const { username } = useContext(UserContext);

	const [docContext, updateDocContext] = useState('');
	const [_cursorPos, updateCursorPos] = useState(0);
	const [_cursorAtEnd, updateCursorAtEnd] = useState(true);
	const [genCtxText, updateGenCtxText] = useState('');

	const [isLoading, setIsLoading] = useState(false);

	const [copied, setCopied] = useState(false);
	const [saved, setSaved] = useState(false);

	// State for saved page
	const [isSavedOpen, setSavedOpen] = useState(false);
	const [savedItems, updateSavedItems] = useState<SavedItem[]>([]);

	// Tooltip visibility
	const [tooltipVisible, setTooltipVisible] = useState<string | null>(null);
	const [copyWarningTooltipVisible, setCopyWarningTooltipVisible] = useState<boolean>(false);

	// eslint-disable-next-line prefer-const
	const [generation, updateGeneration] = useState('');

	// Update Error Message
	const [errorMsg, updateErrorMsg] = useState('');

	const [generationMode, updateGenerationMode] = useState('None');
	const [positionalSensitivity, setPositionalSensitivity] = useState(true);

	// Hidden for now
	const IS_SWITCH_VISIBLE = false;
	const IS_OBSCURED = true;

	function save(
		generation: string,
		generationType: string,
		document: string
	) {
		const newSaved = [...savedItems];

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
			type: generationType,
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
			prompt: savedItems.filter(savedItem => savedItem.dateSaved === dateSaved)[0].document,
			result: savedItems.filter(savedItem => savedItem.dateSaved === dateSaved)[0].generation,
		});

		updateSavedItems(newSaved);
	}

	/**
	 * Retrieves the text content of the Word document and updates the docText state.
	 *
	 * @returns {Promise<void>} - A promise that resolves once the selection change is handled.
	 */
	async function getDocContext(): Promise<void> {
		await Word.run(async (context: Word.RequestContext) => {
			const body: Word.Body = context.document.body;
			let contextText = '';

			if (positionalSensitivity) {
				// wordSelection will only be word touching cursor if none highlighted
				const wordSelection = context.document
					.getSelection()
					.getTextRanges([' '], false);

				context.load(wordSelection, 'items');
				await context.sync();

				// Get range from beginning of doc up to the last word in wordSelection
				const lastCursorWord = wordSelection
					.items[wordSelection.items.length - 1];
				const contextRange = lastCursorWord.expandTo(body.getRange('Start'));

				context.load(contextRange, 'text');
				await context.sync();
				contextText = contextRange.text;
			}
			else {
				context.load(body, 'text');
				await context.sync();
				contextText = body.text;
			}
			updateDocContext(contextText);
		});
	}

	/**
	 * Calculates the curent cursor position and updates the cursorPos and cursorAtEnd states.
	 * @returns {Promise<void>} - A promise that resolves once the selection change is handled.
	 */
	async function getCursorPosInfo(): Promise<void> {
		await Word.run(async (context: Word.RequestContext) => {
			const body: Word.Body = context.document.body;

			const cursorSelection = context.document.getSelection();
			const rangeToCursor = cursorSelection.expandTo(body.getRange('Start'));

			context.load(rangeToCursor, 'text');
			context.load(body, 'text');
			
			await context.sync();

			const charsToCursor = rangeToCursor.text.toString().length;
			updateCursorPos(charsToCursor);

			const docLength = body.text.toString().length;
			updateCursorAtEnd(charsToCursor >= docLength);
		});
	}

	async function getGeneration(username: string, type: string, contextText: string) {
		updateGeneration('');
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
							prompt: sanitize(contextText)
					}),
					signal: AbortSignal.timeout(7000)
			});
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}
			updateErrorMsg('');
			updateGeneration(await response.json());
			updateGenCtxText(contextText);
		}
		catch (err: any) {
			setIsLoading(false);
			let errMsg = '';
			if (err.name === 'AbortError')
				errMsg = `Oops, the system went too slow. Please try again.`;
			else
				errMsg = `${err.name}: ${err.message}. Please try again.`;

			updateErrorMsg(errMsg);
			updateGeneration('');
			log({
				username: username,
				interaction: type,
				prompt: sanitize(contextText),
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
		getDocContext();
		getCursorPosInfo();

		// Handle subsequent selection changes
		Office.context.document.addHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			getDocContext
		);
		Office.context.document.addHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			getCursorPosInfo
		);

		// Cleanup
		return () => {
			Office.context.document.removeHandlerAsync(
				Office.EventType.DocumentSelectionChanged,
				getDocContext
			);
			Office.context.document.removeHandlerAsync(
				Office.EventType.DocumentSelectionChanged,
				getCursorPosInfo
			);
		};
	}, [positionalSensitivity]);

	let results = null;

	if (errorMsg !== '')
		results = (
			<div className={ classes.errorTextWrapper }>
				<div className={ classes.errorText }>{ errorMsg }</div>
			</div>
		);
	else if (generationMode === 'None' || generation.length === 0)
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
  					<Remark>{ generation }</Remark>
					</div>
				</div>
				<div className={ classes.genIconsContainer }>
					<div
						className={
							!IS_OBSCURED ? classes.genTypeIconWrapper : classes.genTypeIconWrapper_obscured
						}
					>
						{ generationMode === 'Completion' ? (
							IS_OBSCURED ? (
								'a'
							) : (
								<AiOutlineAlignLeft
									className={
										classes.savedTypeIcon
									}
								/>
							)
						) : generationMode ===
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
						) : generationMode ===
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
						) : generationMode ===
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
		);

	if (isLoading && !generation)
		results = (
			<div className={ classes.spinnerWrapper }>
				<Spinner size={ SpinnerSize.large } />
			</div>
		);

	return (
		<div className={ classes.container }>
			{ IS_SWITCH_VISIBLE && (
				<div>
					<div
						onMouseEnter={ () => setTooltipVisible('PosSen') }
						onMouseLeave={ () => setTooltipVisible(null) }
					>
						<Toggle
							className={ classes.toggle }
							label="Positional Sensitivity"
							inlineLabel
							onChange={ (_event, checked) => {
								if (checked) setPositionalSensitivity(true);
								else setPositionalSensitivity(false);
								log({
									username: username,
									interaction: 'Positional Sensitivity',
									prompt: docContext,
									result: checked ? 'On' : 'Off'
								});
							} }
							checked={ positionalSensitivity }
						/>
					</div>

					{ tooltipVisible === 'PosSen' && (
						<div
							className={ [
								classes.disabledTooltip,
								classes.tooltip_posSen
							].join(' ') }
						>
							Base suggestions only on text up<br/>to the word touching the cursor
						</div>
					) }

				</div>
			) }

			<div className={ classes.contextText }>
				<h4>Suggestions will be generated using:</h4>
				{ docContext.length > 100 ? '...' : '' }
				{ docContext.substring(docContext.length-100) }
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
								disabled={ (docContext.trim() === '' || isLoading) }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Completion_Frontend',
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode('Completion');
									getGeneration(username, 'Completion_Backend', docContext);
								} }
								onMouseEnter={ () =>
									setTooltipVisible('Completion')
								}
								onMouseLeave={ () =>
									setTooltipVisible(null)
								}
							>
								{ IS_OBSCURED ? 'a' : <AiOutlineAlignLeft /> }
							</button>

							{ tooltipVisible === 'Completion' && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_e
									].join(' ') }
								>
									{ !IS_OBSCURED ? 'Get New Completion' : 'Get New Suggestion' }
								</div>
							) }

							<button
								className={ classes.optionsButton }
								disabled={ (docContext.trim() === '' || isLoading) }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Question_Frontend',
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode('Question');
									getGeneration(username, 'Question_Backend', docContext);
								} }
								onMouseEnter={ () =>
									setTooltipVisible('Question')
								}
								onMouseLeave={ () =>
									setTooltipVisible(null)
								}
							>
								{ IS_OBSCURED ? 'b' : <AiOutlineQuestion /> }
							</button>

							{ tooltipVisible === 'Question' && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_q
									].join(' ') }
								>
									{ !IS_OBSCURED ? 'Get New Question' : 'Get New Suggestion' }
								</div>
							) }
						</div>

						<div className={ classes.optionsButtonWrapperTwo }>
							<button
								className={ classes.optionsButton }
								disabled={ (docContext.trim() === '' || isLoading) }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Keywords_Frontend',
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode('Keywords');
									getGeneration(username, 'Keywords_Backend', docContext);
								} }
								onMouseEnter={ () =>
									setTooltipVisible('Keywords')
								}
								onMouseLeave={ () =>
									setTooltipVisible(null)
								}
							>
								{ IS_OBSCURED ? 'c' : <AiOutlineHighlight /> }
							</button>

							{ tooltipVisible === 'Keywords' && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_k
									].join(' ') }
								>
									{ !IS_OBSCURED ? 'Get New Keywords' : 'Get New Suggestion' }
								</div>
							) }

							<button
								className={ classes.optionsButton }
								disabled={ (docContext.trim() === '' || isLoading) }
								onClick={ () => {
									log({
										username: username,
										interaction: 'RMove_Frontend',
										prompt: docContext
									});
									if (docContext === '') return;

									updateGenerationMode('RMove');
									getGeneration(username, 'RMove_Backend', docContext);
								} }
								onMouseEnter={ () =>
									setTooltipVisible('RMove')
								}
								onMouseLeave={ () =>
									setTooltipVisible(null)
								}
							>
								{ IS_OBSCURED ? 'd' : <AiOutlineBank /> }
							</button>

							{ tooltipVisible === 'RMove' && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_s
									].join(' ') }
								>
									{ !IS_OBSCURED ? 'Get New Rhetorical Move' : 'Get New Suggestion' }
								</div>
							) }
						</div>
					</>
				</div>
			
				<div className={ classes.noteTextWrapper }>
					<div className={ classes.noteText }>
						Please note that the quality of AI-generated text may vary
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

					{ generationMode !== 'None' && !isLoading && generation && errorMsg === '' && (
						<div className={ classes.buttonsWrapper }>
							<div
								className={ classes.utilIconWrapper }
								onClick={ () => {
									updateGenerationMode('None');
									updateGeneration('');
									results = null;
								} }
								onMouseEnter={ () =>
									setTooltipVisible('Close')
								}
								onMouseLeave={ () => {
									setTooltipVisible(null);
									setCopyWarningTooltipVisible(false);
								}	}
							>
								<AiOutlineClose className={ classes.closeIcon } />
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
							{ /* <div
								className={ classes.utilIconWrapper }
								onClick={ () => {
									// Copy the text to the clipboard
									// This will only work for Safari and Firefox (will not work for Chrome)
									// https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
									// https://github.com/OfficeDev/office-js/issues/1991
									navigator.clipboard.writeText(
										generation.trim()
									);
									setCopied(true);
									setTimeout(() => setCopied(false), 2000);

									// log
									log({
										username: username,
										interaction: 'Copy',
										prompt: docContext,
										result: generation
									});
								} }
								onMouseEnter={ () => {
									setTooltipVisible('Copy');
									// If entered more than a second, show the warning tooltip
									setTimeout(() => setCopyWarningTooltipVisible(true), 1000);
								} }
								onMouseLeave={ () => {
									setTooltipVisible(null);
									setCopyWarningTooltipVisible(false);
								}	}
							>
								<AiOutlineCopy className={ classes.copyIcon } />
							</div>
							{ tooltipVisible === 'Copy' && (
								<div
									className={ [
										classes.utilTooltip,
										classes.utilTooltip_copy
									].join(' ') }
								>
									Copy
								</div>
							) } */ }
							{ copyWarningTooltipVisible && tooltipVisible === 'Copy' && (
								<div
									className={ [
										classes.utilTooltip,
										classes.utilTooltip_warning
									].join(' ') }
								>
									Please note that<br/>copy-to-clipboard<br/>button may not work<br/>for <strong>Chrome</strong>
								</div>
							) }

							<div
								className={ classes.utilIconWrapper }
								onClick={ () => {
									// Save the generation
									save(generation, generationMode, docContext);

									setSaved(true);
									setTimeout(() => setSaved(false), 2000);
								} }
								onMouseEnter={ () =>
									setTooltipVisible('Save')
								}
								onMouseLeave={ () => {
									setTooltipVisible(null);
									setCopyWarningTooltipVisible(false);
								}	}
							>
								<AiOutlineStar
									className={
										saved ? classes.saved : classes.saveIcon
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
							onMouseEnter={ () =>
								setTooltipVisible('Saved')
							}
							onMouseLeave={ () => {
								setTooltipVisible(null);
								setCopyWarningTooltipVisible(false);
							}	}
						>
							<div className={ classes.savedPageIconIndicatorContainer }>
								<AiOutlineStar
									className={
										isSavedOpen || saved
										? classes.savedPageIconActive
										: classes.savedPageIcon
									}
								/>
								{ isSavedOpen ? <AiOutlineUp className={ classes.savedPageIconIndicator }/>
								: <AiOutlineDown className={ classes.savedPageIconIndicator }/>
								}
							</div>
						</button>
						{ tooltipVisible === 'Saved' && (
							!isSavedOpen ? <div className={ classes.savedPageTooltip }>Show Saved Items</div>
							: <div className={ classes.savedPageTooltip }>Hide Saved Items</div>
						) }
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

										<Remark>{ savedItem.generation }</Remark>
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
												!IS_OBSCURED ? classes.genTypeIconWrapper : classes.genTypeIconWrapper_obscured
											}
										>
											{ savedItem.type === 'Completion' ? (
												IS_OBSCURED ? (
													'a'
												) : (
													<AiOutlineAlignLeft
														className={
															classes.savedTypeIcon
														}
													/>
												)
											) : savedItem.type ===
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
											) : savedItem.type ===
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
											) : savedItem.type ===
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
				</div>
			</div>
		</div>
	);
}
