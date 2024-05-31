import { useState, useEffect, useContext } from 'react';
import { FcNext } from 'react-icons/fc';

import { ReflectionCards } from '@/components/reflectionCard';
import {
	defaultPrompt,
	PromptButtonSelector
} from '@/components/promptButtonSelector';

import { Button, DefaultButton } from '@fluentui/react/lib/Button';

import { UserContext } from '@/contexts/userContext';

import { getParagraphText } from '@/utilities';
import { getReflectionFromServer } from '@/api';

import classes from './styles.module.css';

export default function Focals() {
	const { username } = useContext(UserContext);

	const [paragraphTexts, updateParagraphTexts] = useState<string[]>([]);
	const [curParagraphText, updateCurParagraphText] = useState('');
	const [curAudience, updateCurAudience] = useState('General');
	const [questions, updateQuestions] = useState<string[]>([]);
	const [rewrite, updateRewrite] = useState('');

	const [reflections, updateReflections] = useState<
		Map<
			string,
			ReflectionResponseItem[] | Promise<ReflectionResponseItem[]>
		>
	>(new Map());

	const [prompt, updatePrompt] = useState(defaultPrompt);

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
			updateCurParagraphText(getParagraphText(curParagraph));
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
	function getQuestions(
		paragraphText: string,
	): void {
		// eslint-disable-next-line no-console
		console.assert(
			typeof paragraphText === 'string' && paragraphText !== '',
			'paragraphText must be a non-empty string'
		);
 
		// const questionPrompt = `What are three questions about this paragraph? List in dashes -`;
		const questionPrompt = `You are a writing assistant who asks 3 dialogic questions on a provided paragraph for an audience at the ${curAudience} level. These questions should inspire writers to refine their personal ideas and voice in that paragraph and/or identify points for expansion. List questions in dashes -`;

		const questionPromise: Promise<ReflectionResponseItem[]> =
			getReflectionFromServer(username, paragraphText, questionPrompt);

			questionPromise
				.then(newQuestion => {
					updateQuestions(newQuestion.map(item => item.reflection));
				})
				.catch(error => {
						// eslint-disable-next-line no-console
						console.log(error);
				});
		}

		function getRewrite(
			paragraphText: string,
		): void {
			// eslint-disable-next-line no-console
			console.assert(
				typeof paragraphText === 'string' && paragraphText !== '',
				'paragraphText must be a non-empty string'
			);
		
			const rewritePrompt = `Rewrite this paragraph for an audience at the ${curAudience} level.`;

			const questionPromise: Promise<ReflectionResponseItem[]> =
				getReflectionFromServer(username, paragraphText, rewritePrompt);

				questionPromise
					.then(newRewrite => {
						updateRewrite(newRewrite[0].reflection);
					})
					.catch(error => {
							// eslint-disable-next-line no-console
							console.log(error);
					});
			}


	/**
	 * Retrieves the reflections associated with a given paragraph text and prompt synchronously.
	 * If the reflections exist in the cache, they are returned immediately. Otherwise, an API
	 * request is made to fetch the reflections from the server, and any subsequent calls to this
	 * function with the same paragraph text and prompt will await the completion of the API request.
	 *
	 * @param {string} paragraphText - The text of the paragraph to retrieve reflections for.
	 * @param {string} prompt - The prompt used for reflection.
	 * @returns {ReflectionResponseItem[]} - The reflections associated with the paragraph text and prompt.
	 */
	function getReflectionsSync(
		paragraphText: string,
		prompt: string
	): ReflectionResponseItem[] {
		// eslint-disable-next-line no-console
		console.assert(
			typeof paragraphText === 'string' && paragraphText !== '',
			'paragraphText must be a non-empty string'
		);

		const cacheKey: string = JSON.stringify({ paragraphText, prompt });

		// TODO: Fix typing error
		const cachedValue: any
			// | ReflectionResponseItem[]
			// | Promise<ReflectionResponseItem[]> 
		= reflections.get(cacheKey);

		if (typeof cachedValue === 'undefined') {
			const reflectionsPromise: Promise<ReflectionResponseItem[]> =
				getReflectionFromServer(username, paragraphText, prompt);

			reflectionsPromise
				.then(newReflections => {
					reflections.set(cacheKey, newReflections);
					updateReflections(new Map(reflections));
				})
				.catch(_error => {
					reflections.delete(cacheKey);
				});

			reflections.set(cacheKey, reflectionsPromise);
			return [];
		}
 else if (cachedValue instanceof Promise) return [];
		else return cachedValue;
	}

	/**
	 * Creates reflection cards for a given paragraph and returns them as JSX element.
	 *
	 * @param {number} paragraphIndex - The index of the paragraph to create reflection cards for.
	 * @returns {React.JSX.Element} - The created reflection cards as a JSX element.
	 */
	function createReflectionCards(
		paragraphIndex: number,
	): JSX.Element {
		const reflectionsForThisParagraph: ReflectionResponseItem[] =
			getReflectionsSync(paragraphTexts[paragraphIndex], prompt);

		const cardDataList: CardData[] = reflectionsForThisParagraph.map(
			reflectionResponseItem => ({
				paragraphIndex,
				body: reflectionResponseItem.reflection
			})
		);

		return (
			<ReflectionCards
				cardDataList={ cardDataList }
				toggleCardHighlight={ false }
			/>
		);
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

	// Index of the currently selected paragraph
	const selectedIndex = paragraphTexts.indexOf(curParagraphText);
	const reflectionCardsContainer: React.JSX.Element[] = [];

	// Display the reflection cards that are relevant to the currently selected
	// paragraph, as well as its previous and next paragraphs
	if (selectedIndex !== -1) {
		// Check if the current paragraph is available
		if (paragraphTexts[selectedIndex] !== '')
			reflectionCardsContainer.push(
				createReflectionCards(selectedIndex)
			);
	}

	return (
		<div className={ classes.container }>
			<div>
				<h2>Audience</h2>
				{ /* <div className={ classes.audienceSelector }>
						<Button
								text="General"
						/>
						<DefaultButton
								text="Knowledgeable"
						/>
						<Button
								text="Expert"
						/>
				</div> */ }
				<div
					className={ classes.audienceButtonContainer }
				>
					<input
						type="radio"
						name="AudienceSwitch"
						id="General"
						value="General"
						onClick={ () => updateCurAudience('General') }
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
						onClick={ () => updateCurAudience('Knowledgeable') }
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
						onClick={ () => updateCurAudience('Expert') }
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
                <h2>Context</h2>

                <p className={ classes.contextTextArea }>
                    { paragraphTexts[selectedIndex] !== '' ? curParagraphText : 'Please select a paragraph.' }
                </p>
			</div>

			<div>
				<h2>Options</h2>
				<div
					className={ classes.optionsContainer }
				>
					<button
						className={ classes.optionsButton }
						onClick={ () => {
							if (paragraphTexts[selectedIndex] !== '') {
								updateRewrite('');
								getQuestions(paragraphTexts[selectedIndex]);
							}
						} }
					>
						Ask me Questions
					</button>
					<button
						className={ classes.optionsButton }
						onClick={ () => {
							if (paragraphTexts[selectedIndex] !== '') {
								updateQuestions([]);
								getRewrite(paragraphTexts[selectedIndex]);
							}
						} }
					>
						Rewrite for me
					</button>
				</div>
			</div>
			
			<div>
				<h2>Reflections</h2>
				<div
					className={ classes.reflectionContainer }
				>
					{ questions && questions.map((question, index) => (
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

					{ rewrite && <div className={ classes.rewriteText }>{ rewrite }</div> }

                    { !rewrite && !questions.length && <div className={ classes.reflectionItem }>Select one of the options to continue...</div> }
				</div>
			</div>
		</div>
	);
}
