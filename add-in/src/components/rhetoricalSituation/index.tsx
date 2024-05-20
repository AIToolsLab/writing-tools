import { useState } from 'react';
import { AiFillCloseCircle } from "react-icons/ai";
import { Toggle } from '@fluentui/react/lib/Toggle';

import classes from './styles.module.css';


function handleAutoResize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = '100%';
    textarea.style.height = `${textarea.scrollHeight}px`;
}

interface RhetoricalSituationProps {
    currentPrefix: string;
	updatePrefix: (prefix: string) => void;
}

export const defaultPrefix = '';

export function RhetoricalSituation(
    props: RhetoricalSituationProps
): JSX.Element {
    const { currentPrefix, updatePrefix } = props;
    
    const [showSituationBox, updateShowSituationBox] = useState(false);

    // TO DO: Only update the prompt on user interaction (e.g. pressing enter / clicking the send icon )
    return (
        <div className={classes.rhetoricalSituation}>
            <Toggle
                className={classes.toggle}
                label="More Options"
                inlineLabel
                onChange={(event, checked) => {
                    if (checked) {
                        updateShowSituationBox(true);
                    } else {
                        updateShowSituationBox(false);
                    }
                }}
                checked={showSituationBox}
            />
            {   showSituationBox &&
                <div 
                    className={
                        currentPrefix === '' ?
                            classes.situationBoxWrapper :
                            classes.situationBoxWrapperContent
                    }
                >
                    <textarea
                        defaultValue=""
                        value={currentPrefix}
                        placeholder="Enter Rhetorical Situation..."
                        onChange={(event) => {
                            if (event.target.value.trim() === '')
                                updatePrefix('');
                            else 
                                updatePrefix(event.target.value);
                        }}
                        // className={classes.rhetoricalSituationInput}
                        ref={ref => ref && handleAutoResize(ref)}
                    />
                    <AiFillCloseCircle
                        style={{
                            display: currentPrefix === '' ? 'none' : 'flex'
                        }}
                        className={classes.searchBoxClear}
                        onClick={() => updatePrefix('')}
                    />
                </div>
            }
        </div>
    );
}
