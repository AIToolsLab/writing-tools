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
            <TextField
                value={ userId }
                placeholder="User ID"
                onChange={ (_e, value) => updateId(value) }
            />

            <button
                onClick={
                    () => {
                        updateUserId(parseInt(userId));
                        changePage(
                            ['reflections', 'chat'][Math.floor(Math.random() * 2)]
                        );
                    }
                }
            >
                Login
            </button>
        </div>
    );
}
