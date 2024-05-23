import { useState } from 'react';
import { AiFillCloseCircle } from 'react-icons/ai';
import { FcTodoList, FcCheckmark } from 'react-icons/fc';
import { Toggle } from '@fluentui/react/lib/Toggle';

import classes from './styles.module.css';


function handleAutoResize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = '100%';
    textarea.style.height = `${textarea.scrollHeight}px`;
}

interface RhetoricalSituationProps {
    curRhetCtxt: string;
	updateRhetCtxt: (rhetCtxt: string) => void;
}

export const defaultRhetCtxt = '';

export function RhetoricalSituation(
    props: RhetoricalSituationProps
): JSX.Element {
    const { curRhetCtxt, updateRhetCtxt } = props;
    
    const [showSituationBox, updateShowSituationBox] = useState(false);
    const [searchBoxText, updateSearchBoxText] = useState('');
    const [rhetCtxtSaved, updateRhetCtxtSaved] = useState(false);

    return (
        <div className={ classes.rhetoricalSituation }>
            <Toggle
                className={ classes.toggle }
                label="More Options"
                inlineLabel
                onChange={ (event, checked) => {
                    if (checked)
                        updateShowSituationBox(true);
                    else
                        updateShowSituationBox(false);
                } }
                checked={ showSituationBox }
            />
            {   
                showSituationBox && (
                    <>
                        <div className={ classes.situationBoxLabel }>
                                Rhetorical Situation:
                                <FcCheckmark
                                    style={ {
                                        display: rhetCtxtSaved ? 'inline' : 'none'
                                    } }
                                    className={ classes.savedButton }
                                    onClick={ () => {
                                        updateRhetCtxt('');
                                        updateRhetCtxtSaved(false);
                                    } }
                                />
                        </div>
                        <div 
                            className={
                                curRhetCtxt === '' ?
                                    classes.situationBoxWrapper :
                                    classes.situationBoxWrapperContent
                            }
                        >
                            <FcTodoList
                                style={ {
                                    display: searchBoxText === '' ? 'none' : 'flex'
                                } }
                                className={ classes.situationBoxIcon }
                                onClick={ () => {
                                    updateRhetCtxt(searchBoxText);
                                    updateRhetCtxtSaved(true);
                                } }
                            />
                            <textarea
                                defaultValue=""
                                value={ searchBoxText }
                                placeholder="Enter Rhetorical Situation..."
                                onChange={ (event) => {
                                    if (rhetCtxtSaved)
                                        updateRhetCtxtSaved(false);
                                    if (event.target.value.trim() === '') {
                                        updateSearchBoxText('');
                                        updateRhetCtxt('');
                                    }
                                    else 
                                        updateSearchBoxText(event.target.value);
                                } }
                                ref={ ref => ref && handleAutoResize(ref) }
                                onKeyDown={ (event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        updateRhetCtxt(searchBoxText);
                                        if (searchBoxText !== '')
                                            updateRhetCtxtSaved(true);
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
                                    updateRhetCtxt('');
                                    updateRhetCtxtSaved(false);
                                } }
                            />
                        </div>
                    </>
                )
            }
        </div>
    );
}
