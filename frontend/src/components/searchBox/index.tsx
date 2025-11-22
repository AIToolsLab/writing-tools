import React, { useState } from 'react';
import { AiOutlineFileSearch, AiFillCloseCircle, AiOutlineHistory, AiOutlineClose } from 'react-icons/ai';
import { FcNext } from 'react-icons/fc';
import { handleAutoResize } from '@/utilities';

interface SearchBoxProps {
  prevPrompts: string[];
  filteredNewPromptList: string[];
  filteredHistoryList: string[];
  updatePrevPrompts: (p: string[]) => void;
  updateSubmittedPrompt: (p: string) => void;
  updateSearchBoxText: (p: string) => void;
  updateSearchBoxTextSent: (b: boolean) => void;
  updateSubmittedPromptFromDropdown?: (p: string) => void;
}

export function SearchBox(props: SearchBoxProps): JSX.Element {
  const {
    prevPrompts,
    filteredNewPromptList,
    filteredHistoryList,
    updatePrevPrompts,
    updateSubmittedPrompt,
    updateSearchBoxText,
    updateSearchBoxTextSent,
  } = props;

  const [searchBoxText, setSearchBoxText] = useState('');
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [searchBoxTextSent, setSearchBoxTextSent] = useState(false);
  const [isDropdownClicked, setIsDropdownClicked] = useState(false);

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
            }
          }}
        />
        <textarea
          value={searchBoxText}
          onChange={(e) => {
            setSearchBoxText(e.target.value);
            updateSearchBoxText(e.target.value);
            setDropdownVisible(true);
          }}
          onFocus={() => setDropdownVisible(true)}
          ref={(ref) => ref && handleAutoResize(ref)}
          className="flex-1 resize-none outline-none text-gray-700 bg-transparent placeholder-gray-400"
          placeholder="Search or type a prompt"
        />
        <AiFillCloseCircle
          style={{ display: searchBoxText === '' ? 'none' : 'flex' }}
          className="text-gray-400 hover:text-gray-600 w-5 h-5 ml-2 cursor-pointer"
          onClick={() => {
            setSearchBoxText('');
            updateSubmittedPrompt('');
            updateSearchBoxTextSent(false);
          }}
        />
      </div>

      {/* The dropdown of prompt recommendations */}
      {(!searchBoxTextSent && dropdownVisible) ? (
        <div
          onMouseDown={() => setIsDropdownClicked(true)}
          onMouseUp={() => setIsDropdownClicked(false)}
          className="mt-2 bg-white border border-gray-200 rounded-lg shadow-lg"
        >
          <hr className="border-gray-200" />
          {/* Matching past searches */}
          <div className="max-h-60 overflow-y-auto">
            {/* Only show 3 past searches */}
            {filteredHistoryList.slice(0, 3).map((prompt: string, index: number) => {
              return (
                <div key={`history-${index}`} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                  <li
                    className="flex items-center flex-1 cursor-pointer list-none"
                    onClick={() => {
                      updateSubmittedPrompt(prompt);
                      setSearchBoxText(prompt);
                      updateSearchBoxTextSent(true);
                    }}
                  >
                    <div className="flex items-center mr-2">
                      <AiOutlineHistory className="text-gray-500 w-4 h-4" />
                    </div>
                    <div className="text-gray-700">{prompt}</div>
                  </li>

                  <div className="flex items-center ml-2 cursor-pointer" onClick={() => deleteHistorySuggestion(index)}>
                    <AiOutlineClose className="text-gray-400 hover:text-gray-600 w-4 h-4" />
                  </div>
                </div>
              );
            })}

            {/* "New" prompt suggestions */}
            {filteredNewPromptList.map((prompt: string, index: number) => {
              return (
                <div
                  key={`new-${index}`}
                  className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  onClick={() => {
                    updateSubmittedPrompt(prompt);
                    setSearchBoxText(prompt);
                  }}
                >
                  <div className="flex items-center mr-2">
                    <FcNext className="w-4 h-4" />
                  </div>
                  <div className="text-gray-700">{prompt}</div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}