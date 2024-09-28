import { useContext } from 'react';

import { PageContext } from '@/contexts/pageContext';

import classes from './styles.module.css';

const pageNames = [
	{ name: 'reflections', title: 'Reflections' },
	{ name: 'focals', title: 'Focals' },
	{ name: 'chat', title: 'Chat' }
];

export default function Navbar() {
	const { page, changePage } = useContext(PageContext);

	return (
		<nav className={ classes.nav }>
			{ pageNames.map(({ name: pageName, title: pageTitle }) => (
				<p
					key={ pageName }
					onClick={ () => changePage(pageName) }
					className={ page === pageName ? classes.active : '' }
				>
					{ pageTitle }
				</p>
			)) }
		</nav>
	);
}
