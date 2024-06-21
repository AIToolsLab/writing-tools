import { useState, useEffect } from 'react';

import { fetchEventSource } from '@microsoft/fetch-event-source';

import { Toggle } from '@fluentui/react/lib/Toggle';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';
import { FcCheckmark } from 'react-icons/fc';
import { AiOutlineCopy, AiOutlineClose } from 'react-icons/ai';

import { SERVER_URL } from '@/api';

import classes from './styles.module.css';

function sanitize(text: string): string {
	return text.replace('"', '').replace('\'', '');
}


export default function QvE() {
	// TO DO: find better sentence delimiters
	const SENTENCE_DELIMITERS = ['. ', '? ', '! '];

	// const { username } = useContext(UserContext);
	const [docText, updateDocText] = useState('');
	const [_cursorSentence, updateCursorSentence] = useState('');

	const [questionButtonActive, updateQuestionButtonActive] = useState(false);
	const [exampleButtonActive, updateExampleButtonActive] = useState(false);
	const [keywordButtonActive, updateKeywordButtonActive] = useState(false);
	const [structureButtonActive, updateStructureButtonActive] = useState(false);

	const [isLoading, setIsLoading] = useState(false);

	const [copied, setCopied] = useState(false);

	// eslint-disable-next-line prefer-const
	let [questions, updateQuestions] = useState('');
    
	// eslint-disable-next-line prefer-const
	let [completion, setCompletion] = useState('');

	// eslint-disable-next-line prefer-const
	let [keywords, setKeywords] = useState('');

	// eslint-disable-next-line prefer-const
	let [structure, setStructure] = useState('');

	const [generationMode, updateGenerationMode] = useState('None');
	const [positionalSensitivity, setPositionalSensitivity] = useState(false);

	// Hidden for now
	const IS_SWITCH_VISIBLE = false;
	const IS_EXPERIMENTAL = false;

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
		questions = '';
		updateQuestions('');

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
				prompt: sanitize(contextText)
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];

				if (choice.finish_reason === 'stop') {
					setIsLoading(false);
					return;
				}

				questions += choice.delta.content;
				updateQuestions(questions);
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
		completion = '';
		setCompletion('');

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
				prompt: sanitize(contextText)
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];

				if (choice.finish_reason === 'stop') {
					setIsLoading(false);
					return;
				}

				completion += choice.delta.content;
				setCompletion(completion + choice.delta.content.slice(0, -1));
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
		keywords = '';
		setKeywords('');
		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		await fetchEventSource(`${SERVER_URL}/keywords`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				prompt: sanitize(contextText)
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];

				if (choice.finish_reason === 'stop') {
					setIsLoading(false);
					return;
				}
				keywords += choice.delta.content;
				setKeywords(keywords);
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
	 * Retrieves structure for the document text.
	 * This function sends a request to the server to generate structure for the given document text.
	 * The generated structure is then used to update the structure state.
	 *
	 * @param {string}
	 */
	async function getStructure(contextText: string) {
		structure = '';
		setStructure('');
		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		setIsLoading(true);

		await fetchEventSource(`${SERVER_URL}/structure`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},	
			body: JSON.stringify({
				prompt: sanitize(contextText)
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];

				if (choice.finish_reason === 'stop') {
					setIsLoading(false);
					return;
				}
				structure += choice.delta.content;
				setStructure(structure);
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
	if (generationMode === 'None')
		results = <div className={ classes.initTextWrapper }><div className={ classes.initText }>Click button to generate question or example...</div></div>;
	else if (generationMode === 'Questions') {
		if (questions.length > 0)
			results = <div className={ classes.resultTextWrapper }><div className={ classes.resultText }>{ questions }</div></div>;
	}
	else if (generationMode === 'Structure') {
		// structure
		if (structure.length > 0)
			results = <div className={ classes.resultTextWrapper }><div className={ classes.resultText }>{ structure }</div></div>;
	}
	else if (generationMode === 'Keywords') {
		// keywords
		if (keywords.length > 0)
			results = <div className={ classes.resultTextWrapper }><div className={ classes.resultText }>{ keywords }</div></div>;
	}
 	else {
		// completion
		if (completion.length > 0)
			results = <div className={ classes.resultTextWrapper }><div className={ classes.resultText }>{ completion + '.' }</div></div>;
	}

	if (isLoading && !results)
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

			<div>
				<div className={ classes.optionsContainer }>
					<button
						className={
							questionButtonActive
								? classes.optionsButtonActive
								: classes.optionsButton
						}
						disabled={ docText === '' || isLoading }
						onClick={ () => {
							if (docText === '') return;
							updateQuestionButtonActive(true);
							updateExampleButtonActive(false);
							updateStructureButtonActive(false);
							updateKeywordButtonActive(false);
							updateGenerationMode('Questions');
							getQuestions(docText);
						} }
					>
						Get New Question
					</button>

					{ /* <div className={ classes.modeIconWrapper } >
						{
							generationMode === 'Questions' ? <FcQuestions /> : generationMode === 'None' ? <FcFile className={ classes.initIcon } /> : <FcDocument />
						}
					</div> */ }

					<button
						className={
							exampleButtonActive
								? classes.optionsButtonActive
								: classes.optionsButton
						}
						disabled={ docText === '' || isLoading }
						onClick={ () => {
							if (docText === '') return;
							updateExampleButtonActive(true);
							updateQuestionButtonActive(false);
							updateStructureButtonActive(false);
							updateKeywordButtonActive(false);
							updateGenerationMode('Examples');
							getExamples(docText);
						} }
					>
						Get New Example
					</button>

					{
						IS_EXPERIMENTAL && (
							<>
								<button
									className={
										keywordButtonActive
											? classes.optionsButtonActive
											: classes.optionsButton
									}
									disabled={ docText === '' || isLoading }
									onClick={ () => {
										if (docText === '') return;
										updateKeywordButtonActive(true);
										updateExampleButtonActive(false);
										updateQuestionButtonActive(false);
										updateStructureButtonActive(false);
										updateGenerationMode('Keywords');
										getKeywords(docText);
									} }
								>
									Get New Keywords
								</button>

								<button
									className={
										structureButtonActive
											? classes.optionsButtonActive
											: classes.optionsButton
									}
									disabled={ docText === '' || isLoading }
									onClick={ () => {
										if (docText === '') return;
										updateStructureButtonActive(true);
										updateKeywordButtonActive(false);
										updateExampleButtonActive(false);
										updateQuestionButtonActive(false);
										updateGenerationMode('Structure');
										getStructure(docText);
									} }
								>
									Get New Structure
								</button>
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
						<div className={ classes.copiedStateWrapper }>
							<div className={ classes.copiedStateText }>Copied!</div>
							<FcCheckmark />
						</div>
					) }
					{ generationMode !== 'None' && !isLoading && (
						<div className={ classes.buttonsWrapper }>
							<div
								className={ classes.closeIconWrapper }
								onClick={ () => {
									updateGenerationMode('None');
									updateQuestions('');
									setCompletion('');
									setKeywords('');
									setStructure('');
									updateKeywordButtonActive(false);
									updateStructureButtonActive(false);
									updateQuestionButtonActive(false);
									updateExampleButtonActive(false);
									results = null;
								} }
							>
								<AiOutlineClose className={ classes.closeIcon } />
							</div>
							{ ((questions || completion || keywords || structure) && !isLoading) && (
								<div
									className={ classes.copyIconWrapper }
									onClick={ () => {
										// Copy the text to the clipboard
										// This will only work (for Chrome) for secure contexts (https)
										// https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText
										navigator.clipboard.writeText(generationMode === 'Questions' ?  questions.trim() : generationMode === 'Examples' ? completion.trim() : '');
										setCopied(true);
										setTimeout(() => setCopied(false), 2000);
									} }
								>
									<AiOutlineCopy className={ classes.copyIcon } />
								</div>
							) }
							</div>
						) }
				</div>
			</div>
		</div>
	);
}
