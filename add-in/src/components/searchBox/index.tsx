import { useState } from 'react';
import { AiOutlineFileSearch, AiFillCloseCircle, AiOutlineHistory } from 'react-icons/ai';
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

    const [prevPrompts, _updatePrevPrompts] = useState<string[]>([]);
    const [searchBoxText, updateSearchBoxText] = useState('');
    const [searchBoxTextSent, updateSearchBoxTextSent] = useState(false);
    const [dropdownVisible, updateDropdownVisible] = useState(false);

    // Filter the prompt list based on the current prompt
    const filteredNewPromptList = suggestedPrompts.filter((prompt) =>
        prompt.toLowerCase().includes(searchBoxText.toLowerCase())
    );

    // Filter the prompt list based on the current prompt
    const filteredHistoryList = prevPrompts.filter((prompt) =>
        prompt.toLowerCase().includes(searchBoxText.toLowerCase())
    );

    // TO DO: Implement autocomplete / get prompt suggestions?

    return (
        <div className={ classes.searchBoxWrapper }>
            <div className={ classes.searchBox }>
                <AiOutlineFileSearch
                    className={ classes.searchBoxIcon }
                    onClick={ () => {
                        if (searchBoxText !== '') {
                            updatePrompt(searchBoxText);
                            updateSearchBoxTextSent(true);
                        }
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
                        if (event.key === 'Enter' && !event.shiftKey && searchBoxText !== '') {
                            event.preventDefault();
                            updatePrompt(searchBoxText);
                            updateSearchBoxTextSent(true);
                            prevPrompts.unshift(searchBoxText);
                            if (prevPrompts.length > 25) {
                                prevPrompts.pop();
                            }
                        }
                    } }
                    onFocus={ () => {
                        updateDropdownVisible(true);
                    } }
                    onBlur={ () => {
                        setTimeout(() => {
                            updateDropdownVisible(false);
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
                        updateSearchBoxTextSent(false);
                    } }
                />
            </div>

            {    (!searchBoxTextSent && dropdownVisible) && (
                <>
                    <hr/>
                    <ul>
                        { filteredHistoryList.slice(0, 3).map((prompt: string, index: number) => {
                            return (
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
                                        <AiOutlineHistory className={ classes.dropdownHistoryIcon } />
                                    </div>
                                    { prompt }
                                </li>
                            );
                        }) }
                    </ul>
                    <ul>
                        { filteredNewPromptList.map((prompt: string, index: number) => {
                            return (
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
                                        <FcNext className={ classes.dropdownBulletIcon } />
                                    </div>
                                    { prompt }
                                </li>
                            );
                        }) }
                    </ul>
                </>
              ) }
        </div>
    );
}

