import React, { useState } from 'react';
import { Stack, IStackTokens } from '@fluentui/react/lib/Stack';
import { TextField, DefaultButton } from '@fluentui/react';
import { Text } from '@fluentui/react/lib/Text';

const presetPrompts = [
    {
        key: 'Summary: thesis',
        text: 'Step 1: Write a sentence stating what seems to be the thesis of the paragraph. Step 2: Say FINAL OUTPUT. Step 3: Say the thesis again, but even more concisely with no filler words like "the thesis is".',
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
        key: 'Intent: questions',
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
    // {
    //     key: 'Rewrite',
    //     text: 'Rewrite this paragraph to make it better.',
    // },
    {
        key: 'Metaphors',
        text: 'List the metaphors that the writer uses in this paragraph.',
    },
];

type PromptSelectorProps = {
    curPrompt: string;
    updatePrompt: (_: string) => void;
};

const stackTokens: IStackTokens = { childrenGap: 5 };

// Render the list of preset prompts as fancy radio buttons
export default function PromptSelector({ curPrompt, updatePrompt }: PromptSelectorProps) {
    const [internalPrompt, setInternalPrompt] = useState(presetPrompts[0].text);

    const setPrompt = (newPrompt: string) => {
        setInternalPrompt(newPrompt);
        updatePrompt(newPrompt);
    }

    return (
        <div>
        <Stack tokens={stackTokens}>
            {presetPrompts.map((option) => (
                <DefaultButton
                    key={option.key}
                    text={option.key}
                    style={{
                        backgroundColor:
                            option.text === curPrompt
                                ? '#f3f2f1'
                                : 'white',
                    }}
                    onClick={() => {
                        setPrompt(option.text);
                    }}
                />
            ))}
        </Stack>
        {/* Custom Prompt  */}
        <TextField
            multiline={true}
            className="prompt-editor"
            label="Custom Prompt"
            resizable={false}
            onChange={(p) => setInternalPrompt(p.currentTarget.value)}
            value={internalPrompt}
        />
        {internalPrompt !== curPrompt && (
            <DefaultButton
                text="Set Custom Prompt"
                onClick={() => {
                    updatePrompt(internalPrompt);
                }}
            />)}
</div>
    );
}

PromptSelector.defaultPrompt = presetPrompts[0].text;
