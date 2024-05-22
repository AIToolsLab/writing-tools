import { useState, useEffect, useContext } from 'react';

import { ReflectionCards } from '@/components/reflectionCard';
import { SearchBox } from '@/components/searchBox';
import { RhetoricalSituation } from '@/components/rhetoricalSituation';

import { UserContext } from '@/contexts/userContext';

import { getParagraphText } from '@/utilities';
import { getServerLLMResponse } from '@/api';

export default function Focals() {
	const { username } = useContext(UserContext);

	const [paragraphTexts, updateParagraphTexts] = useState<string[]>([]);
	const [curParagraphText, updateCurParagraphText] = useState('');

	const [reflections, updateReflections] = useState<
		Map<
			string,
			LLMResponseItem[] | Promise<LLMResponseItem[]>
		>
	>(new Map());

	const [prompt, updatePrompt] = useState('');
	const [prefix, updatePrefix] = useState('');
	const [suggestedPrompts, updateSuggestedPrompts] = useState<string[]>([
		'What is the main point of this paragraph?',
		'What are the important concepts in this paragraph?',
		'What are the claims or arguments presented in this paragraph?',
		'What are some potential counterarguments to the claims presented in this paragraph? Make tentative statements.',
		'What further evidence or examples would you like to see to support the claims presented in this paragraph?',
		'What outside the box questions do you have about this paragraph?',
		'What questions do you have about this paragraph as a writer?',
		'What questions do you have about this paragraph as a reader?',
]);

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
	 * Retrieves suggestions for prompts to ask about a piece of academic writing.
	 * Temporarily using getReflectionFromServer until the backend is sorted out.
	 * @param paragraphText - The text of the paragraph to generate prompts for.
	 * @returns void
	 */
	function getSuggestions(
		paragraphText: string,
	): void {
		// eslint-disable-next-line no-console
		console.assert(
			typeof paragraphText === 'string' && paragraphText !== '',
			'paragraphText must be a non-empty string'
		);
 
		// META-PROMPT TO GENERATE SUGGESTED PROMPTS GOES HERE
		const suggestionPrompt = 'Write 3 concise and brief prompts to ask a companion for various points about a piece of academic writing that may warrant reconsideration. Prompts might ask for the main point, important concepts, claims or arguments, possible counterarguments, additional evidence/examples, points of ambiguity, and questions as a reader/writer. Separate each prompt by a bullet point. List in dashes -';

		const suggestionsPromise: Promise<LLMResponseItem[]> =
			getServerLLMResponse(username, paragraphText, suggestionPrompt);

			suggestionsPromise
				.then(newPrompts => {
						updateSuggestedPrompts(prevPrompts => {
								// Prepend the suggestions to the list of hard-coded suggestions
								return [...newPrompts.map(prompt => prompt.reflection ), ...prevPrompts];
						});
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
	 * @returns {LLMResponseItem[]} - The reflections associated with the paragraph text and prompt.
	 */
	function getReflectionsSync(
		paragraphText: string,
		prompt: string
	): LLMResponseItem[] {
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
			const addtlDirections = ' Answer concisely with three bullet points: -';
			const reflectionsPromise: Promise<LLMResponseItem[]> =
				getServerLLMResponse(username, paragraphText, prompt + addtlDirections);

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
		const reflectionsForThisParagraph: LLMResponseItem[] =
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

		// Get suggested prompts for the current paragraph
		getSuggestions(curParagraphText);

		// Cleanup
		return () => {
			Office.context.document.removeHandlerAsync(
				Office.EventType.DocumentSelectionChanged,
				handleSelectionChange
			);
		};
	}, [curParagraphText]);

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
		<div className="ms-welcome">
			<RhetoricalSituation
				currentPrefix={ prefix }
				updatePrefix={ updatePrefix }
			/>
			<SearchBox
				updatePrompt={ updatePrompt }
				suggestedPrompts={ suggestedPrompts }
			/>
			{...reflectionCardsContainer}
		</div>
	);
}
