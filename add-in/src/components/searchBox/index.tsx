import { useState } from 'react';
import { AiOutlineFileSearch, AiFillCloseCircle } from 'react-icons/ai';
import { FcNext } from 'react-icons/fc';

import classes from './styles.module.css';

// Handle auto resizing of the textarea
function handleAutoResize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = '100%';
    textarea.style.height = `${textarea.scrollHeight}px`;
}

interface SearchBoxProps {
	updatePrompt: (prompt: string) => void;
    suggestedPrompts: string[];
}

export function SearchBox(
    props: SearchBoxProps
): JSX.Element {
    const { updatePrompt, suggestedPrompts } = props;

    const [searchActive, updateSearchActive] = useState(false);
    const [searchBoxText, updateSearchBoxText] = useState('');

    // Filter the prompt list based on the current prompt
    const filteredPromptList = suggestedPrompts.filter((prompt) =>
        prompt.toLowerCase().includes(searchBoxText.toLowerCase())
    );

    // TO DO: Implement autocomplete / get prompt suggestions?

    return (
        <div className={ classes.searchBoxWrapper }>
            <div className={ classes.searchBox }>
                <AiOutlineFileSearch
                    className={ classes.searchBoxIcon }
                    onClick={ () => {
                        updatePrompt(searchBoxText);
                    } }
                />
                <textarea
                    defaultValue=""
                    value={ searchBoxText }
                    placeholder="Enter a prompt or select one below"
                    onChange={ (event) => {
                        if (event.target.value.trim() === '') {
                            updateSearchBoxText('');
                            updatePrompt('');
                        }
                        else 
                            updateSearchBoxText(event.target.value);
                    } }
                    ref={ ref => ref && handleAutoResize(ref) }
                    onKeyDown={ (event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            updatePrompt(searchBoxText);
                        }
                    } }
                    onFocus={ () => updateSearchActive(true) }
                    onBlur={ () => {
                        setTimeout(() => {
                            updateSearchActive(false);
                        }, 100);
                    } }
                />
                <AiFillCloseCircle
                    style={ {
                        display: searchBoxText === '' ? 'none' : 'flex'
                    } }
                    className={ classes.searchBoxClear }
                    onClick={ () => {
                        updateSearchBoxText('');
                        updatePrompt('');
                    } }
                />
            </div>
            {   searchActive && (
                    <div className={ classes.searchBoxDropdown }>
                        <ul>
                            { filteredPromptList.map((prompt, index) => (
                                <li
                                    className={ classes.searchBoxDropdownItem }
                                    key={ index }
                                    onClick={ () => {
                                        updatePrompt(prompt);
                                        updateSearchBoxText(prompt);
                                    } }
                                >
                                    <div className={ classes.searchBoxDropdownIconWrapper }>
                                        <FcNext className={ classes.searchBoxDropdownIcon } />
                                    </div>
                                    { prompt }
                                </li>
                            )) }
                        </ul>
                    </div>
                )
            }
        </div>
    );
}

