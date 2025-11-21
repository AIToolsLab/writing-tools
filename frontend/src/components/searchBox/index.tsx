import { useState } from 'react';
import {
	AiOutlineFileSearch,
	AiOutlineClose,
	AiFillCloseCircle,
	AiOutlineHistory,
} from 'react-icons/ai';
import { FcNext } from 'react-icons/fc';

import { handleAutoResize } from '@/utilities';

interface SearchBoxProps {
	updateSubmittedPrompt: (prompt: string) => void;
	promptSuggestions: string[];
}

export function SearchBox(props: SearchBoxProps): JSX.Element {
	const {
		updateSubmittedPrompt: updateSubmittedPrompt,
		promptSuggestions: promptSuggestions,
	} = props;

	const [prevPrompts, updatePrevPrompts] = useState<string[]>([]); // Search history
	const [searchBoxText, updateSearchBoxText] = useState(''); // Current search text
	const [searchBoxTextSent, updateSearchBoxTextSent] = useState(false); // Whether search text has been submitted
	const [dropdownVisible, updateDropdownVisible] = useState(false); // Whether searchbar dropdown is visible
	const [isDropdownClicked, setIsDropdownClicked] = useState(false); // Whether searchbar dropdown is clicked

	// Filter the prompt lists based on the current prompt
	const filteredNewPromptList = promptSuggestions.filter((prompt) =>
		prompt.toLowerCase().includes(searchBoxText.toLowerCase()),
	);
	const filteredHistoryList = prevPrompts.filter((prompt) =>
		prompt.toLowerCase().includes(searchBoxText.toLowerCase()),
	);

	// Delete a completion suggestion from history
	function deleteHistorySuggestion(historyIndex: number): void {
		const newHistory = [...prevPrompts];
		newHistory.splice(historyIndex, 1);
		updatePrevPrompts(newHistory);
	}

	return (
		<div className="flex flex-col w-full max-w-xl mx-auto p-2">
			<div className="flex items-center bg-white border border-gray-300 rounded-lg shadow-sm px-3 py-2">
				<AiOutlineFileSearch
					className="text-gray-500 w-5 h-5 mr-2 cursor-pointer"
					onClick={() => {
						if (searchBoxText !== '') {
							updateSubmittedPrompt(searchBoxText);
							updateSearchBoxTextSent(true);
						}
					}}
				/>
				<textarea
					defaultValue=""
					value={searchBoxText}
					placeholder="Explain..."
					onChange={(event) => {
						updateSearchBoxTextSent(false);
						if (event.target.value.trim() === '') {
							updateSearchBoxText('');
							updateSubmittedPrompt('');
						} else updateSearchBoxText(event.target.value);
					}}
					// Adaptively resize textarea to fit text content
					ref={(ref) => ref && handleAutoResize(ref)}
					onKeyDown={(event) => {
						if (
							event.key === 'Enter' &&
							!event.shiftKey &&
							searchBoxText !== ''
						) {
							event.preventDefault(); // Prevent newline (submit instead)
							updateSubmittedPrompt(searchBoxText);
							updateSearchBoxTextSent(true);
							// Prepend submitted prompt to search history storing up to 25 prompts
							// TODO: Find better number for max history length
							prevPrompts.unshift(searchBoxText);
							if (prevPrompts.length > 25) {
								prevPrompts.pop();
							}
						}
					}}
					onFocus={() => {
						updateDropdownVisible(true);
					}}
					onBlur={() => {
						// To solve the issue of the dropdown disappearing when clicking on a suggestion
						// Solution: delay hiding the dropdown by 100ms
						if (!isDropdownClicked) {
							// Don't hide dropdown if holding click on dropdown
							setTimeout(() => {
								updateDropdownVisible(false);
							}, 100);
						}
					}}
					className="flex-1 resize-none outline-none text-gray-700 bg-transparent placeholder-gray-400"
				/>
				<AiFillCloseCircle
					style={{
						display: searchBoxText === '' ? 'none' : 'flex',
					}}
					className="text-gray-400 hover:text-gray-600 w-5 h-5 ml-2 cursor-pointer"
					onClick={() => {
						updateSearchBoxText('');
						updateSubmittedPrompt('');
						updateSearchBoxTextSent(false);
					}}
				/>
			</div>

			{/* The dropdown of prompt recommendations */}
			{(!searchBoxTextSent && dropdownVisible) ? (
				<div
					onMouseDown={() => {
						setIsDropdownClicked(true);
					}}
					onMouseUp={() => {
						setIsDropdownClicked(false);
					}}
					className="mt-2 bg-white border border-gray-200 rounded-lg shadow-lg"
				>
					<hr className="border-gray-200" />
					{/* Matching past searches */}
					<div className="max-h-60 overflow-y-auto">
						{/* Only show 3 past searches */}
						{filteredHistoryList
							.slice(0, 3)
							.map((prompt: string, index: number) => {
								return (
									<div
										key={`history-${index}`}
										className="flex items-center justify-between px-3 py-2 hover:bg-gray-50"
									>
										<div
											className="flex items-center flex-1 cursor-pointer"
											onClick={() => {
												updateSubmittedPrompt(prompt);
												updateSearchBoxText(prompt);
												updateSearchBoxTextSent(true);
											}}
										>
											<div className="flex items-center mr-2">
												<AiOutlineHistory className="text-gray-500 w-4 h-4" />
											</div>
											<div className="text-gray-700">
												{prompt}
											</div>
										</div>

										<div
											className="flex items-center ml-2 cursor-pointer"
											onClick={() => {
												deleteHistorySuggestion(index);
											}}
										>
											<AiOutlineClose className="text-gray-400 hover:text-gray-600 w-4 h-4" />
										</div>
									</div>
								);
							})}

						{/* "New" prompt suggestions */}
						{filteredNewPromptList.map(
							(prompt: string, index: number) => {
								return (
									<div
										key={`new-${index}`}
										className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
										onClick={() => {
											updateSubmittedPrompt(prompt);
											updateSearchBoxText(prompt);
											updateSearchBoxTextSent(true);

											// Prepend submitted prompt to search history storing up to 25 prompts
											prevPrompts.unshift(prompt);
											if (prevPrompts.length > 25) {
												prevPrompts.pop();
											}
										}}
									>
										<div className="flex items-center mr-2">
											<FcNext className="w-4 h-4" />
										</div>
										<div className="text-gray-700">
											{prompt}
										</div>
									</div>
								);
							},
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
