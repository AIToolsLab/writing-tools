import React from 'react';
import { ChoiceGroup } from '@fluentui/react';

const presetPrompts = [
    {
        key: 'Summary: thesis',
        text: 'Step 1: Write a sentence stating what seems to be the thesis of the paragraph. Step 2: Say FINAL OUTPUT. Step 3: Make the sentence even more concise with no filler words like "the thesis is".',
    },
    {
        key: 'Summary: phrases',
        text: 'Step 1: List 10 important concepts in this paragraph, in the format 1. Concept: [concept as a complete sentence] Relevance: [relevance score, 10 best]. Step 2: Output FINAL OUTPUT, then a new line, then a Markdown unordered list with the 3 concepts with highest relevance, in short phrases of 2 or 3 words.',
    },
    {
        key: 'Summary: sentences',
        text: 'Step 1: List 10 important concepts in this paragraph, in the format 1. Concept: [concept as a complete sentence] Relevance: [relevance score, 10 best]. Step 2: Output FINAL OUTPUT, then a new line, then a Markdown unordered list with the 3 concepts with highest relevance, as a complete sentence.',
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
        key: 'Advice',
        text: 'What advice would you give the writer to improve this paragraph? Respond in a bulleted list.',
    },
    {
        key: 'Metaphors',
        text: 'List the metaphors that the writer uses in this paragraph.',
    },
];

export default function PresetPrompts({ updatePrompt }: { updatePrompt: (_: string) => void }) {
    return (
        <ChoiceGroup
            label="Preset Prompts"
            options={presetPrompts}
            onChange={(e) =>
                updatePrompt(
                    (e.currentTarget as HTMLInputElement).labels[0].innerText
                )
            }
        />
    );
}
