import {
	OverallMode,
	overallModeAtom,
	PageName,
	pageNameAtom,
} from '@/contexts/pageContext';

import classes from './styles.module.css';
import { useAtom, useAtomValue } from 'jotai';
import ButtonSecondary from '@/components/ui/button-secondary';

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
	{ name: PageName.Revise, title: 'Revise' },
	{ name: PageName.Chat, title: 'Chat' },
];

export default function Navbar() {
	const [page, changePage] = useAtom(pageNameAtom);
	const mode = useAtomValue(overallModeAtom);
	const isStudyMode = mode === OverallMode.study;

	if (isStudyMode) {
		return;
	} else {
		return (
			<nav className={classes.nav}>
				{pageNames.map(({ name: pageName, title: pageTitle }) => (
					<ButtonSecondary
						key={pageName}
						onClick={() => changePage(pageName)}
						className={page === pageName ? classes.activeButton : ''}
						aria-current={page === pageName ? 'page' : undefined}
					>
						{pageTitle}
					</ButtonSecondary>
				))}
			</nav>
		);
	}
}
