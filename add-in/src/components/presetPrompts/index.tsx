import React from 'react';
import { ChoiceGroup } from '@fluentui/react';

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
