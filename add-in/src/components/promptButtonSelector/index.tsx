import React from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { DefaultButton } from '@fluentui/react/lib/Button';

import classes from './styles.module.css';

const promptList = [
    {
        keyword: 'Thesis Statement',
        prompt: 'Step 1: Write a sentence stating what seems to be the thesis of the paragraph. Step 2: Say FINAL OUTPUT. Step 3: Say the thesis again, but even more concisely with no filler words like "the thesis is".',
    },
    {
        keyword: 'Important Concepts',
        prompt: 'Step 1: List 10 important concepts in this paragraph, in the format 1. Concept: [concept as a complete sentence] Relevance: [relevance score, 10 best]. Step 2: Output FINAL OUTPUT, then a new line, then a Markdown unordered list with the 3 concepts with highest relevance, in short phrases of 2 or 3 words.',
    },
    {
        keyword: 'Important Concepts as Sentences',
        prompt: 'Step 1: List 10 important concepts in this paragraph, in the format 1. Concept: [concept as a complete sentence] Relevance: [relevance score, 10 best]. Step 2: Output FINAL OUTPUT, then a new line, then a Markdown unordered list with the 3 concepts with highest relevance, as a complete sentence.',
    },
    {
        keyword: 'Questions the Writer Was Attempting to Answer',
        prompt: 'List 2 or 3 questions that the writer was attempting to answer in this paragraph.',
    },
    {
        keyword: 'Questions a Reader Might Have',
        prompt: 'As a reader, ask the writer 2 or 3 questions about definitions, logical connections, or some needed background information.',
    },
    {
        keyword: 'Advice',
        prompt: 'What advice would you give the writer to improve this paragraph? Respond in a bulleted list.',
    },
    {
        keyword: 'Metaphors',
        prompt: 'List the metaphors that the writer uses in this paragraph.',
    },
];

interface PromptButtonSelectorProps {
    currentPrompt: string;
    updatePrompt: (prompt: string) => void;
}

export const defaultPrompt = promptList[0].prompt;
export const defaultKeyword = promptList[0].keyword;

/**
 * Renders a button selector component for selecting and editing prompts.
 *
 * @param {Object} props - The component props.
 * @param {string} props.currentPrompt - The current prompt value.
 * @param {function} props.updatePrompt - A function to update the prompt value.
 * @returns {JSX.Element} - The rendered button selector component.
 */
export function PromptButtonSelector(
    props: PromptButtonSelectorProps
): React.JSX.Element {
    const { currentPrompt, updatePrompt } = props;

    const [internalPrompt, setInternalPrompt] = React.useState(defaultPrompt);
    const [customPrompt, setCustomPrompt] = React.useState('');
    const [currentButton, setCurrentButton] = React.useState(defaultKeyword);

    function setPrompt(newPrompt: string): void {
        setInternalPrompt(newPrompt);
        if (newPrompt.length !== 0) {
            updatePrompt(newPrompt);
        }
    }

    return (
        <div className={classes.promptButtonSelector}>
            <div className={classes.buttonContainer}>
                {promptList.map(
                    (option: { keyword: string; prompt: string }) => (
                        <DefaultButton
                            key={option.keyword}
                            className={
                                currentButton === option.keyword
                                    ? classes.currentButton
                                    : classes.button
                            }
                            text={option.keyword}
                            onClick={() => {
                                setPrompt(option.prompt);
                                setCurrentButton(option.keyword);
                            }}
                        />
                    )
                )}
                <DefaultButton
                    text="Custom"
                    className={
                        currentButton === 'Custom'
                            ? classes.currentButton
                            : classes.button
                    }
                    onClick={() => {
                        setPrompt(customPrompt);
                        setCurrentButton('Custom');
                    }}
                />
            </div>
            <div className={classes.textareaContainer}>
                <TextareaAutosize
                    className={classes.textarea}
                    value={internalPrompt}
                    onChange={(e) => {
                        setInternalPrompt(e.target.value);
                        setCurrentButton('Custom');
                    }}
                />
                {currentButton === 'Custom' && (
                    <div className={classes.operationButtonContainer}>
                        <div className={classes.saveButton}>
                            <button
                                onClick={() => {
                                    if (
                                        internalPrompt.trim().length !== 0 &&
                                        internalPrompt.trim() !== currentPrompt
                                    ) {
                                        setCustomPrompt(internalPrompt);
                                        updatePrompt(internalPrompt);
                                    }
                                }}
                            >
                                Save
                            </button>
                        </div>
                        <div className={classes.clearButton}>
                            <button
                                onClick={() => {
                                    setInternalPrompt('');
                                    setCustomPrompt('');
                                }}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
