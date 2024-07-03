import { useState, useEffect, useContext } from 'react';

import { UserContext } from '@/contexts/userContext';

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

	// TO DO: find better sentence delimiters
	const SENTENCE_DELIMITERS = ['. ', '? ', '! '];

	const [docText, updateDocText] = useState('');
	const [_cursorSentence, updateCursorSentence] = useState('');

	const [isLoading, setIsLoading] = useState(false);

	const [copied, setCopied] = useState(false);
	const [saved, setSaved] = useState(false);

	// State for saved page
	const [isSavedOpen, setSavedOpen] = useState(false);
	const [savedItems, updateSavedItems] = useState<SavedItem[]>([]);

	// Tooltip visibility
	const [isExampleTooltipVisible, setExampleTooltipVisible] = useState(false);
	const [isQuestionTooltipVisible, setQuestionTooltipVisible] =
		useState(false);
	const [isKeywordsTooltipVisible, setKeywordsTooltipVisible] =
		useState(false);
	const [isStructureTooltipVisible, setStructureTooltipVisible] =
		useState(false);

	const [isSaveTooltipVisible, setSaveTooltipVisible] = useState(false);
	const [isCloseTooltipVisible, setCloseTooltipVisible] = useState(false);
	const [isCopyTooltipVisible, setCopyTooltipVisible] = useState(false);
	const [isSavedPageTooltipVisible, setSavedPageTooltipVisible] = useState(false);

	// eslint-disable-next-line prefer-const
	const [generation, updateGeneration] = useState('');

	// Update Error Message
	const [errorMsg, updateErrorMsg] = useState('');

	const [generationMode, updateGenerationMode] = useState('None');
	const [positionalSensitivity, setPositionalSensitivity] = useState(false);

	// Hidden for now
	const IS_SWITCH_VISIBLE = false;
	const IS_EXPERIMENTAL = true;
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

		updateSavedItems(newSaved);
	}

	function deleteSavedItem(dateSaved: Date) {
		const newSaved = [...savedItems].filter(
			savedItem => savedItem.dateSaved !== dateSaved
		);

		log({
			username: username,
			interaction: 'Delete: ' + savedItems.filter(savedItem => savedItem.dateSaved === dateSaved)[0].type,
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
	async function getDocText(): Promise<void> {
		await Word.run(async (context: Word.RequestContext) => {
			const body: Word.Body = context.document.body;

			context.load(body, 'text');
			await context.sync();

			updateDocText(body.text);
		});
	}

	/**
	 * Retrieves the text content of the current cursor position and updates the cursorSentence state.
	 *
	 * @returns {Promise<void>} - A promise that resolves once the selection change is handled.
	 */
	async function getCursorSentence(): Promise<void> {
		await Word.run(async (context: Word.RequestContext) => {
			const sentences = context.document
				.getSelection()
				.getTextRanges(SENTENCE_DELIMITERS, true);
			sentences.load('text');
			await context.sync();

			updateCursorSentence(sentences.items[0].text);
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
					signal: AbortSignal.timeout(5000)
			});
			updateErrorMsg('');
			updateGeneration(await response.json());
		}
		catch (err: any) {
			setIsLoading(false);
			let errMsg = '';
			if (err.name === 'AbortError')
				errMsg = `${err.name}: Timeout. Please try again.`;
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
		getDocText();
		getCursorSentence();

		// Handle subsequent selection changes
		Office.context.document.addHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			getDocText
		);
		Office.context.document.addHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			getCursorSentence
		);

		// Cleanup
		return () => {
			Office.context.document.removeHandlerAsync(
				Office.EventType.DocumentSelectionChanged,
				getDocText
			);
			Office.context.document.removeHandlerAsync(
				Office.EventType.DocumentSelectionChanged,
				getCursorSentence
			);
		};
	}, []);

	let results = null;

	if (errorMsg !== '')
		results = (
			<div className={ classes.errorTextWrapper }>
				<div className={ classes.errorText }>{ errorMsg }</div>
			</div>
		);
	else if (generationMode === 'None' || generation.length === 0)
		if (!docText.trim())
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
			<div className={ classes.resultTextWrapper }>
				<div className={ classes.resultText }>{ generation }</div>
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
				<Toggle
					className={ classes.toggle }
					label="Positional Sensitivity"
					inlineLabel
					onChange={ (_event, checked) => {
						if (checked) setPositionalSensitivity(true);
						else setPositionalSensitivity(false);
					} }
					checked={ positionalSensitivity }
				/>
			) }

			<div className={ classes.noteTextWrapper }>
				<div className={ classes.noteText }>
					Please note that the quality of AI-generated text may vary
				</div>
			</div>

			<div>
				<div className={ classes.optionsContainer }>
					{ !IS_EXPERIMENTAL && (
						<>
							<button
								className={
									generationMode === 'Completion'
										? classes.optionsButtonActive
										: classes.optionsButton
								}
								disabled={ docText === '' || isLoading }
								onClick={ () => {
									if (docText === '') return;

									updateGenerationMode('Completion');
									getGeneration(username, 'Completion_Backend', docText);
								} }
							>
								Get New Completion
							</button>

							<button
								className={
									generationMode === 'Question'
										? classes.optionsButtonActive
										: classes.optionsButton
								}
								disabled={ docText === '' || isLoading }
								onClick={ () => {
									if (docText === '') return;

									updateGenerationMode('Question');
									getGeneration(username, 'Question_Backend', docText);
								} }
							>
								Get New Question
							</button>
						</>
					) }

					{ IS_EXPERIMENTAL && (
						<>
							<button
								className={
									generationMode === 'Completion'
										? classes.optionsButtonActive
										: classes.optionsButton
								}
								disabled={ docText === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Completion_Frontend',
										prompt: docText,
										result: generation
									});
									if (docText === '') return;

									updateGenerationMode('Completion');
									getGeneration(username, 'Completion_Backend', docText);
								} }
								onMouseEnter={ () =>
									setExampleTooltipVisible(true)
								}
								onMouseLeave={ () =>
									setExampleTooltipVisible(false)
								}
							>
								{ IS_OBSCURED ? 'A' : <AiOutlineAlignLeft /> }
							</button>

							{ isExampleTooltipVisible && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_e
									].join(' ') }
								>
									{ !IS_OBSCURED ? 'Get New Completion' : 'Get New Generation' }
								</div>
							) }

							<button
								className={
									generationMode === 'Question'
										? classes.optionsButtonActive
										: classes.optionsButton
								}
								disabled={ docText === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Question_Frontend',
										prompt: docText,
										result: generation
									});
									if (docText === '') return;

									updateGenerationMode('Question');
									getGeneration(username, 'Question_Backend', docText);
								} }
								onMouseEnter={ () =>
									setQuestionTooltipVisible(true)
								}
								onMouseLeave={ () =>
									setQuestionTooltipVisible(false)
								}
							>
								{ IS_OBSCURED ? 'B' : <AiOutlineQuestion /> }
							</button>

							{ isQuestionTooltipVisible && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_q
									].join(' ') }
								>
									{ !IS_OBSCURED ? 'Get New Question' : 'Get New Generation' }
								</div>
							) }

							<button
								className={
									generationMode === 'Keywords'
										? classes.optionsButtonActive
										: classes.optionsButton
								}
								disabled={ docText === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Keywords_Frontend',
										prompt: docText,
										result: generation
									});
									if (docText === '') return;

									updateGenerationMode('Keywords');
									getGeneration(username, 'Keywords_Backend', docText);
								} }
								onMouseEnter={ () =>
									setKeywordsTooltipVisible(true)
								}
								onMouseLeave={ () =>
									setKeywordsTooltipVisible(false)
								}
							>
								{ IS_OBSCURED ? 'C' : <AiOutlineHighlight /> }
							</button>

							{ isKeywordsTooltipVisible && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_k
									].join(' ') }
								>
									{ !IS_OBSCURED ? 'Get New Keywords' : 'Get New Generation' }
								</div>
							) }

							<button
								className={
									generationMode === 'Structure'
										? classes.optionsButtonActive
										: classes.optionsButton
								}
								disabled={ docText === '' || isLoading }
								onClick={ () => {
									log({
										username: username,
										interaction: 'Structure_Frontend',
										prompt: docText,
										result: generation
									});
									if (docText === '') return;

									updateGenerationMode('Structure');
									getGeneration(username, 'Structure_Backend', docText);
								} }
								onMouseEnter={ () =>
									setStructureTooltipVisible(true)
								}
								onMouseLeave={ () =>
									setStructureTooltipVisible(false)
								}
							>
								{ IS_OBSCURED ? 'D' : <AiOutlineBank /> }
							</button>

							{ isStructureTooltipVisible && (
								<div
									className={ [
										classes.tooltip,
										classes.tooltip_s
									].join(' ') }
								>
									{ !IS_OBSCURED ? 'Get New Structure' : 'Get New Generation' }
								</div>
							) }
						</>
					) }
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

					{ generationMode !== 'None' && !isLoading && generation && errorMsg !== '' && (
						<div className={ classes.buttonsWrapper }>
							<div
								className={ classes.utilIconWrapper }
								onClick={ () => {
									updateGenerationMode('None');
									updateGeneration('');
									results = null;
								} }
								onMouseEnter={ () =>
									setCloseTooltipVisible(true)
								}
								onMouseLeave={ () =>
									setCloseTooltipVisible(false)
								}
							>
								<AiOutlineClose className={ classes.closeIcon } />
							</div>

							{ isCloseTooltipVisible && (
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
										interaction: 'Copy_Button',
										prompt: docText,
										result: generation
									});
								} }
								onMouseEnter={ () => setCopyTooltipVisible(true) }
								onMouseLeave={ () =>
									setCopyTooltipVisible(false)
								}
							>
								<AiOutlineCopy className={ classes.copyIcon } />
							</div>
							{ isCopyTooltipVisible && (
								<div
									className={ [
										classes.utilTooltip,
										classes.utilTooltip_copy
									].join(' ') }
								>
									Copy
								</div>
							) }

							<div
								className={ classes.utilIconWrapper }
								onClick={ () => {
									// Save the generation
									save(generation, generationMode, docText);

									setSaved(true);
									setTimeout(() => setSaved(false), 2000);

									// log
									log({
										username: username,
										interaction: 'Save_Button',
										prompt: docText,
										result: generation
									});
								} }
								onMouseEnter={ () => setSaveTooltipVisible(true) }
								onMouseLeave={ () =>
									setSaveTooltipVisible(false)
								}
							>
								<AiOutlineStar
									className={
										saved ? classes.saved : classes.saveIcon
									}
								/>
							</div>
							{ isSaveTooltipVisible && (
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
							disabled={ docText === '' || isLoading }
							onClick={ () => {
								// Toggle between the current page and the saved page
								setSavedOpen(!isSavedOpen);
							} }
							onMouseEnter={ () => setSavedPageTooltipVisible(true) }
							onMouseLeave={ () => setSavedPageTooltipVisible(false) }
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
						{ isSavedPageTooltipVisible && (
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

										<p>{ savedItem.generation }</p>
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
											{ savedItem.type === 'Completion' ? (
												IS_OBSCURED ? (
													'A'
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
													'B'
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
													'C'
												) : (
													<AiOutlineHighlight
														className={
															classes.savedTypeIcon
														}
													/>
												)
											) : savedItem.type ===
											  'Structure' ? (
												IS_OBSCURED ? (
													'D'
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
