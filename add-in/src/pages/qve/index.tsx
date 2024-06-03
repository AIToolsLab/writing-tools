import { useState, useEffect, useContext } from 'react';

import { FcNext } from 'react-icons/fc';

import { UserContext } from '@/contexts/userContext';

import { getReflectionFromServer } from '@/api';

import classes from './styles.module.css';

export default function QvE() {
  const QUESTION_PROMPT = `You are a helpful writing assistant. Write three possible next questions that the writer might answer. List in dashes-`;

  const EXAMPLE_PROMPT = `You are a helpful writing assistant. Write three possible next sentences that the writer might use. List in dashes-`;

	const { username } = useContext(UserContext);
	const [docText, updateDocText] = useState('');

	const [questions, updateQuestions] = useState<string[]>([]);
	const [examples, updateExamples] = useState<string[]>([]);
	
  const [generationMode, updateGenerationMode] = useState('');

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
	 * Retrieves questions for the document text.
	 * This function sends a request to the server to generate questions for the given document text.
	 * The generated questions are then used to update the questions state.
	 *
	 * @param {string}
	 */
	async function getQuestions(paragraphText: string) {
		// eslint-disable-next-line no-console
		console.assert(
			typeof paragraphText === 'string' && paragraphText !== '',
			'paragraphText must be a non-empty string'
		);

		const questions: ReflectionResponseItem[] = await getReflectionFromServer(username, paragraphText, QUESTION_PROMPT);
        updateQuestions(questions.map(item => item.reflection));
	}

	/**
	 * Retrieves example next sentences for the document text.
	 * This function sends a request to the server to generate next sentences for the given text.
	 * The generated examples are then used to update the examples state.
	 *
	 * @param {string}
	 */
	async function getExamples(paragraphText: string) {
		// eslint-disable-next-line no-console
		console.assert(
			typeof paragraphText === 'string' && paragraphText !== '',
			'paragraphText must be a non-empty string'
		);

		const examples: ReflectionResponseItem[] = await getReflectionFromServer(username, paragraphText, EXAMPLE_PROMPT);
        updateExamples(examples.map(item => item.reflection));
	}

	useEffect(() => {
		// Handle initial selection change
		getDocText();

		// Handle subsequent selection changes
		Office.context.document.addHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			getDocText
		);

		// Cleanup
		return () => {
			Office.context.document.removeHandlerAsync(
				Office.EventType.DocumentSelectionChanged,
				getDocText
			);
		};
	}, []);

	return (
		<div className={ classes.container }>
			<div>
				<div className={ classes.optionsContainer }>
					<button
						className={ classes.optionsButton }
						onClick={ () => {
							if (docText !== '') {
								updateExamples([]);
								updateGenerationMode('Questions');
								getQuestions(docText);
							}
						} }
					>
						Get New Questions
					</button>

					<button
						className={ classes.optionsButton }
						onClick={ () => {
							if (docText !== '') {
								updateQuestions([]);
								updateGenerationMode('Examples');
								getExamples(docText);
							}
						} }
					>
						Get New Examples
					</button>
				</div>
			</div>

			<div>
				<div className={ classes.reflectionContainer }>
					{ generationMode === 'Questions' &&
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
						)) }

          { generationMode === 'Examples' &&
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
						)) }

					{ !examples && !questions.length && (
						<div>
							Select one of the options to continue...
						</div>
					) }
				</div>
			</div>
		</div>
	);
}
