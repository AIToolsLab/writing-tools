import { useState } from 'react';
import {
	AiOutlineFileSearch,
	AiOutlineClose,
	AiFillCloseCircle,
	AiOutlineHistory,
} from 'react-icons/ai';
import { FcNext } from 'react-icons/fc';

import classes from './styles.module.css';
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
		<div className={classes.searchBoxWrapper}>
			<div className={classes.searchBox}>
				<AiOutlineFileSearch
					className={classes.searchBoxIcon}
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
				/>
				<AiFillCloseCircle
					style={{
						display: searchBoxText === '' ? 'none' : 'flex',
					}}
					className={classes.searchBoxClear}
					onClick={() => {
						updateSearchBoxText('');
						updateSubmittedPrompt('');
						updateSearchBoxTextSent(false);
					}}
				/>
			</div>
			{/* The dropdown of prompt recommendations */}
			{!searchBoxTextSent && dropdownVisible && (
				<div
					onMouseDown={() => {
						setIsDropdownClicked(true);
					}}
					onMouseUp={() => {
						setIsDropdownClicked(false);
					}}
				>
					<hr />
					{/* Matching past searches */}

					<ul>
						{/* Only show 3 past searches */}
						{filteredHistoryList
							.slice(0, 3)
							.map((prompt: string, index: number) => {
								return (
									// TODO: make it a valid DOM structure (ul should have li as children)
									<div
										className={
											classes.historySuggestionContainer
										}
									>
										<li
											className={
												classes.searchBoxDropdownItem
											}
											key={index}
											onClick={() => {
												updateSubmittedPrompt(prompt);
												updateSearchBoxText(prompt);
												updateSearchBoxTextSent(true);
											}}
										>
											<div
												className={
													classes.searchBoxDropdownIconWrapper
												}
											>
												<AiOutlineHistory
													className={
														classes.dropdownHistoryIcon
													}
												/>
											</div>
											<div
												className={
													classes.generationText
												}
											>
												{prompt}
											</div>
										</li>

										<div
											className={
												classes.searchBoxDropdownDeleteIconWrapper
											}
											onClick={() => {
												deleteHistorySuggestion(index);
											}}
										>
											<AiOutlineClose
												className={
													classes.dropdownDeleteIcon
												}
											/>
										</div>
									</div>
								);
							})}

						{/* "New" prompt suggestions */}

						{filteredNewPromptList.map(
							(prompt: string, index: number) => {
								return (
									<li
										className={
											classes.searchBoxDropdownItem
										}
										key={index}
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
										<div
											className={
												classes.searchBoxDropdownIconWrapper
											}
										>
											<FcNext
												className={
													classes.dropdownBulletIcon
												}
											/>
										</div>
										<div className={classes.generationText}>
											{prompt}
										</div>
										{/* <div
                                        className={ classes.searchBoxDropdownDeleteIconWrapper }
                                        onClick={ () => {
                                            handleSuggestionDelete(prompt);
                                        } }
                                    >
                                        <AiOutlineClose className={ classes.dropdownDeleteIcon } />
                                    </div> */}
									</li>
								);
							},
						)}
					</ul>
				</div>
			)}
		</div>
	);
}
