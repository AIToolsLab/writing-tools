import {
	OverallMode,
	overallModeAtom,
	PageName,
	pageNameAtom,
} from '@/contexts/pageContext';

import { useAtom, useAtomValue } from 'jotai';
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
	hint: string;
};

const pageNames: Page[] = [
	{ name: PageName.Draft, title: 'Draft', hint: 'Generate suggestions' },
	{ name: PageName.Revise, title: 'Revise', hint: 'Improve your text' },
	{ name: PageName.Chat, title: 'Chat', hint: 'Ask about your doc' },
];

export default function Navbar() {
	const [page, changePage] = useAtom(pageNameAtom);
	const mode = useAtomValue(overallModeAtom);
	const isStudyMode = mode === OverallMode.study;

	if (isStudyMode) {
		return null;
	} else {
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
}
