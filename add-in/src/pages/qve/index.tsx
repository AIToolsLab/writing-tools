import { useState, useEffect } from 'react';

import { fetchEventSource } from '@microsoft/fetch-event-source';

import { Toggle } from '@fluentui/react/lib/Toggle';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';

import { SERVER_URL } from '@/api';

function sanitize(text: string): string {
	return text.replace('"', '').replace('\'', '');
}

import classes from './styles.module.css';

export default function QvE() {
	// TO DO: find better sentence delimiters
	const SENTENCE_DELIMITERS = ['. ', '? ', '! '];

	// const { username } = useContext(UserContext);
	const [docText, updateDocText] = useState('');
	const [_cursorSentence, updateCursorSentence] = useState('');

	const [questionButtonActive, updateQuestionButtonActive] = useState(false);
	const [exampleButtonActive, updateExampleButtonActive] = useState(false);

	const [isLoading, setIsLoading] = useState(false);

	// eslint-disable-next-line prefer-const
	let [questions, updateQuestions] = useState('');
    
	// eslint-disable-next-line prefer-const
	let [completion, setCompletion] = useState('');

	const [generationMode, updateGenerationMode] = useState('None');
	const [positionalSensitivity, setPositionalSensitivity] = useState(false);

	// Hidden for now
	const IS_SWITCH_VISIBLE = false;

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
				updateQuestions(questions + choice.delta.content.slice(0, -1));
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

		// complete(sanitize(contextText));

		setIsLoading(true);

		await fetchEventSource(`${SERVER_URL}/completion`, {
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

				if (choice.finish_reason === 'stop') setIsLoading(false);
				else {
					const newContent = choice.text;
					completion += newContent;
					setCompletion(completion);
				}
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
	if (generationMode === 'Questions') {
		if (questions.length > 0)
			results = <div className={ classes.resultTextWrapper }><div className={ classes.resultText }>{ questions }</div></div>;
	}
 	else {
		// completion
		if (completion.length > 0)
			results = <div className={ classes.resultTextWrapper }><div className={ classes.resultText }>{ completion + '.' }</div></div>;
	}

	if (isLoading && !results)
		results = (
			<div>
				<Spinner size={SpinnerSize.large} />
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
							updateGenerationMode('Questions');
							getQuestions(docText);
						} }
					>
						Get New Questions
					</button>

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
							updateGenerationMode('Examples');
							getExamples(docText);
						} }
					>
						Get New Examples
					</button>
				</div>
			</div>
			{ /* <div>{ cursorSentence ? cursorSentence : 'Nothing selected' }</div> */ }
			<div>
				<div className={ classes.reflectionContainer }>{ results }</div>
			</div>
		</div>
	);
}
