import { useState, useEffect, useContext } from 'react';

import { UserContext } from '@/contexts/userContext';

import { fetchEventSource } from '@microsoft/fetch-event-source';

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
	const [historyOpen, setHistoryOpen] = useState(false);

	// Tooltip visibility
	const [isExampleTooltipVisible, setExampleTooltipVisible] = useState(false);
	const [isQuestionTooltipVisible, setQuestionTooltipVisible] = useState(false);
	const [isKeywordsTooltipVisible, setKeywordsTooltipVisible] = useState(false);
	const [isStructureTooltipVisible, setStructureTooltipVisible] = useState(false);

	const [isHistoryTooltipVisible, setHistoryTooltipVisible] = useState(false);
	const [isCloseTooltipVisible, setCloseTooltipVisible] = useState(false);
	const [isCopyTooltipVisible, setCopyTooltipVisible] = useState(false);

	// eslint-disable-next-line prefer-const
	let [generation, updateGeneration] = useState('');

	const [generationMode, updateGenerationMode] = useState('None');
	const [positionalSensitivity, setPositionalSensitivity] = useState(false);

	// Hidden for now
	const IS_SWITCH_VISIBLE = false;
	const IS_EXPERIMENTAL = true;

    function getHistory(): HistoryItem[] {
        return JSON.parse(localStorage.getItem('history') || '[]');
    }

    function saveToHistory(generation: string, generationType: string, document: string) {
        const history = getHistory();

        if (!history.filter(item => item.document === document).length)
            history.push(
                {
                    document: document,
                    generations: []
                }
            );
        else
            if(
                history.filter(
                    item => item.document === document
                )[0].generations.filter(
                    generationItem => generationItem.generation === generation
                ).length > 0
            ) return;

        history.filter(item => item.document === document)[0].generations.push(
            {
                generation: generation,
                type: generationType,
                dateSaved: new Date()
            }
        );

        localStorage.setItem('history', JSON.stringify(history));
    }

    function deleteHistoryItem(dateSaved: Date) {
        const history = getHistory();


        const newHistory = history.map(
            historyItem => (
                {
                    document: historyItem.document,
                    generations: historyItem.generations.filter(
                        generationItem => {
                            return generationItem.dateSaved !== dateSaved;
                        }
                    )   
                }
            )
        );

        localStorage.setItem('history', JSON.stringify(newHistory));
        setHistoryOpen(false);
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
		generation = '';
		updateGeneration('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		await fetchEventSource(`${SERVER_URL}/questions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: sanitize(contextText),
                username: username
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];

				if (choice.finish_reason === 'stop') {
					setIsLoading(false);
					return;
				}

				generation += choice.delta.content;
				updateGeneration(generation);
			},
			onerror(err) {
				// eslint-disable-next-line no-console
				console.error(err);

				// rethrow to avoid infinite retry.
				throw err;
			}
		});
	}

	/**
	 * Retrieves example next sentences for the document text.
	 * This function sends a request to the server to generate next sentences for the given text.
	 * The generated examples are then used to update the examples state.
	 *
	 * @param {string}
	 */
	async function getExamples(contextText: string) {
		generation = '';
		updateGeneration('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		await fetchEventSource(`${SERVER_URL}/chat-completion`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: sanitize(contextText),
                username: username
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];

				if (choice.finish_reason === 'stop') {
					setIsLoading(false);
					return;
				}

				generation += choice.delta.content;
				updateGeneration(generation + choice.delta.content.slice(0, -1));
			},
			onerror(err) {
				// eslint-disable-next-line no-console
				console.error(err);

				// rethrow to avoid infinite retry.
				throw err;
			}
		});
	}

	/**
	 * Retrieves keywords for the document text.
	 * This function sends a request to the server to generate keywords for the given document text.
	 * The generated keywords are then used to update the keywords state.
	 *
	 * @param {string}
	 */
	async function getKeywords(contextText: string) {
		generation = '';
		updateGeneration('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		const response = await fetch(`${SERVER_URL}/keywords`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: sanitize(contextText),
                username: username
			})
		});

        const result = await response.json();

        updateGeneration(result);
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
		generation = '';
		updateGeneration('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		const response = await fetch(`${SERVER_URL}/structure`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: sanitize(contextText),
                username: username
			})
		});

        const result = await response.json();

        updateGeneration(result);
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
		results = (
            <div className={ classes.initTextWrapper }>
                <div className={ classes.initText }>
                    Click button to generate question or example...
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
								Get New Example
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
									<AiOutlineAlignLeft />
								</button>

								{ isExampleTooltipVisible && <div className={ [classes.tooltip, classes.tooltip_e].join(' ') }>Get New Example</div> }

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
									<AiOutlineQuestion />
								</button>
								{ isQuestionTooltipVisible && <div className={ [classes.tooltip, classes.tooltip_q].join(' ') }>Get New Question</div> }

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
									<AiOutlineHighlight />
								</button>
								{ isKeywordsTooltipVisible && <div className={ [classes.tooltip, classes.tooltip_k].join(' ') }>Get New Keywords</div> }

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
									<AiOutlineBank />
								</button>
								{ isStructureTooltipVisible && <div className={ [classes.tooltip, classes.tooltip_s].join(' ') }>Get New Structure</div> }
							</>
					) }
				</div>
			</div>

			{ /* <div>{ cursorSentence ? cursorSentence : 'Nothing selected' }</div> */ }
			
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

					{ generationMode !== 'None' && !isLoading && (
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

							{ (generation && !isLoading) && (
								<>
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
											saveToHistory(generation, generationMode, docText);

											setSaved(true);
											setTimeout(() => setSaved(false), 2000);
										} }
										onMouseEnter={ () => setHistoryTooltipVisible(true) }
										onMouseLeave={ () => setHistoryTooltipVisible(false) }
									>
										<AiOutlineStar className={ saved ? classes.saved : classes.saveIcon } />
									</div>
									{ isHistoryTooltipVisible && <div className={ [classes.utilTooltip, classes.utilTooltip_save].join(' ') }>Save</div> }
								</>
							) }
							</div>
						) }
				</div>

				<div className={ classes.historyContainer }>
					<div className={ classes.historyButtonWrapper }>
						<button
							className={ historyOpen ? classes.historyButtonActive : classes.historyButton }
							disabled={ docText === '' || isLoading }
							onClick={ () => {
								// Toggle between the current page and the saved page
								setHistoryOpen(!historyOpen);
							} }
						>
							Saved
						</button>
					</div>
                    
					<div className={ classes.historyItemContainer }>
						{
                            (
                                historyOpen &&
                                (
                                    getHistory().length === 0 || getHistory().filter(historyItem => historyItem.generations.length > 0).length === 0
                                )
                            ) &&
                            (
                                <div className={ classes.historyEmptyWrapper }>
                                    <div className={ classes.historyText }>No saved generations...</div>
                                </div>
						    )
                        }
          
						{
                            historyOpen &&
                            (
                                getHistory().length > 0 && getHistory().filter(historyItem => historyItem.generations.length > 0).length > 0
                            )
                            && getHistory().map((historyItem, index) => (
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
                                            { historyItem.document.substring(0, 100) }...
                                        </p>
                                        
                                        <ul>
                                            {
                                                historyItem.generations.map((generationItem, index) => (
                                                    <li key={ index }>
                                                        <p>{ generationItem.generation }</p>

                                                        <div
                                                            className={ classes.historyCloseButtonWrapper }
                                                            onClick={ () => deleteHistoryItem(generationItem.dateSaved) }
                                                        >
                                                            <AiOutlineClose className={ classes.historyCloseButton } />
                                                        </div>
                                                    </li>   
                                                ))
                                            }
                                        </ul>
                                    </div>
                                </div>
						    ))
                        }
					</div>
				</div>
			</div>
		</div>
	);
}
