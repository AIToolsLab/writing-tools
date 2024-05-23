import { useState } from 'react';
import { AiFillCloseCircle } from 'react-icons/ai';
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

    // TO DO: Only update the prompt on user interaction (e.g. pressing enter / clicking the send icon )
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
                    <div 
                        className={
                            curRhetCtxt === '' ?
                                classes.situationBoxWrapper :
                                classes.situationBoxWrapperContent
                        }
                    >
                        <textarea
                            defaultValue=""
                            value={ curRhetCtxt }
                            placeholder="Enter Rhetorical Situation..."
                            onChange={ (event) => {
                                if (event.target.value.trim() === '')
                                    updateRhetCtxt('');
                                else 
                                    updateRhetCtxt(event.target.value);
                            } }
                            ref={ ref => ref && handleAutoResize(ref) }
                        />
                        <AiFillCloseCircle
                            style={ {
                                display: curRhetCtxt === '' ? 'none' : 'flex'
                            } }
                            className={ classes.searchBoxClear }
                            onClick={ () => updateRhetCtxt('') }
                        />
                    </div>
                )
            }
        </div>
    );
}
