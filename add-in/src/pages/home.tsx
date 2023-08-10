import * as React from 'react';
import PromptSelector from '../components/presetPrompts';
import { CardData, ReflectionCards } from '../components/reflectionCard';

import { SERVER_URL } from '../settings';

import classes from './styles.module.css';

// Convert the Word paragraph object into a usable string
function getParagraphText(paragraphTextObject: Word.Paragraph): string {
    return paragraphTextObject.text.trim().replace('\u0005', '');
}

export default function Home() {
    interface ReflectionResponseItem {
        reflection: string;
    }

    interface ReflectionResponses {
        reflections: ReflectionResponseItem[];
    }

    // Reflections cache
    const [reflections, updateReflections] = React.useState<
        Map<
            string,
            ReflectionResponseItem[] | Promise<ReflectionResponseItem[]>
        >
    >(new Map());

    async function getReflectionFromServer(
        paragraph: string,
        prompt: string
    ): Promise<ReflectionResponseItem[]> {
        try {
            const data = {
                user_id: -1, // TODO: Get user_id from somewhere
                paragraph,
                prompt,
            };

            const response: Response = await fetch(
                `${SERVER_URL}/reflections`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data),
                }
            );

            if (!response.ok) {
                throw new Error('Request failed ' + response.status);
            }

            const responseData: ReflectionResponses = await response.json();
            return responseData.reflections;
        } catch (error) {
            console.error(error);
            return [];
        }
    }

    function getReflectionsSync(
        paragraphText: string,
        prompt: string
    ): ReflectionResponseItem[] {
        console.assert(
            typeof paragraphText === 'string' && paragraphText !== '',
            'paragraphText must be a non-empty string'
        );

        const cacheKey: string = JSON.stringify({ paragraphText, prompt });

        const cachedValue:
            | ReflectionResponseItem[]
            | Promise<ReflectionResponseItem[]> = reflections.get(cacheKey);

        // If cachedValue is undefined, it means that the reflection associated with
        //     the given paragraphText and prompt does not exist yet in the cache.
        //     In this case, fetch the reflections from the server.
        // If cachedValue is a promise that resolves to an array of ReflectionResponseItem
        //     objects, wait for the promise to resolve before returning the reflections.
        // If cachedValue is an array of ReflectionResponseItem objects, it means that the
        //     reflection associated with the given paragraphText and prompt
        //     exists in the cache. Return it.
        if (typeof cachedValue === 'undefined') {
            const reflectionsPromise: Promise<ReflectionResponseItem[]> =
                getReflectionFromServer(paragraphText, prompt);

            reflectionsPromise
                .then((newReflections) => {
                    // If the promise resolves, store the cacheKey
                    // and associated reflections in cache
                    reflections.set(cacheKey, newReflections);
                    updateReflections(new Map(reflections));
                })
                .catch((error) => {
                    // If the promise fails to resolve, make sure that
                    // cache is free from potentially invalid data
                    reflections.delete(cacheKey);
                    console.error(error);
                });

            // Ensure that only one request is made to the server for a cacheKey
            reflections.set(cacheKey, reflectionsPromise);
            return [];
        } else if (cachedValue instanceof Promise) {
            return [];
        } else {
            return cachedValue;
        }
    }

    // The current list of all the paragraphs in the document
    const [paragraphTexts, updateParagraphTexts] = React.useState<string[]>([]);
    // The currently selected paragraph from the document
    const [curParagraphText, updateCurParagraphText] = React.useState('');

    // TODO: Consider caching?
    function loadParagraphTexts() {
        Word.run(async (context: Word.RequestContext) => {
            // Retrieve and load all the paragraphs from the Word document
            const paragraphs: Word.ParagraphCollection =
                context.document.body.paragraphs;
            paragraphs.load();
            await context.sync();

            // Update paragraphTexts accordingly
            const newParagraphTexts: string[] = paragraphs.items.map((item) =>
                getParagraphText(item)
            );
            updateParagraphTexts(newParagraphTexts);
        });
    }

    // Watch for paragraph selection changes
    React.useEffect(() => {
        async function handleSelectionChange() {
            await Word.run(async (context: Word.RequestContext) => {
                // Retrieve and load selected paragraphs from the Word document
                const selectedParagraphs: Word.ParagraphCollection =
                    context.document.getSelection().paragraphs;
                context.load(selectedParagraphs);
                await context.sync();

                // Update curParagraphText accordingly
                const curParagraph: Word.Paragraph =
                    selectedParagraphs.items[0];
                updateCurParagraphText(getParagraphText(curParagraph));
            });

            // Update paragraphTexts (potentially expensive)
            loadParagraphTexts();
        }

        // Handle the initial selection changes
        handleSelectionChange();

        // Handle the subsequent selection changes
        Office.context.document.addHandlerAsync(
            Office.EventType.DocumentSelectionChanged,
            handleSelectionChange
        );

        // Cleanup when Home is unmounted
        return () => {
            Office.context.document.removeHandlerAsync(
                Office.EventType.DocumentSelectionChanged,
                handleSelectionChange
            );
        };
    }, []);

    // The current prompt
    const [prompt, updatePrompt] = React.useState(PromptSelector.defaultPrompt);

    const containerForParagraph = (
        paragraphIndex: number,
        isCurrent: boolean
    ) => {
        const reflectionsForThisPara = getReflectionsSync(
            paragraphTexts[paragraphIndex],
            prompt
        );
        const cards: CardData[] = reflectionsForThisPara.map((r, i) => ({
            paragraphIndex: paragraphIndex,
            body: r.reflection,
            id: `${paragraphIndex}-${i}`,
        }));
        return (
            <ReflectionCards
                cardDataList={cards}
                toggleCardHighlight={isCurrent}
            />
        );
    };

    const containers = [];

    let selectedIndex = paragraphTexts.indexOf(curParagraphText);

    // If we have a selected paragraph, add the previous, current, and next paragraphs to the page
    if (selectedIndex !== -1) {
        // Add the previous, current, and next paragraphs to the page
        // Skip blank paragraphs
        let previousParagraphIdx = selectedIndex - 1;
        while (
            previousParagraphIdx >= 0 &&
            paragraphTexts[previousParagraphIdx] === ''
        ) {
            previousParagraphIdx--;
        }
        if (
            previousParagraphIdx >= 0 &&
            paragraphTexts[previousParagraphIdx] !== ''
        ) {
            containers.push(containerForParagraph(previousParagraphIdx, false));
        }

        if (paragraphTexts[selectedIndex] !== '') {
            containers.push(containerForParagraph(selectedIndex, true));
        }

        let nextParagraphIdx = selectedIndex + 1;
        while (
            nextParagraphIdx < paragraphTexts.length &&
            paragraphTexts[nextParagraphIdx] === ''
        ) {
            nextParagraphIdx++;
        }
        if (
            nextParagraphIdx < paragraphTexts.length &&
            paragraphTexts[nextParagraphIdx] !== ''
        ) {
            containers.push(containerForParagraph(nextParagraphIdx, false));
        }
    }

    return (
        <div className="ms-welcome">
            {/* Preset Prompts  */}
            <div className={classes['prompt-container']}>
                <PromptSelector
                    curPrompt={prompt}
                    updatePrompt={updatePrompt}
                />
            </div>

            {...containers}
        </div>
    );
}
