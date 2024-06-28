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
} from 'react-icons/ai';

import { SERVER_URL } from '@/api';

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
	const [isQuestionTooltipVisible, setQuestionTooltipVisible] = useState(false);
	const [isKeywordsTooltipVisible, setKeywordsTooltipVisible] = useState(false);
	const [isStructureTooltipVisible, setStructureTooltipVisible] = useState(false);

	const [isSaveTooltipVisible, setSaveTooltipVisible] = useState(false);
	const [isCloseTooltipVisible, setCloseTooltipVisible] = useState(false);
	const [isCopyTooltipVisible, setCopyTooltipVisible] = useState(false);

	// eslint-disable-next-line prefer-const
	const [generation, updateGeneration] = useState('');

	const [generationMode, updateGenerationMode] = useState('None');
	const [positionalSensitivity, setPositionalSensitivity] = useState(false);

	// Hidden for now
	const IS_SWITCH_VISIBLE = false;
	const IS_EXPERIMENTAL = true;
	const IS_OBSCURED = true;

    function save(generation: string, generationType: string, document: string) {
        const newSaved = [...savedItems];

        if(
            newSaved.filter(
                item => item.generation === generation && item.document === document
            ).length > 0
        )
            return;

        newSaved.push(
            {
                document: document,
                generation: generation,
                type: generationType,
                dateSaved: new Date()
            }
        );

        updateSavedItems(newSaved);
    }

    function deleteSavedItem(dateSaved: Date) {
        const newSaved = [...savedItems].filter(
            savedItem => savedItem.dateSaved !== dateSaved
        );

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

	/**
	 * Retrieves questions for the document text.
	 * This function sends a request to the server to generate questions for the given document text.
	 * The generated questions are then used to update the questions state.
	 *
	 * @param {string}
	 */
	async function getQuestions(contextText: string) {
		updateGeneration('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		const response = await fetch(`${SERVER_URL}/generation`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
                username: username,
                gtype: 'question',
				prompt: sanitize(contextText)
			}),
		});

        const question = await response.json();

        updateGeneration(question);
        setIsLoading(false);
	}

	/**
	 * Retrieves example next sentences for the document text.
	 * This function sends a request to the server to generate next sentences for the given text.
	 * The generated examples are then used to update the examples state.
	 *
	 * @param {string}
	 */
	async function getExamples(contextText: string) {
		updateGeneration('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		const response = await fetch(`${SERVER_URL}/generation`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
                username: username,
                gtype: 'chat_completion',
				prompt: sanitize(contextText)
			}),
		});

        const example = await response.json();

        updateGeneration(example);
        setIsLoading(false);
	}

	/**
	 * Retrieves keywords for the document text.
	 * This function sends a request to the server to generate keywords for the given document text.
	 * The generated keywords are then used to update the keywords state.
	 *
	 * @param {string}
	 */
	async function getKeywords(contextText: string) {
		updateGeneration('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		const response = await fetch(`${SERVER_URL}/generation`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
                username: username,
                gtype: 'keywords',
				prompt: sanitize(contextText)
			}),
		});

        const keywords = await response.json();

        updateGeneration(keywords);
        setIsLoading(false);
	}

	/**
	 * Retrieves structure for the document text.
	 * This function sends a request to the server to generate structure for the given document text.
	 * The generated structure is then used to update the structure state.
	 *
	 * @param {string}
	 */
	async function getStructure(contextText: string) {
		updateGeneration('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		const response = await fetch(`${SERVER_URL}/generation`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
                username: username,
                gtype: 'structure',
				prompt: sanitize(contextText)
			})
		});

        const structure = await response.json();

        updateGeneration(structure);
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
    
	if (generationMode === 'None' || generation.length === 0)
		if (!docText)
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
						Click button to generate a suggestion..
					</div>
				</div>
			);
 	else
        results = (
            <div className={ classes.resultTextWrapper }>
                <div className={ classes.resultText }>
                    { generation }
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
					Please note that AI generations may not be equally helpful
				</div>
			</div>

			<div>
				<div className={ classes.optionsContainer }>
					{ !IS_EXPERIMENTAL && (
						<>
							<button
								className={
									generationMode === 'Examples'
										? classes.optionsButtonActive
										: classes.optionsButton
								}
								disabled={ docText === '' || isLoading }
								onClick={ () => {
									if (docText === '') return;
                                    
									updateGenerationMode('Examples');
									getExamples(docText);
								} }
							>
								Get New Completion
							</button>
							
							<button
								className={
									generationMode === 'Questions'
										? classes.optionsButtonActive
										: classes.optionsButton
								}
								disabled={ docText === '' || isLoading }
								onClick={ () => {
									if (docText === '') return;
                                    
									updateGenerationMode('Questions');
									getQuestions(docText);
								} }
							>
								Get New Question
							</button>
						</>
					) }

					{
						IS_EXPERIMENTAL && (
							<>
								<button
									className={
										generationMode === 'Examples'
											? classes.optionsButtonActive
											: classes.optionsButton
									}
									disabled={ docText === '' || isLoading }
									onClick={ () => {
										if (docText === '') return;
                                        
										updateGenerationMode('Examples');
										getExamples(docText);
									} }
									onMouseEnter={ () => setExampleTooltipVisible(true) }
									onMouseLeave={ () => setExampleTooltipVisible(false) }
								>
									{ IS_OBSCURED ? 'A' : <AiOutlineAlignLeft /> }
								</button>

								{ (isExampleTooltipVisible && !IS_OBSCURED) && <div className={ [classes.tooltip, classes.tooltip_e].join(' ') }>Get New Completion</div> }

								<button
									className={
										generationMode === 'Questions'
											? classes.optionsButtonActive
											: classes.optionsButton
									}	
									disabled={ docText === '' || isLoading }
									onClick={ () => {
										if (docText === '') return;
                                        
										updateGenerationMode('Questions');
										getQuestions(docText);
									} }
									onMouseEnter={ () => setQuestionTooltipVisible(true) }
									onMouseLeave={ () => setQuestionTooltipVisible(false) }
								>
									{ IS_OBSCURED ? 'B' : <AiOutlineQuestion /> }
								</button>
								
                { (isQuestionTooltipVisible && !IS_OBSCURED) && <div className={ [classes.tooltip, classes.tooltip_q].join(' ') }>Get New Question</div> }

								<button
									className={
										generationMode === 'Keywords'
											? classes.optionsButtonActive
											: classes.optionsButton
									}
									disabled={ docText === '' || isLoading }
									onClick={ () => {
										if (docText === '') return;
                                        
										updateGenerationMode('Keywords');
										getKeywords(docText);
									} }
									onMouseEnter={ () => setKeywordsTooltipVisible(true) }
									onMouseLeave={ () => setKeywordsTooltipVisible(false) }
								>
									{ IS_OBSCURED ? 'C' : <AiOutlineHighlight /> }
								</button>

								{ (isKeywordsTooltipVisible && !IS_OBSCURED) && <div className={ [classes.tooltip, classes.tooltip_k].join(' ') }>Get New Keywords</div> }

								<button
									className={
										generationMode === 'Structure'
											? classes.optionsButtonActive
											: classes.optionsButton
									}
									disabled={ docText === '' || isLoading }
									onClick={ () => {
										if (docText === '') return;

										updateGenerationMode('Structure');
										getStructure(docText);
									} }
									onMouseEnter={ () => setStructureTooltipVisible(true) }
									onMouseLeave={ () => setStructureTooltipVisible(false) }
								>
									{ IS_OBSCURED ? 'D' : <AiOutlineBank /> }
								</button>

								{ (isStructureTooltipVisible && !IS_OBSCURED) && <div className={ [classes.tooltip, classes.tooltip_s].join(' ') }>Get New Structure</div> }
							</>
					) }
				</div>
			</div>
			
			<div>
				<div
					className={ classes.reflectionContainer }
				>
					{ results }
				</div>

				<div className={ classes.utilsContainer }>
					{ copied && (
						<div className={ classes.utilStateWrapper }>
							<div className={ classes.copiedStateText }>Copied!</div>

							<FcCheckmark />
						</div>
					) }

					{ saved && (
						<div className={ classes.utilStateWrapper }>
							<div className={ classes.savedStateText }>
								Saved
							</div>

							<AiOutlineSave className={ classes.savedStateIcon } />
						</div>
					) }

					{ (generationMode !== 'None' && !isLoading && generation) && (
						<div className={ classes.buttonsWrapper }>
							<div
								className={ classes.utilIconWrapper }
								onClick={ () => {
									updateGenerationMode('None');
									updateGeneration('');      
									results = null;
								} }
								onMouseEnter={ () => setCloseTooltipVisible(true) }
								onMouseLeave={ () => setCloseTooltipVisible(false) }
							>
								<AiOutlineClose className={ classes.closeIcon } />
							</div>

							{ isCloseTooltipVisible && <div className={ [classes.utilTooltip, classes.utilTooltip_close].join(' ') }>Close</div> }
							<div
								className={ classes.utilIconWrapper }
								onClick={ () => {
									// Copy the text to the clipboard
									// This will only work (for Chrome) for secure contexts (https)
									// https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
									navigator.clipboard.writeText(generation.trim());
									setCopied(true);
									setTimeout(() => setCopied(false), 2000);
								} }
								onMouseEnter={ () => setCopyTooltipVisible(true) }
								onMouseLeave={ () => setCopyTooltipVisible(false) }
							>
								<AiOutlineCopy className={ classes.copyIcon } />
							</div>
							{ isCopyTooltipVisible && <div className={ [classes.utilTooltip, classes.utilTooltip_copy].join(' ') }>Copy</div> }

							<div
								className={ classes.utilIconWrapper }
								onClick={ () => {
									// Save the generation
									save(generation, generationMode, docText);

									setSaved(true);
									setTimeout(() => setSaved(false), 2000);
								} }
								onMouseEnter={ () => setSaveTooltipVisible(true) }
								onMouseLeave={ () => setSaveTooltipVisible(false) }
							>
								<AiOutlineStar className={ saved ? classes.saved : classes.saveIcon } />
							</div>
							{ isSaveTooltipVisible && <div className={ [classes.utilTooltip, classes.utilTooltip_save].join(' ') }>Save</div> }
						</div>
					) }
				</div>

				<div className={ classes.historyContainer }>
					<div className={ classes.historyButtonWrapper }>
						<button
							className={ isSavedOpen ? classes.historyButtonActive : classes.historyButton }
							disabled={ docText === '' || isLoading }
							onClick={ () => {
								// Toggle between the current page and the saved page
								setSavedOpen(!isSavedOpen);
							} }
						>
							Saved
						</button>
					</div>
                    
					<div className={ classes.historyItemContainer }>
						{
							(isSavedOpen && savedItems.length === 0) ?
								(
									<div className={ classes.historyEmptyWrapper }>
										<div className={ classes.historyText }>No saved generations...</div>
									</div>
								)
								:
								(isSavedOpen && savedItems.length !== 0) && (
									savedItems.map((savedItem, index) => (
										<div key={ index } className={ classes.historyItem }>
											<div className={ classes.historyText }>
												<p
													className={ classes.historyDoc }
													onClick={
														() => {
															// Show the whole document text
														}
													}
												>
													...{ savedItem.document.substring(savedItem.document.length-100) }
												</p>
												
												<p>{ savedItem.generation }</p>

											</div>
											<div className={ classes.savedIconsContainer }>
												<div
													className={ classes.historyCloseButtonWrapper }
													onClick={ () => deleteSavedItem(savedItem.dateSaved) }
												>
													<AiOutlineClose className={ classes.historyCloseButton } />
												</div>
												<div className={ classes.genTypeIconWrapper }>
													{
                            savedItem.type === 'Examples' ? (IS_OBSCURED ? 'A' : <AiOutlineAlignLeft className={ classes.savedTypeIcon }/>)
														: savedItem.type === 'Questions' ? (IS_OBSCURED ? 'B' : <AiOutlineQuestion className={ classes.savedTypeIcon }/>)
														: savedItem.type === 'Keywords' ? (IS_OBSCURED ? 'C' : <AiOutlineHighlight className={ classes.savedTypeIcon }/>)
														: savedItem.type === 'Structure' ? (IS_OBSCURED ? 'D' : <AiOutlineBank className={ classes.savedTypeIcon }/>)
														: null
													}
												</div>
											</div>
										</div>
									))
								)
							}
					</div>
				</div>
			</div>
		</div>
	);
}
