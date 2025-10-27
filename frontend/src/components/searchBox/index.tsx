import { useState } from "react";
import {
	AiOutlineFileSearch,
	AiOutlineClose,
	AiFillCloseCircle,
	AiOutlineHistory,
} from "react-icons/ai";
import { FcNext } from "react-icons/fc";

import classes from "./styles.module.css";
import { handleAutoResize } from "@/utilities";

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
	const [searchBoxText, updateSearchBoxText] = useState(""); // Current search text
	const [searchBoxTextSent, updateSearchBoxTextSent] = useState(false); // Whether search text has been submitted
	const [dropdownVisible, updateDropdownVisible] = useState(false); // Whether searchbar dropdown is visible
	const [isDropdownClicked, setIsDropdownClicked] = useState(false); // Whether searchbar dropdown is clicked

	// Filter the prompt lists based on the current prompt
	const filteredNewPromptList = promptSuggestions.filter((prompt) =>
		prompt.toLowerCase().includes(searchBoxText.toLowerCase())
	);
	const filteredHistoryList = prevPrompts.filter((prompt) =>
		prompt.toLowerCase().includes(searchBoxText.toLowerCase())
	);

	// Delete a completion suggestion from history
	function deleteHistorySuggestion(historyIndex: number): void {
		const newHistory = [...prevPrompts];
		newHistory.splice(historyIndex, 1);
		updatePrevPrompts(newHistory);
	}

	return (
		<div
			className={`border-2 border-gray-100 bg-gray-100 rounded-[28px] shadow-[0_10px_24px_rgba(0,0,0,0.3)] mb-3 ${classes.searchBoxWrapper}`}
		>
			<div className="flex items-center px-[15px]">
				<AiOutlineFileSearch
					className="text-[#76abae] text-[1.2rem] transition duration-150 hover:text-[#31363f]"
					onClick={() => {
						if (searchBoxText !== "") {
							updateSubmittedPrompt(searchBoxText);
							updateSearchBoxTextSent(true);
						}
					}}
				/>
				<textarea
					className="bg-transparent border-none w-full text-[0.9rem] p-2 resize-none box-border align-middle focus:outline-none"
					defaultValue=""
					value={searchBoxText}
					placeholder="Explain..."
					onChange={(event) => {
						updateSearchBoxTextSent(false);
						if (event.target.value.trim() === "") {
							updateSearchBoxText("");
							updateSubmittedPrompt("");
						} else updateSearchBoxText(event.target.value);
					}}
					ref={(ref) => ref && handleAutoResize(ref)}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							searchBoxText !== ""
						) {
							event.preventDefault();
							updateSubmittedPrompt(searchBoxText);
							updateSearchBoxTextSent(true);

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
						if (!isDropdownClicked) {
							setTimeout(() => {
								updateDropdownVisible(false);
							}, 100);
						}
					}}
				/>
				<AiFillCloseCircle
					style={{
						display: searchBoxText === "" ? "none" : "flex",
					}}
					className="text-[#76abae] text-[1.4rem] cursor-pointer transition duration-150 hover:text-[#31363f]"
					onClick={() => {
						updateSearchBoxText("");
						updateSubmittedPrompt("");
						updateSearchBoxTextSent(false);
					}}
				/>
			</div>

			{/* Dropdown of prompt recommendations */}
			{!searchBoxTextSent && dropdownVisible ? (
				<div
					onMouseDown={() => {
						setIsDropdownClicked(true);
					}}
					onMouseUp={() => {
						setIsDropdownClicked(false);
					}}
				>
					<hr className="w-[95%] border-none h-px bg-[#cccccc]" />

					<ul>
						{/* Past search history (up to 3) */}
						{filteredHistoryList.slice(0, 3).map((prompt, index) => (
							<div
								key={`history-${index}`}
								className="flex flex-row items-center"
							>
								<li
									className="flex items-center p-2 border-b border-gray-100 cursor-pointer transition duration-150 last:border-b-0 last:pb-5 last:rounded-b-[28px] hover:text-[#00b8f5]"
									onClick={() => {
										updateSubmittedPrompt(prompt);
										updateSearchBoxText(prompt);
										updateSearchBoxTextSent(true);
									}}
								>
									<div className="flex items-center">
										<AiOutlineHistory className="text-[1rem] text-[#bbbbbb] mr-2" />
									</div>
									<div className="ml-1 mr-8">{prompt}</div>
								</li>

								<div
									className="flex items-center cursor-pointer rounded-[16px] p-[2px] ml-auto mr-1 transition duration-150 hover:bg-[#eeeeee]"
									onClick={() => deleteHistorySuggestion(index)}
								>
									<AiOutlineClose className="text-[1rem] text-[#888888]" />
								</div>
							</div>
						))}

						{/* New prompt suggestions */}
						{filteredNewPromptList.map((prompt, index) => (
							<li
								key={`new-${index}`}
								className="flex items-center p-2 border-b border-gray-100 cursor-pointer transition duration-150 last:border-b-0 last:pb-5 last:rounded-b-[28px] hover:text-[#00b8f5]"
								onClick={() => {
									updateSubmittedPrompt(prompt);
									updateSearchBoxText(prompt);
									updateSearchBoxTextSent(true);

									prevPrompts.unshift(prompt);
									if (prevPrompts.length > 25) {
										prevPrompts.pop();
									}
								}}
							>
								<div className="flex items-center">
									<FcNext className="text-[0.65rem] mr-1" />
								</div>
								<div className="ml-1 mr-8">{prompt}</div>
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	);
}
