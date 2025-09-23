import {
	OverallMode,
	overallModeAtom,
	PageName,
	pageNameAtom,
} from '@/contexts/pageContext';

import classes from './styles.module.css';
import { useAtom, useAtomValue } from 'jotai';
import { Tabs } from 'reshaped';

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
		return null;
	} else {
		return (
			<nav className={classes.nav}>
				<Tabs value={page} onChange={({ value }: { value: string }) => changePage(value as PageName)}>
					<Tabs.List className={classes.nav}>
						{pageNames.map(({ name: pageName, title: pageTitle }) => (
							<Tabs.Item key={pageName} value={pageName} data-active={page === pageName ? 'true' : undefined}>
								{pageTitle}
							</Tabs.Item>
						))}
					</Tabs.List>
				</Tabs>
			</nav>
		);
	}
}
