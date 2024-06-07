import { useState, useEffect, useContext } from 'react';

import { FcNext } from 'react-icons/fc';

import { Toggle } from '@fluentui/react/lib/Toggle';
import { Spinner } from '@fluentui/react/lib/Spinner';

import { UserContext } from '@/contexts/userContext';

import { getLLMResponse } from '@/api';

import classes from './styles.module.css';

export default function QvE() {
  const QUESTION_PROMPT = `You are a helpful writing assistant. Write three possible next questions that the writer might answer. List in dashes-`;

  const EXAMPLE_PROMPT = `You are a helpful writing assistant. Write three possible next sentences that the writer might use. List in dashes-`;
	const POSITIONAL_EXAMPLE_PROMPT = `You are a helpful writing assistant. Given a paper, come up with three possible next sentences that could follow the specified sentence. List in dashes-`;

	// TO DO: find better sentence delimiters
	const SENTENCE_DELIMITERS = ['. ', '? ', '! '];

	const { username } = useContext(UserContext);
	const [docText, updateDocText] = useState('');
	const [cursorSentence, updateCursorSentence] = useState('');
	
	const [questionButtonActive, updateQuestionButtonActive] = useState(false);
	const [exampleButtonActive, updateExampleButtonActive] = useState(false);

	const [questions, updateQuestions] = useState<string[]>([]);
	const [examples, updateExamples] = useState<string[]>([]);
	
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

		const questions: ReflectionResponseItem[] = await getLLMResponse(username, contextText, QUESTION_PROMPT);
        updateQuestions(questions.map(item => item.reflection));
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

		const sysPrompt = positionalSensitivity ? POSITIONAL_EXAMPLE_PROMPT : EXAMPLE_PROMPT;
		const refText = positionalSensitivity ? contextText + '\n' + cursorSentence : contextText;

		const examples: ReflectionResponseItem[] = await getLLMResponse(username, refText, sysPrompt);
        updateExamples(examples.map(item => item.reflection));
	}

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
						onClick={ () => {
							if (docText !== '') {
								updateQuestions([]);
								updateExamples([]);
								updateQuestionButtonActive(true);
								updateExampleButtonActive(false);
								updateGenerationMode('Questions');
								getQuestions(docText);
							}
						} }
					>
						Get New Questions
					</button>

					<button
						className={ exampleButtonActive ? classes.optionsButtonActive : classes.optionsButton }
						onClick={ () => {
							if (docText !== '') {
								updateExamples([]);
								updateQuestions([]);
								updateExampleButtonActive(true);
								updateQuestionButtonActive(false);
								updateGenerationMode('Examples');
								getExamples(docText);
							}
						} }
					>
						Get New Examples
					</button>
				</div>
			</div>
			{ /* <div>{ cursorSentence ? cursorSentence : 'Nothing selected' }</div> */ }
			<div>
				<div className={ classes.reflectionContainer }>
					{ generationMode === 'Questions' && questions.length === 0 ? (
						<div>
							<Spinner
								label="Loading..."
								labelPosition="right"
							/>
						</div>
					) : (
						generationMode === 'Questions' &&
						questions.map((question, index) => (
							<div
								key={ index }
								className={ classes.reflectionItem }
							>
								<div className={ classes.itemIconWrapper }>
									<FcNext className={ classes.itemIcon } />
								</div>

								{ question }
							</div>
					))) }

					{ generationMode === 'Examples' && examples.length === 0 ? (
						<div>
							<Spinner
								label="Loading..."
								labelPosition="right"
							/>
						</div>
					) : (
						generationMode === 'Examples' &&
						examples.map((example, index) => (
							<div
								key={ index }
								className={ classes.reflectionItem }
							>
								<div className={ classes.itemIconWrapper }>
									<FcNext className={ classes.itemIcon } />
								</div>

								{ example }
							</div>
						))) }

					{ !examples.length && !questions.length && (
						<div className={ classes.initText }>
							Select one of the options to continue...
						</div>
					) }
				</div>
			</div>
		</div>
	);
}
