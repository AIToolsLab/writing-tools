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

    const [searchBoxText, updateSearchBoxText] = useState('');
    const [searchBoxTextSent, updateSearchBoxTextSent] = useState(false);

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
                        updateSearchBoxTextSent(true);
                    } }
                />
                <textarea
                    defaultValue=""
                    value={ searchBoxText }
                    placeholder="Explain..."
                    onChange={ (event) => {
                        updateSearchBoxTextSent(false);
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
                            updateSearchBoxTextSent(true);
                        }
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
                        updateSearchBoxTextSent(false);
                    } }
                />
            </div>
            <div className={ classes.searchBoxDropdown }>
                <ul>
                    {   !searchBoxTextSent &&
                            filteredPromptList.map((prompt, index) => (
                                <li
                                    className={ classes.searchBoxDropdownItem }
                                    key={ index }
                                    onClick={ () => {
                                        updatePrompt(prompt);
                                        updateSearchBoxText(prompt);
                                        updateSearchBoxTextSent(true);
                                    } }
                                >
                                    <div className={ classes.searchBoxDropdownIconWrapper }>
                                        <FcNext className={ classes.searchBoxDropdownIcon } />
                                    </div>
                                    { prompt }
                                </li>
                            ))
                    }
                </ul>
            </div>
        </div>
    );
}

