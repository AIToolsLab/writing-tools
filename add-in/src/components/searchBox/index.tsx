import { useState } from "react";
import { AiOutlineFileSearch, AiFillCloseCircle } from "react-icons/ai";
import { FcNext } from "react-icons/fc";


import classes from './styles.module.css';

// Handle auto resizing of the textarea
function handleAutoResize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = '100%';
    textarea.style.height = `${textarea.scrollHeight}px`;
}

// TO DO: Modify/Revise the prompts
const promptList = [
    'What is the main point of this paragraph?',
    'What are the important concepts in this paragraph? List three of them in dashes -',
    'What are the claims or arguments presented in this paragraph? List three of them in dashes -',
    'What are some potential counterarguments to the claims presented in this paragraph? Make tentative statements, list three of them in dashes -',
    'What further evidence or examples would you like to see to support the claims presented in this paragraph? List three of them in dashes -',
    'What outside the box questions do you have about this paragraph? List three of them in dashes -',
    'What questions do you have about this paragraph as a writer? List three of them in dashes -',
    'What questions do you have about this paragraph as a reader? List three of them in dashes -',
];

interface SearchBoxProps {
	currentPrompt: string;
	updatePrompt: (prompt: string) => void;
}

// export const defaultPrompt = promptList[0];

export function SearchBox(
    props: SearchBoxProps
): JSX.Element {
    const { currentPrompt, updatePrompt } = props;
    const [ searchboxPrompt, updateSearchboxPrompt ] = useState('');

    // Filter the prompt list based on the current prompt
    const filteredPromptList = promptList.filter((prompt) =>
        prompt.toLowerCase().includes(currentPrompt.toLowerCase())
    );

    // TO DO: handle empty prompt (maybe ask user to select a prompt from the list or hide the reflectionCard?)

    // TO DO: Only update the prompt on user interaction (e.g. pressing enter / selecting the prompt from the list / clicking the search icon)

    // TO DO: Implement autocomplete / get prompt suggestions?

    return (
        <div className={classes.searchBoxWrapper}>
            <div className={classes.searchBox}>
                <AiOutlineFileSearch
                    className={classes.searchBoxIcon}
                />
                <textarea
                    defaultValue=""
                    value={currentPrompt}
                    placeholder="Search for a prompt or select one from the list below..."
                    onChange={(event) => {
                        if (event.target.value.trim() === '')
                            updatePrompt('');
                        else 
                            updatePrompt(event.target.value);
                    }}
                    className={classes.searchBoxInput}
                    ref={ref => ref && handleAutoResize(ref)}
                />
                <AiFillCloseCircle
                    style={{
                        display: currentPrompt === '' ? 'none' : 'flex'
                    }}
                    className={classes.searchBoxClear}
                    onClick={() => updatePrompt('')}
                />
            </div>
            <div className={classes.searchBoxDropdown}>
                <ul>
                    {filteredPromptList.map((prompt, index) => (
                        <li
                            className={classes.searchBoxDropdownItem}
                            key={index}
                            onClick={() => updatePrompt(prompt)}
                        >
                            <div className={classes.searchBoxDropdownIconWrapper}>
                                <FcNext className={classes.searchBoxDropdownIcon} />
                            </div>
                            {prompt}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}

