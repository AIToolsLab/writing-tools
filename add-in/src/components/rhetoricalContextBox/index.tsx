import { useState } from 'react';
import { BsCheck2Circle } from 'react-icons/bs';
import { Toggle } from '@fluentui/react/lib/Toggle';

import classes from './styles.module.css';
import { handleAutoResize } from '@/utilities';


interface RhetoricalContextBoxProps {
    curRhetCtxt: string;
	updateRhetCtxt: (rhetCtxt: string) => void;
}

export function RhetoricalContextBox(
    props: RhetoricalContextBoxProps
): JSX.Element {
    const { curRhetCtxt, updateRhetCtxt } = props;
    
    const [rhetCtxtBoxVisible, updateRhetCtxtBoxVisible] = useState(false);
    const [rhetCtxtSaved, updateRhetCtxtSaved] = useState(false);
    const [searchBoxText, updateSearchBoxText] = useState('');

    return (
        <div className={ classes.rhetoricalSituation }>
            { /* Toggle to show/hide rhetorical context box */ }
            <Toggle
                className={ classes.toggle }
                label="More Options"
                inlineLabel
                onChange={ (_event, checked) => {
                    if (checked)
                        updateRhetCtxtBoxVisible(true);
                    else
                        updateRhetCtxtBoxVisible(false);
                } }
                checked={ rhetCtxtBoxVisible }
            />
            {   
                rhetCtxtBoxVisible && (
                    <>
                        <div className={ classes.situationBoxLabel }>
                                Rhetorical Situation:
                        </div>
                        { /* Show underline when text field is non-empty (for visibility) */ }
                        <div 
                            className={
                                searchBoxText === '' ?
                                    classes.situationBoxWrapper :
                                    classes.situationBoxWrapperContent
                            }
                        >
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
                                // Adaptively resize textarea to fit text content
                                ref={ ref => ref && handleAutoResize(ref) }
                                onKeyDown={ (event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault(); // Prevent newline (submit instead)
                                        if (searchBoxText !== '') {
                                            updateRhetCtxt(searchBoxText);
                                            updateRhetCtxtSaved(true);
                                        }
                                    }
                                } }
                            />
                            { /* Save button; color-coded to indicate save status */ }
                            <BsCheck2Circle
                                className={ rhetCtxtSaved ? classes.savedButtonGreen : classes.savedButtonGray }
                                onClick={ () => {
                                    if (searchBoxText !== '') {
                                        updateRhetCtxt(searchBoxText);
                                        updateRhetCtxtSaved(true);
                                    }
                                } }
                            />
                        </div>
                    </>
                )
            }
        </div>
    );
}
