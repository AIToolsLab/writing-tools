import { useContext, useEffect, useRef } from 'react';
import { pingServer } from '@/api';

import { PageContext } from '@/contexts/pageContext';

import classes from './styles.module.css';

const pageNames = [
	{ name: 'draft', title: 'Draft' },
	// { name: 'revise', title: 'Revise' },
	// { name: 'searchbar', title: 'SearchBar' },
	// { name: 'chat', title: 'Chat' },
];

export default function Navbar() {
	const { page, changePage } = useContext(PageContext);

	const pingInterval = useRef<NodeJS.Timeout>();

	// 2 minutes
	const PINGINT: number = 2 * 60 * 1000;

	useEffect(() => {
		function doPing() {
			// eslint-disable-next-line no-console
			console.log(`Pinging server at ${new Date().toISOString()}`);

			pingServer().then(() => {
				// eslint-disable-next-line no-console
				console.log('Warming up server');
			}).catch(error => {
				// eslint-disable-next-line no-console
				console.warn('Ping failed:', error);
			});
		}

		// First ping the server immediately
		doPing();
		// Then set up the interval
		pingInterval.current = setInterval(doPing, PINGINT);

		return () => {
			if (pingInterval.current) {
				clearInterval(pingInterval.current);
			}
		};
	}, []);

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
