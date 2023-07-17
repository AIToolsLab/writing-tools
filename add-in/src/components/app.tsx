import * as React from 'react';
import { TextField, ChoiceGroup, DefaultButton } from '@fluentui/react';

import { SERVER_URL } from '../settings';

import Progress from './progress';

export interface AppProps {
    isOfficeInitialized: boolean;
}

export interface Card {
    body: string;
    paragraph: number;
}

const presetPrompts = [
    {
        key: 'Summary: phrases',
        text: 'What are 3 of the most important concepts described by this paragraph? Each concept should be described in 2 or 3 words.',
    },
    {
        key: 'Summary: sentences',
        text: 'What are 3 of the most important concepts described by this paragraph? Each concept should be described in a sentence.',
    },
    {
        key: 'Summary: questions',
        // TODO: Improve this prompt
        text: 'List 2 or 3 questions that the writer was attempting to answer in this paragraph.',
    },
    {
        key: 'Reactions: questions',
        text: 'As a reader, ask the writer 2 or 3 questions about definitions, logical connections, or some needed background information.',
    },
    {
        key: 'Metaphors',
        text: 'List the metaphors that the writer uses in this paragraph.',
    },
];

export default function App({ isOfficeInitialized }: AppProps) {
    const [cards, updateCards] = React.useState<Card[]>([]);
    const [prompt, updatePrompt] = React.useState('');
    const [loading, updateLoading] = React.useState(false);

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
                        body: reflection.text_in_HTML_format,
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
            <ChoiceGroup
                label="Preset Prompts"
                options={presetPrompts}
                onChange={(e) =>
                    updatePrompt(
                        (e.currentTarget as HTMLInputElement).labels[0]
                            .innerText
                    )
                }
            />

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
                        {card.body}
                    </div>
                ))}
            </div>
        </div>
    );
}
