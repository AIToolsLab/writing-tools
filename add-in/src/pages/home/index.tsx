import { useState, useEffect, useContext } from 'react';

import { ReflectionCards } from '@/components/reflectionCard';
import {
	defaultPrompt,
	PromptButtonSelector
} from '@/components/promptButtonSelector';

import { UserContext } from '@/contexts/userContext';

import { getParagraphText } from '@/utilities';
import { getReflection } from '@/api';

import { useAuth0 } from '@auth0/auth0-react';

const includeSurroundingParagraphs = false;

export default function Home() {
	const { username } = useContext(UserContext);

	const { getAccessTokenSilently } = useAuth0();

	const [paragraphTexts, updateParagraphTexts] = useState<string[]>([]);
	const [curParagraphText, updateCurParagraphText] = useState('');

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
            getReflection(username, paragraphText, prompt, getAccessTokenSilently);

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
	 * @param {boolean} isCurrent - Indicates whether the reflection card is currently highlighted.
	 * @returns {React.JSX.Element} - The created reflection cards as a JSX element.
	 */
	function createReflectionCards(
		paragraphIndex: number,
		isCurrent: boolean
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
				isHighlighted={ isCurrent }
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
		if (includeSurroundingParagraphs) {
			// Check if there is a previous paragraph available
			for (let i = selectedIndex - 1; i >= 0; i--) {
				if (paragraphTexts[i] !== '') {
					reflectionCardsContainer.push(createReflectionCards(i, false));
					break;
				}
			}
		}

		// Check if the current paragraph is available
		if (paragraphTexts[selectedIndex] !== '')
			reflectionCardsContainer.push(
				createReflectionCards(selectedIndex, true)
			);

		if (includeSurroundingParagraphs) {
			// Check if there is a next paragraph available
			for (let i = selectedIndex + 1; i < paragraphTexts.length; i++) {
				if (paragraphTexts[i] !== '') {
					reflectionCardsContainer.push(createReflectionCards(i, false));
					break;
				}
			}
		}
	}

	return (
		<div className="ms-welcome">
			<PromptButtonSelector
				currentPrompt={ prompt }
				updatePrompt={ updatePrompt }
			/>

			{...reflectionCardsContainer}
		</div>
	);
}
