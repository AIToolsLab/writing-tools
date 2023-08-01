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

export default function Home() {
    const [reflections, updateReflections] = React.useState(new Map());
    const [loading, updateLoading] = React.useState(false);
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
                newParagraphTexts.push(paragraphs.items[i].text);
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
                updateCurParagraphText(curParagraph.text);
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
            alert(e);
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
    function getReflectionsSync(paragraphText: string, prompt: string) {
        // Maintain a cache of reflections for each paragraph text and prompt.
        const key = JSON.stringify({paragraphText, prompt});
        if (reflections.has(key)) {
            return reflections.get(key);
        }
        const reflectionsPromise = getReflectionFromServer(paragraphText, prompt);
        reflectionsPromise.then((newReflections) => {
            reflections.set(key, newReflections);
            updateReflections(new Map(reflections));
        });
        return [];
    }


    const cards = [];
    for (let i = selectedIndex - 1; i <= selectedIndex + 1; i++) {
        // If paragraph i is valid
        if (0 <= i && i < paragraphTexts.length) {
            let reflectionsForThisPara = getReflectionsSync(paragraphTexts[i], prompt);
            reflectionsForThisPara.forEach(r => {
                const card = { body: r.reflection, paragraph: i };
                cards.push(card);
            });
        }
    }

    return (
        <div className="ms-welcome">
            {/* Preset Prompts  */}
            <div className={classes['prompt-container']}>
                <PromptSelector curPrompt={prompt} updatePrompt={updatePrompt} />
            </div>


            {/* Reflection Cards for previous Paragraph */}
            <CardContainer
                className={classes.cardContainer}
                cards={cards.filter(function (card) { return card.paragraph == (selectedIndex - 1) })}
                changeParagraphHighlightColor={changeParagraphHighlightColor}
                onThumbUpClick={onThumbUpClick}
                onThumbDownClick={onThumbDownClick}
            />

            {/* Reflection Cards for current Paragraph */}
            <CardContainer
                className={classes.cardContainerHover}
                cards={cards.filter(function (card) { return card.paragraph == selectedIndex })}
                changeParagraphHighlightColor={changeParagraphHighlightColor}
                onThumbUpClick={onThumbUpClick}
                onThumbDownClick={onThumbDownClick}
            />

            {/* Reflection Cards for next Paragraph */}
            <CardContainer
                className={classes.cardContainer}
                cards={cards.filter(function (card) { return card.paragraph == (selectedIndex + 1) })}
                changeParagraphHighlightColor={changeParagraphHighlightColor}
                onThumbUpClick={onThumbUpClick}
                onThumbDownClick={onThumbDownClick}
            />
        </div>
    );
}
