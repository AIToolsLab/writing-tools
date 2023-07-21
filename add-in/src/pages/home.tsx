import * as React from 'react';
import { TextField, DefaultButton } from '@fluentui/react';

import {AiOutlinePushpin} from 'react-icons/ai';
import Progress from '../components/progress';
import PresetPrompts from '../components/presetPrompts';

import classes from './styles.module.css';

import { SERVER_URL } from '../settings';

const shouldShowThumbDownButton = false;

export interface Card {
    body: string;
    paragraph: number;
}

export default function Home() {
    const [cards, updateCards] = React.useState<Card[]>([]);
    const [loading, updateLoading] = React.useState(false);
    const [prompt, updatePrompt] = React.useState('');
    const [paragraphTexts, updateParagraphTexts] = React.useState([]);
    const [curParagraphText, updateCurParagraphText] = React.useState('');
    // Watch for change events.
    React.useEffect(() => {
        // Add an event handler for when the selection changes.
        Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, async () => {
            await Word.run(async (context) => {
                // Get the current paragraph that the cursor is in, and look up the index of the paragraph in dict
                // Pick the first paragraph if current selection includes multiple paragraphs
                // Assume that there are no paragraphs that have exactly the same text
                let selectedParagraphs = context.document.getSelection().paragraphs;
                context.load(selectedParagraphs);
                await context.sync();
                let curParagraph = selectedParagraphs.items[0];
                updateCurParagraphText(curParagraph.text);
            }
        )});
    }, []);
        

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

    async function getReflectionFromServer(paragraph, prompt) {
        const data = {
            paragraph,
            prompt,
        };

        const req = await fetch(`${SERVER_URL}/reflections`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        const res = await req.json();

        if (res.error) alert(res); // TODO: need to verify that this works

        return res.reflections;
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

    // Temporary: insert "feedback collected" as comment into the document
    async function onThumbDownClick(paragraphId) {
        await Word.run(async (context) => {
            // Load the document as a ParagraphCollection
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load();
            await context.sync();

            // Highlight or dehighlight the paragraph
            const target = paragraphs.items[paragraphId];
            target.getRange().insertComment("feedback collected");
        });
    }

    async function getReflections() {
        await Word.run(async (context) => {
            let curPrompt = prompt;

            if (curPrompt.length === 0)
                curPrompt =
                    'Using only the text from the user, what are 3 of the most important concepts in this paragraph?';

            const paragraphs = context.document.body.paragraphs;
            paragraphs.load();

            await context.sync();

            updateLoading(true);

            const allReflections = await Promise.all(
                paragraphs.items.map((paragraph) =>
                    getReflectionFromServer(paragraph.text, curPrompt)
                )
            );

            updateLoading(false);

            const curCards = [];
            const newParagraphTexts = [];

            for (let i = 0; i < paragraphs.items.length; i++) {
                const reflections = allReflections[i];

                // Match the index with the paragraph using a dictionary
                newParagraphTexts.push(paragraphs.items[i].text);

                // Create a card for each reflection returned
                for (let j = 0; j < reflections.length; j++) {
                    const reflection = reflections[j];
                    const card = {
                        body: reflection.reflection,
                        paragraph: i,
                    };

                    curCards.push(card);
                }
            }

            updateCards(curCards);
            updateParagraphTexts(newParagraphTexts);
        });
    }

    if (loading) return <Progress message="Loading" />;

    // The text of the current paragraph is in curParagraphText
    // Let's find out the index of the current paragraph in the paragraph texts array
    let selectedIndex = paragraphTexts.indexOf(curParagraphText);
    // It's possible that the paragraph text has changed since reflections were retrieved, so we might not find it in the array
    // In that case, we just don't highlight anything (and selectedIndex will be -1)

    return (
        <div className="ms-welcome">
            <PresetPrompts updatePrompt={updatePrompt} />

            <TextField
                multiline={true}
                className="prompt-editor"
                label="Custom Prompt"
                resizable={false}
                onChange={(p) => updatePrompt(p.currentTarget.value)}
                value={prompt}
            />

            <div className="button-container">
                <DefaultButton onClick={getReflections}>
                    Get Reflections
                </DefaultButton>
            </div>

            <div className="cards-container">
                {cards.map((card, i) => (
                    <div
                        key={i}
                        className={selectedIndex === card.paragraph ? classes.cardContainerHover : classes.cardContainer}
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
        </div>
    );
}
