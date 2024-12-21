import { useContext } from 'react';
import { PageName } from '@/contexts/pageContext';

import { PageContext } from '@/contexts/pageContext';

import classes from './styles.module.css';

/**
 * An array of objects representing the names and titles of pages.
 * Each object contains the following properties:
 * 
 * @property {PageName} name - The name identifier of the page.
 * @property {string} title - The display title of the page.
 */

type Page = {
	name: PageName;
	title: string;
};

const pageNames: Page[] = [
	{ name: PageName.Draft, title: 'Draft' },
	// { name: 'revise', title: 'Revise' },
	// { name: 'searchbar', title: 'SearchBar' },
	// { name: 'chat', title: 'Chat' },
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
