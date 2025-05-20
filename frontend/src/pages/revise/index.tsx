import { useState, useContext } from 'react';
import { ReflectionCards } from '@/components/reflectionCard';
import {
	defaultPrompt,
	PromptButtonSelector
} from '@/components/promptButtonSelector';
import { useAuth0 } from '@auth0/auth0-react';
import { UserContext } from '@/contexts/userContext';
import { getReflection } from '@/api';
import classes from './styles.module.css';
import { getCurParagraph } from '@/utilities/selectionUtil';
import { EditorContext } from '@/contexts/editorContext';
import { useDocContext } from '@/utilities';

export default function Revise() {
	const editorAPI = useContext(EditorContext);
	const { username } = useContext(UserContext);
	const docContext = useDocContext(editorAPI);
	const { curParagraphIndex, paragraphTexts } = getCurParagraph(docContext);
	const { getAccessTokenSilently } = useAuth0();


	const [reflections, updateReflections] = useState<
		Map<
			string,
			ReflectionResponseItem[] | Promise<ReflectionResponseItem[]>
		>
	>(new Map());

	const [prompt, updatePrompt] = useState(defaultPrompt);


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
		const cachedValue: any =
			// | ReflectionResponseItem[]
			// | Promise<ReflectionResponseItem[]>
			reflections.get(cacheKey);

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
	 * @returns {React.JSX.Element} - The created reflection cards as a JSX element.
	 */
	function createReflectionCards(): JSX.Element {
		// Get the current paragraph text
		const reflectionsForThisParagraph: ReflectionResponseItem[] =
			getReflectionsSync(paragraphTexts[curParagraphIndex], prompt);

		const cardDataList: CardData[] = reflectionsForThisParagraph.map(
			reflectionResponseItem => ({
				paragraphIndex: curParagraphIndex,
				body: reflectionResponseItem.reflection
			})
		);

		return (
			<ReflectionCards
				cardDataList={ cardDataList }
				isHighlighted={ false }
			/>
		);
	}


	// Index of the currently selected paragraph
	const selectedIndex = curParagraphIndex;
	const reflectionCardsContainer: React.JSX.Element[] = [];

	// Display the reflection cards that are relevant to the currently selected
	// paragraph, as well as its previous and next paragraphs
	if (selectedIndex !== -1) {
		// Check if the current paragraph is available
		if (paragraphTexts[selectedIndex] !== '')
			reflectionCardsContainer.push(createReflectionCards());
	}

	return (
		<div className={ classes.container }>
			<PromptButtonSelector
				currentPrompt={ prompt }
				updatePrompt={ updatePrompt }
			/>
			{...reflectionCardsContainer}
		</div>
	);
}
