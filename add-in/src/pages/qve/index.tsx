import { useState, useEffect, useContext } from 'react';

import { FcNext } from 'react-icons/fc';
import { Remark } from 'react-remark';

import { Toggle } from '@fluentui/react/lib/Toggle';
import { Spinner } from '@fluentui/react/lib/Spinner';

import { UserContext } from '@/contexts/userContext';

import { useChat } from '@/hooks/useChat';
import { useCompletion } from '@/hooks/useCompletions';

import { SERVER_URL } from '@/api';

function sanitize(text: string): string {
	return text.replace('"', '').replace("'", '');
}

import classes from './styles.module.css';

export default function QvE() {
  const QUESTION_PROMPT = `Ask 3 specific questions based on this sentence. These questions should be able to be re-used as inspiration for writing tasks on the same topic, without having the original text on-hand, and should not imply the existence of the source text. The questions should be no longer than 20 words.`;

  const POSITIONAL_EXAMPLE_PROMPT = `You are a helpful writing assistant. Given a paper, come up with three possible next sentences that could follow the specified sentence. List in dashes-`;

	// TO DO: find better sentence delimiters
	const SENTENCE_DELIMITERS = ['. ', '? ', '! '];

	const { username } = useContext(UserContext);
	const [docText, updateDocText] = useState('');
	const [cursorSentence, updateCursorSentence] = useState('');

	const [questionButtonActive, updateQuestionButtonActive] = useState(false);
	const [exampleButtonActive, updateExampleButtonActive] = useState(false);

    const { complete, completion, isLoading } = useCompletion({ SERVER_URL });

	// Separate state for the messages because the useChat hook doesn't manage its own chat state
	const [questionsChatMessages, updateQuestionsChatMessages] = useState<{ role: string; content: string; done?: boolean}[]>([]);
	const questionsRespense = questionsChatMessages[questionsChatMessages.length - 1];

	const questionsChat = useChat({
		SERVER_URL,
		chatMessages: questionsChatMessages,
		updateChatMessages: updateQuestionsChatMessages,
		username
	});
	
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

			updateDocText(body.text.trim());
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
		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		const example = await complete(sanitize(contextText));
		console.log("Example: ", example);

		// construct the pseudo-conversation to turn it into a question
		let messages = [
			{"role": "system", "content": QUESTION_PROMPT},
		]

		questionsChat.append(example, messages);
	}

	/**
	 * Retrieves example next sentences for the document text.
	 * This function sends a request to the server to generate next sentences for the given text.
	 * The generated examples are then used to update the examples state.
	 *
	 * @param {string}
	 */
	async function getExamples(contextText: string) {
		// eslint-disable-next-line no-console
		console.assert(
			typeof contextText === 'string' && contextText !== '',
			'contextText must be a non-empty string'
		);

		complete(sanitize(contextText));
	}

	// useEffect to ensure that event handlers are set up only once
	// and cleaned up when the component is unmounted.
	// Note that dependences are empty, so this effect only runs once.
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
		if (questionsChatMessages.length > 0) {
			results = <Remark>{questionsRespense.content}</Remark>;
		}
	} else {
		// completion
		if (completion.length > 0) {
			results = <Remark>{ completion + '.' }</Remark>;
		}
	}

	if (isLoading && !results) {
		results = (
			<div>
				<Spinner
					label="Loading..."
					labelPosition="right"
				/>
			</div>
		);
	}

	return (
		<div className={ classes.container }>
			{ IS_SWITCH_VISIBLE && (
				<Toggle
					className={ classes.toggle }
					label="Positional Sensitivity"
					inlineLabel
					onChange={ (_event, checked) => {
							if (checked)
									setPositionalSensitivity(true);
							else
									setPositionalSensitivity(false);
					} }
					checked={ positionalSensitivity }
				/>
				)
			}

			<div>
				<div className={ classes.optionsContainer }>
					<button
						className={ questionButtonActive ? classes.optionsButtonActive : classes.optionsButton }
						disabled={
							docText === '' ||
							(questionsChatMessages.length > 0 &&
								!questionsChatMessages[questionsChatMessages.length - 1].done)
						}
						onClick={ () => {
							if (docText === '') { return ;}
							updateQuestionsChatMessages([]);
							updateQuestionButtonActive(true);
							updateExampleButtonActive(false);
							updateGenerationMode('Questions');
							getQuestions(docText);
						} }
					>
						Get New Questions
					</button>

					<button
						className={ exampleButtonActive ? classes.optionsButtonActive : classes.optionsButton }
						disabled={
							docText === '' ||
							(isLoading)
						}
						onClick={ () => {
							if (docText === '') { return ;}
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
				<div className={ classes.reflectionContainer }>
					{results}
				</div>
			</div>
		</div>
	);
}
