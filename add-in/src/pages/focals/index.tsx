import { useState, useEffect, useContext } from 'react';

import { FcNext } from 'react-icons/fc';
import { AiOutlineSync, AiOutlineCopy } from 'react-icons/ai';

import { UserContext } from '@/contexts/userContext';

import { getParagraphText } from '@/utilities';
import { getReflectionFromServer } from '@/api';

import classes from './styles.module.css';

export default function Focals() {
	const { username } = useContext(UserContext);

	const [_paragraphTexts, updateParagraphTexts] = useState<string[]>([]);
	const [cursorParaText, updateCursorParaText] = useState('');
	
    const [sidebarParaText, updateSidebarParaText] = useState('');
	
    const [audience, updateAudience] = useState('General');
	const [questions, updateQuestions] = useState<string[]>([]);
	const [rewrite, updateRewrite] = useState('');
	
    const [generationMode, updateGenerationMode] = useState('');
	const [copiedAlertText, updateCopiedAlertText] = useState('');

	/**
	 * Loads the text content of all paragraphs in the Word document and updates the paragraph texts.
	 * This function retrieves and loads all paragraphs from the Word document and extracts their text content.
	 * The extracted paragraph texts are then used to update and refresh the paragraphTexts state.
	 *
	 * @returns {Promise<void>} - A promise that resolves once the paragraph texts are loaded and updated.
	 */
	function loadParagraphTexts(): Promise<void> {
		// TODO: We are not expecting frequent document changes yet. Consider caching.
		return Word.run(async (context: Word.RequestContext) => {
			const paragraphs: Word.ParagraphCollection =
				context.document.body.paragraphs;

			paragraphs.load();
			await context.sync();

			const newParagraphTexts: string[] = paragraphs.items.map(item =>
				getParagraphText(item)
			);

			updateParagraphTexts(newParagraphTexts);
		});
	}

	/**
	 * Handles the change in selection within the Word document.
	 * Retrieves the selected paragraphs and updates the current paragraph text accordingly.
	 * Also updates the paragraph texts, potentially triggering an expensive operation.
	 *
	 * @returns {Promise<void>} - A promise that resolves once the selection change is handled.
	 */
	async function handleSelectionChange(): Promise<void> {
		await Word.run(async (context: Word.RequestContext) => {
			const selectedParagraphs: Word.ParagraphCollection =
				context.document.getSelection().paragraphs;

			context.load(selectedParagraphs);
			await context.sync();

			const curParagraph: Word.Paragraph = selectedParagraphs.items[0];
			updateCursorParaText(getParagraphText(curParagraph));
		});

		// Potentially expensive
		loadParagraphTexts();
	}

	/**
	 * Retrieves questions for a given paragraph text.
	 * This function sends a request to the server to generate questions for the given paragraph text.
	 * The generated questions are then used to update the questions state.
	 *
	 * @param {string}
	 * @returns {void}
	 */
	async function getQuestions(paragraphText: string) {
		// eslint-disable-next-line no-console
		console.assert(
			typeof paragraphText === 'string' && paragraphText !== '',
			'paragraphText must be a non-empty string'
		);

		// const questionPrompt = `What are three questions about this paragraph? List in dashes -`;
		const questionPrompt = `You are a writing assistant who asks 3 dialogic questions on a provided paragraph for an audience at the ${audience} level. These questions should inspire writers to refine their personal ideas and voice in that paragraph and/or identify points for expansion. List questions in dashes -`;

		const questions: ReflectionResponseItem[] = await getReflectionFromServer(username, paragraphText, questionPrompt);
        updateQuestions(questions.map(item => item.reflection));
	}

	/**
	 * Retrieves a rewrite for a given paragraph text.
	 * This function sends a request to the server to generate a rewrite for the given paragraph text.
	 * The generated rewrite is then used to update the rewrite state.
	 *
	 * @param {string}
	 * @returns {void}
	 */
	async function getRewrite(paragraphText: string) {
		// eslint-disable-next-line no-console
		console.assert(
			typeof paragraphText === 'string' && paragraphText !== '',
			'paragraphText must be a non-empty string'
		);

		const rewritePrompt = `Rewrite this paragraph for an audience at the ${audience} level.`;

		const rewrite: ReflectionResponseItem[] = await getReflectionFromServer(username, paragraphText, rewritePrompt);
        updateRewrite(rewrite[0].reflection);
	}

	useEffect(() => {
		// Handle initial selection change
		handleSelectionChange();

		// Handle subsequent selection changes
		Office.context.document.addHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			handleSelectionChange
		);

		// Cleanup
		return () => {
			Office.context.document.removeHandlerAsync(
				Office.EventType.DocumentSelectionChanged,
				handleSelectionChange
			);
		};
	}, []);

	return (
		<div className={ classes.container }>
			<div>
				<h2>Audience</h2>

				<div className={ classes.audienceButtonContainer }>
					<input
						defaultChecked
						type="radio"
						name="AudienceSwitch"
						id="General"
						value="General"
						onClick={ () => updateAudience('General') }
					/>

					<label
						className={ classes.buttonItem }
						htmlFor="General"
					>
						General
					</label>

					<input
						type="radio"
						name="AudienceSwitch"
						id="Knowledgeable"
						value="Knowledgeable"
						onClick={ () => updateAudience('Knowledgeable') }
					/>

					<label
						className={ classes.buttonItem }
						htmlFor="Knowledgeable"
					>
						Knowledgeable
					</label>

					<input
						type="radio"
						name="AudienceSwitch"
						id="Expert"
						value="Expert"
						onClick={ () => updateAudience('Expert') }
					/>

					<label
						className={ classes.buttonItem }
						htmlFor="Expert"
					>
						Expert
					</label>
				</div>
			</div>

			<div className={ classes.contextContainer }>
				<div className={ classes.ctxTitleHeader }>
					<h2>Context</h2>

					<AiOutlineSync
						className={
							sidebarParaText.trim() !== cursorParaText.trim() &&
							cursorParaText.trim() !== ''
								? classes.syncIcon
								: classes.syncIconInvisible
						}
						onClick={ () => {
							if (cursorParaText !== '') {
								updateSidebarParaText(cursorParaText);
								getQuestions(cursorParaText);
								getRewrite(cursorParaText);
							}
						} }
					/>
				</div>

				<p className={ classes.contextTextArea }>
					{ sidebarParaText !== ''
						? sidebarParaText
						: 'Please select a paragraph.' }
				</p>
			</div>

			<div>
				<h2>Options</h2>

				<div className={ classes.optionsContainer }>
					<button
						className={ classes.optionsButton }
						onClick={ () => {
							if (sidebarParaText !== '') {
								updateRewrite('');
								updateGenerationMode('Questions');
								getQuestions(sidebarParaText);
							}
						} }
					>
						Ask me Questions
					</button>

					<button
						className={ classes.optionsButton }
						onClick={ () => {
							if (sidebarParaText !== '') {
								updateQuestions([]);
								updateGenerationMode('Rewrite');
								getRewrite(sidebarParaText);
							}
						} }
					>
						Rewrite for me
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
								<div className={ classes.questionsIconWrapper }>
									<FcNext className={ classes.questionsIcon } />
								</div>

								{ question }
							</div>
						)) }

					{ generationMode === 'Rewrite' && (
						<>
							<div className={ classes.rewriteText }>{ rewrite }</div>

							<div className={ classes.copyWrapper }>
								<AiOutlineCopy
									className={ classes.copyIcon }
									onClick={ () => {} }
								/>
                                
								<div className={ classes.copiedAlert }>
									{ copiedAlertText }
								</div>
							</div>
						</>
					) }

					{ !rewrite && !questions.length && (
						<div>
							Select one of the options to continue...
						</div>
					) }
				</div>
			</div>
		</div>
	);
}
