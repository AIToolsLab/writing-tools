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

	// 1.5 minutes
	const PINGINT: number = 90 * 1000;

	useEffect(() => {
		// First ping the server immediately
		// eslint-disable-next-line no-console
		console.log(`Pinging server at ${new Date().toISOString()}`);
		pingServer()
			.then(() => {
				// eslint-disable-next-line no-console
				console.log('Ping successful');
			})
			.catch(error => {
				// eslint-disable-next-line no-console
				console.error('Ping failed:', error);
			});

		// Then set up an interval to ping the server every 1.5 minutes
		pingInterval.current = setInterval(() => {
			// eslint-disable-next-line no-console
			console.log(`Pinging server at ${new Date().toISOString()}`);

			pingServer()
				// eslint-disable-next-line no-console
				.then(() => console.log('Ping successful'))
				// eslint-disable-next-line no-console
				.catch(error => console.error('Ping failed:', error));
		}, PINGINT);
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
