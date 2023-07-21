import * as React from 'react';
import { TextField, DefaultButton } from '@fluentui/react';

import Progress from '../components/progress';
import PresetPrompts from '../components/presetPrompts';

import { SERVER_URL } from '../settings';

export interface HomeProps {
    isOfficeInitialized: boolean;
}

export interface Card {
    body: string;
    paragraph: number;
}

export default function Home({ isOfficeInitialized }: HomeProps) {
    const [cards, updateCards] = React.useState<Card[]>([]);
    const [loading, updateLoading] = React.useState(false);
    const [prompt, updatePrompt] = React.useState('');

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

            for (let i = 0; i < paragraphs.items.length; i++) {
                const reflections = allReflections[i];

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
        });
    }

    if (!isOfficeInitialized || loading) return <Progress message="Loading" />;

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
                        className="card-container"
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
                        <div className="card-content">
                            {card.body}
                        </div>
                        <div className="thumb-up-button-container">
                            <button onClick={() => onThumbUpClick(card.paragraph, card.body)}>
                                Like
                            </button>
                            <button onClick={() => onThumbDownClick(card.paragraph)}>
                                Dislike
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
