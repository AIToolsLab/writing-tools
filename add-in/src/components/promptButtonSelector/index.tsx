import { useState } from 'react';

import TextareaAutosize from 'react-textarea-autosize';
import { DefaultButton } from '@fluentui/react/lib/Button';

import classes from './styles.module.css';

const promptList = [
	{
		keyword: 'Thesis Statement',
		prompt: 'What is the thesis of the following paragraph? Answer concisely without saying "the thesis is".'
	},
	{
		keyword: 'Important Concepts',
		prompt: 'List up to 10 important concepts in this paragraph as phrases of up to 3 words.'
	},
	{
		keyword: 'Questions the Writer Was Attempting to Answer',
		prompt: 'List 2 or 3 questions that the writer was attempting to answer in this paragraph.'
	},
	{
		keyword: 'Questions a Reader Might Have',
		prompt: 'As a reader, ask the writer 2 or 3 questions.'
	},
	{
		keyword: 'Counterpoints',
		prompt: "List counterpoints to this paragraph's arguments."
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
): JSX.Element {
	const { currentPrompt, updatePrompt } = props;

	const [internalPrompt, setInternalPrompt] = useState(defaultPrompt);
	const [customPrompt, setCustomPrompt] = useState('');
	const [currentButton, setCurrentButton] = useState(defaultKeyword);

	function setPrompt(newPrompt: string): void {
		setInternalPrompt(newPrompt);
		if (newPrompt.length !== 0) {
			updatePrompt(newPrompt);
		}
	}

	return (
		<div className={ classes.promptButtonSelector }>
			<div className={ classes.buttonContainer }>
				{ promptList.map(
					(option: { keyword: string; prompt: string }) => (
						<DefaultButton
							key={ option.keyword }
							className={
								currentButton === option.keyword
									? classes.currentButton
									: classes.button
							}
							text={ option.keyword }
							onClick={ () => {
								setPrompt(option.prompt);
								setCurrentButton(option.keyword);
							} }
						/>
					)
				) }

				<DefaultButton
					text="Custom"
					className={
						currentButton === 'Custom'
							? classes.currentButton
							: classes.button
					}
					onClick={ () => {
						setPrompt(customPrompt);
						setCurrentButton('Custom');
					} }
				/>
			</div>

			<div className={ classes.textareaContainer }>
				<TextareaAutosize
					className={ classes.textarea }
					value={ internalPrompt }
					onChange={ e => {
						setInternalPrompt(e.target.value);
						setCurrentButton('Custom');
					} }
				/>

				{ currentButton === 'Custom' && (
					<div className={ classes.operationButtonContainer }>
						<div className={ classes.saveButton }>
							<button
								onClick={ () => {
									if (
										internalPrompt.trim().length !== 0 &&
										internalPrompt.trim() !== currentPrompt
									) {
										setCustomPrompt(internalPrompt);
										updatePrompt(internalPrompt);
									}
								} }
							>
								Save
							</button>
						</div>

						<div className={ classes.clearButton }>
							<button
								onClick={ () => {
									setInternalPrompt('');
									setCustomPrompt('');
								} }
							>
								Clear
							</button>
						</div>
					</div>
				) }
			</div>
		</div>
	);
}
