import * as React from 'react';

import { AiOutlinePushpin } from 'react-icons/ai';
import Progress from '../components/progress';
import PromptSelector from '../components/presetPrompts';

import { TextField } from '@fluentui/react';


import classes from './styles.module.css';

import { SERVER_URL } from '../settings';

const shouldShowThumbDownButton = false;

export interface Card {
    body: string;
    paragraph: number;
}

export interface ReflectionsForParagraph {
    paragraphText: string;
    prompt: string;
    reflectionTexts: string[];
}

function CardContainer({ className, cards, changeParagraphHighlightColor, onThumbUpClick, onThumbDownClick }) {
    return (
        <div className={classes.cardsContainer}>
            {(cards.length === 0) ? "loading..." : cards.map((card, i) => (
                <div
                    key={i}
                    className={className}
                    onMouseEnter={() =>
                        changeParagraphHighlightColor(
                            card.paragraph,
                            'highlight'
                        )
                    }
                    onMouseLeave={() =>
                        changeParagraphHighlightColor(
                            card.paragraph,
                            'dehighlight'
                        )
                    }
                >
                    <div className="card-content">{card.body}</div>

                    <div className="thumb-up-button-container">
                        <button
                            onClick={() =>
                                onThumbUpClick(card.paragraph, card.body)
                            }
                            title='Save as comment'
                        >
                            <AiOutlinePushpin />
                        </button>
                        {shouldShowThumbDownButton && (
                            <button
                                onClick={() =>
                                    onThumbDownClick(card.paragraph)
                                }
                            >
                                Dislike
                            </button>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function getTextForParagraphObj(paragraphObj) {
    return paragraphObj.text.trim();
}

export default function Home() {
    const [reflections, updateReflections] = React.useState(new Map());
    const [prompt, updatePrompt] = React.useState(PromptSelector.defaultPrompt);
    const [paragraphTexts, updateParagraphTexts] = React.useState<string[]>([]);
    const [curParagraphText, updateCurParagraphText] = React.useState('');

    // Split and load the document into an array to match the paragraphs with indexes
    function loadParagraphTexts() {
        Word.run(async (context) => {
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load();

            await context.sync();
            let newParagraphTexts = [];
            for (let i = 0; i < paragraphs.items.length; i++) {
                newParagraphTexts.push(getTextForParagraphObj(paragraphs.items[i]));
            }
            updateParagraphTexts(newParagraphTexts);
        })
    }

    // Watch for change events.
    React.useEffect(() => {
        // Add an event handler for when the selection changes.
        async function onSelectionChanged() {
            await Word.run(async (context) => {
                // Get the current paragraph that the cursor is in, and look up the index of the paragraph in dict
                // Pick the first paragraph if current selection includes multiple paragraphs
                // Assume that there are no paragraphs that have exactly the same text
                let selectedParagraphs = context.document.getSelection().paragraphs;
                context.load(selectedParagraphs);
                await context.sync();
                let curParagraph = selectedParagraphs.items[0];
                updateCurParagraphText(getTextForParagraphObj(curParagraph));
            });
            // FIXME: find a better place to run this, which might be expensive.
            loadParagraphTexts();
        }
        
        onSelectionChanged();
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, onSelectionChanged);

        return () => {
            Office.context.document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, onSelectionChanged);
        }
    }, []);

    // The text of the current paragraph is in curParagraphText
    // Let's find out the index of the current paragraph in the paragraph texts array
    let selectedIndex = paragraphTexts.indexOf(curParagraphText);
    // It's possible that the paragraph text has changed since reflections were retrieved, so we might not find it in the array
    // In that case, we just don't highlight anything (and selectedIndex will be -1)

    // Change the highlight color of the selected paragraph
    async function changeParagraphHighlightColor(paragraphId, operation) {
        await Word.run(async (context) => {
            // Load the document as a ParagraphCollection
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load();

            await context.sync();

            // Highlight or dehighlight the paragraph
            const target = paragraphs.items[paragraphId];
            target.load('font');

            await context.sync();

            if (operation == 'highlight')
                target.font.highlightColor = '#FFFF00';
            else if (operation == 'dehighlight')
                target.font.highlightColor = '#FFFFFF';
        });
    }

    // Send the paragraph and the prompt to the backend server and get the reflection
    async function getReflectionFromServer(paragraph, prompt) {
        const data = {
            user_id: -1, // TODO: get userId from somewhere
            paragraph,
            prompt,
        };

        try {
            const req = await fetch(`${SERVER_URL}/reflections`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            if (!req.ok) throw new Error('Request failed ' + req.status);

            const res = await req.json();

            return res.reflections;
        } catch (e) {
            console.error(e);
        }
    }

    // Insert reflection as an anchored comment into the document
    // Current anchored location: first word of the paragraph
    async function onThumbUpClick(paragraphId, comment) {
        await Word.run(async (context) => {
            // Load the document as a ParagraphCollection
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load();
            await context.sync();

            // Highlight or dehighlight the paragraph
            const target = paragraphs.items[paragraphId];
            target.getRange("Start").insertComment(comment);
        });
    }

    // Temporary: insert "feedback collected" as an anchored comment into the document
    // Current anchored location: last word of the paragraph
    async function onThumbDownClick(paragraphId) {
        await Word.run(async (context) => {
            // Load the document as a ParagraphCollection
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load();
            await context.sync();

            // Highlight or dehighlight the paragraph
            const target = paragraphs.items[paragraphId];
            target.getRange("End").insertComment("feedback collected");
        });
    }

    // Make sure we have reflections for the paragraphs in scope.
    // If we don't, fetch them from the server, but don't wait for the response.

    function getReflectionsSync(paragraphText: string, prompt: string) {
        console.assert(typeof paragraphText === 'string' && paragraphText !== '');
        // Maintain a cache of reflections for each paragraph text and prompt.
        const key = JSON.stringify({paragraphText, prompt});
        const cachedVal = reflections.get(key);
        if (typeof cachedVal === 'undefined') {
            // We haven't requested reflections for this paragraph yet.
            const reflectionsPromise = getReflectionFromServer(paragraphText, prompt);
            reflectionsPromise.then((newReflections) => {
                reflections.set(key, newReflections);
                updateReflections(new Map(reflections));
            });
            reflections.set(key, reflectionsPromise);
            return [];
        } else if (cachedVal instanceof Promise) {
            // We're still waiting for the server to respond.
            // Return an empty array for now.
            return [];
        } else {
            return cachedVal;
        }
    }


    const containerForParagraph = (paragraphIdx: number, isCurrent: boolean) => {
        let reflectionsForThisPara = getReflectionsSync(
            paragraphTexts[paragraphIdx],
            prompt
        );
        const cards = [];
        reflectionsForThisPara.forEach((r) => {
            const card = { body: r.reflection, paragraph: paragraphIdx };
            cards.push(card);
        });
        return (
            <CardContainer
                className={
                    isCurrent
                        ? classes.cardContainerHover
                        : classes.cardContainer
                }
                cards={cards}
                changeParagraphHighlightColor={changeParagraphHighlightColor}
                onThumbUpClick={onThumbUpClick}
                onThumbDownClick={onThumbDownClick}
            />
        );
    };
            
    const containers = [];

    // If we have a selected paragraph, add the previous, current, and next paragraphs to the page    
    if (selectedIndex !== -1) {
        // Add the previous, current, and next paragraphs to the page
        // Skip blank paragraphs
        let previousParagraphIdx = selectedIndex - 1;
        while (previousParagraphIdx >= 0 && paragraphTexts[previousParagraphIdx] === '') {
            previousParagraphIdx--;
        }
        if (previousParagraphIdx >= 0 && paragraphTexts[previousParagraphIdx] !== '') {
            containers.push(containerForParagraph(previousParagraphIdx, false));
        }

        if (paragraphTexts[selectedIndex] !== '') {
            containers.push(containerForParagraph(selectedIndex, true));
        }

        let nextParagraphIdx = selectedIndex + 1;
        while (nextParagraphIdx < paragraphTexts.length && paragraphTexts[nextParagraphIdx] === '') {
            nextParagraphIdx++;
        }
        if (nextParagraphIdx < paragraphTexts.length && paragraphTexts[nextParagraphIdx] !== '') {
            containers.push(containerForParagraph(nextParagraphIdx, false));
        }
    }

    return (
        <div className="ms-welcome">
            {/* Preset Prompts  */}
            <div className={classes['prompt-container']}>
                <PromptSelector curPrompt={prompt} updatePrompt={updatePrompt} />
            </div>

            {...containers}
        </div>
    );
}
