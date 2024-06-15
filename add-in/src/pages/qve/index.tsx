import { useState, useEffect } from 'react';

import { fetchEventSource } from '@microsoft/fetch-event-source';

import { Toggle } from '@fluentui/react/lib/Toggle';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';

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

	const [chatCompletionActive, updateChatCompletionButtonActive] = useState(false);
	const [plainCompletionButtonActive, updatePlainCompletionButtonActive] = useState(false);

	const [isLoading, setIsLoading] = useState(false);

	// eslint-disable-next-line prefer-const
	let [chatCompletion, updateChatCompletion] = useState('');
    
	// eslint-disable-next-line prefer-const
	let [plainCompletion, setPlainCompletion] = useState('');

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
	 * Retrieves chat completions for the document text.
	 * This function sends a request to the server to generate chat completions for the given document text.
	 * The generated chat completions are then used to update the chat completions state.
	 *
	 * @param {string}
	 */
	async function getChatCompletions(contextText: string) {
		chatCompletion = '';
		updateChatCompletion('');

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

				chatCompletion += choice.delta.content;
				updateChatCompletion(chatCompletion + choice.delta.content.slice(0, -1));
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
	 * Retrieves plain completions for the document text.
	 * This function sends a request to the server to generate plain completions for the given text.
	 * The generated plain completions are then used to update the plainCompletion state.
	 *
	 * @param {string}
	 */
	async function getPlainCompletions(contextText: string) {
		plainCompletion = '';
		setPlainCompletion('');

		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		// complete(sanitize(contextText));

		setIsLoading(true);

		await fetchEventSource(`${SERVER_URL}/plain-completion`, {
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
					plainCompletion += newContent;
					setPlainCompletion(plainCompletion);
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
	if (generationMode === 'None')
		results = <div className={ classes.initTextWrapper }><div className={ classes.initText }>Click button to generate plain completion...</div></div>;
	else if (generationMode === 'Chat Completions') {
		if (chatCompletion.length > 0)
			results = <div className={ classes.resultTextWrapper }><div className={ classes.resultText }>{ chatCompletion }</div></div>;
	}
 	else {
		// completion
		if (plainCompletion.length > 0)
			results = <div className={ classes.resultTextWrapper }><div className={ classes.resultText }>{ plainCompletion + '.' }</div></div>;
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
							chatCompletionActive
								? classes.optionsButtonActive
								: classes.optionsButton
						}
						disabled={ docText === '' || isLoading }
						onClick={ () => {
							if (docText === '') return;
							updateChatCompletionButtonActive(true);
							updatePlainCompletionButtonActive(false);
							updateGenerationMode('Chat Completions');
							getChatCompletions(docText);
						} }
					>
						Get Chat Completion
					</button>

					<button
						className={
							plainCompletionButtonActive
								? classes.optionsButtonActive
								: classes.optionsButton
						}
						disabled={ docText === '' || isLoading }
						onClick={ () => {
							if (docText === '') return;
							updatePlainCompletionButtonActive(true);
							updateChatCompletionButtonActive(false);
							updateGenerationMode('Plain Completions');
							getPlainCompletions(docText);
						} }
					>
						Get Plain Completion
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
