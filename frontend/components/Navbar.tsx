'use client';

import { useAtom } from 'jotai';
import { PageName, pageNameAtom } from '@/contexts/pageContext';
import classes from './Navbar.module.css';

type Page = {
	name: PageName;
	title: string;
	hint: string;
};

const pageNames: Page[] = [
	{ name: PageName.Draft, title: 'Draft', hint: 'Generate suggestions' },
	{ name: PageName.Revise, title: 'Revise', hint: 'Improve your text' },
	{ name: PageName.Chat, title: 'Chat', hint: 'Ask about your doc' },
];

export default function Navbar() {
	const [page, changePage] = useAtom(pageNameAtom);

	return (
		<div className={classes.tabs}>
			{pageNames.map(({ name: pageName, title: pageTitle, hint }) => (
				<button
					key={pageName}
					type="button"
					onClick={() => changePage(pageName)}
					className={`${classes.tabBtn} ${page === pageName ? classes.active : ''}`}
				>
					{pageTitle}
					<span className={classes.tabHint}>{hint}</span>
				</button>
			))}
		</div>
	);
}
