import React from 'react';
import { TextField } from '@fluentui/react';

import { UserContext } from '../../contexts/userContext';
import { PageContext } from '../../contexts/pageContext';

import classes from './styles.module.css';

export default function Login() {
    const { changePage } = React.useContext(PageContext);
    const { updateUserId } = React.useContext(UserContext);

    const [userId, updateId] = React.useState('');

    
    return (
        <div className={ classes.container }>
            <input type="number"
                value={ userId } 
                placeholder="Participant ID"
                onChange={ (e) => updateId(e.target.value) }
                />

            <button
                onClick={
                    () => {
                        const userIdInt = parseInt(userId);
                        updateUserId(userIdInt);
                        const pageOrder = 
                            (userIdInt % 2 === 0) ?
                            ['reflections', 'chat'] :
                            ['chat', 'reflections'];
                        changePage(
                            pageOrder[0]
                        );
                    }
                }
                disabled={ ! (parseInt(userId) > 0) /* doesn't parse to a valid int */ }
            >
                Login
            </button>
        </div>
    );
}
