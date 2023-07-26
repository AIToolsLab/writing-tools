import * as React from 'react';
import { TextField, DefaultButton } from '@fluentui/react';

import { AiOutlinePushpin } from 'react-icons/ai';
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
    const [paragraphTexts, updateParagraphTexts] = React.useState<string[]>([]);
    const [curParagraphText, updateCurParagraphText] = React.useState('');

    // Split and load the document into an array to match the paragraphs with indexes
    function loadParagraphTexts() {
        Word.run((context) => {
            const paragraphs = context.document.body.paragraphs;
            paragraphs.load();

            return context.sync().then(() => {
                let newParagraphTexts = [];
                for (let i = 0; i < paragraphs.items.length; i++) {
                    newParagraphTexts.push(paragraphs.items[i].text);
                }
                updateParagraphTexts(newParagraphTexts);
            })
        })
    }

    loadParagraphTexts();

    // Watch for change events.
    React.useEffect(() => {
        // Add an event handler for when the selection changes.
        // TODO: fire this on initial load too, otherwise there's no highlights until you first click something.
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
            )
        });
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

    // Fetch reflections from server and wrap reflections into cards
    async function getReflections() {

        let curPrompt = prompt;

        let reflectionsPrevious = [];
        let reflectionsCurrent = [];
        let reflectionsNext = [];

        updateLoading(true);

        if (0 <= (selectedIndex - 1)) {   // If current paragraph has a valid previous paragraph
            let preParagraph = (paragraphTexts[selectedIndex - 1]);
            reflectionsPrevious = await getReflectionFromServer(preParagraph, curPrompt);
        }

        reflectionsCurrent = await getReflectionFromServer(curParagraphText, curPrompt);

        if ((selectedIndex + 1) < paragraphTexts.length) {     // If current paragraph has a valid next paragraph
            let nextParagraph = (paragraphTexts[selectedIndex + 1]);
            reflectionsNext = await getReflectionFromServer(nextParagraph, curPrompt);
        }

        updateLoading(false);

        const curCards = [];

        reflectionsPrevious.forEach(r => {
            const card = { body: r.reflection, paragraph: selectedIndex - 1 };
            curCards.push(card);
        });

        reflectionsCurrent.forEach(r => {
            const card = { body: r.reflection, paragraph: selectedIndex };
            curCards.push(card);
        });

        reflectionsNext.forEach(r => {
            const card = { body: r.reflection, paragraph: selectedIndex + 1 };
            curCards.push(card);
        });

        updateCards(curCards);
    }

    if (loading) return <Progress message="Loading" />;

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
                        className={`${classes.cardContainer} ${selectedIndex === card.paragraph ? classes.cardContainerHover : ""}`}
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
