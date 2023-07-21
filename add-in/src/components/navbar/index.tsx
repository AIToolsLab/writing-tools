import React, { useContext } from 'react';

import { PageContext } from '../../contexts/pageContext';

import classes from './styles.module.css';

export default function Navbar() {
    const { page, changePage } = useContext(PageContext);

    return (
        <nav className={ classes.nav }>
            <p onClick={ () => changePage('reflections') } className={ (page === 'reflections' ? classes.active : '') }>Reflections</p>
            <p onClick={ () => changePage('chat') } className={ (page === 'chat' ? classes.active : '') }>Chat</p>
        </nav>
    );
}
