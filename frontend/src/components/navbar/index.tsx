import {
	AiOutlineAudit,
	AiOutlineEdit,
	AiOutlineMessage,
} from 'react-icons/ai';
import type { IconType } from 'react-icons';

import { PageName, pageNameAtom } from '@/contexts/pageContext';

import { useAtom } from 'jotai';
import classes from './styles.module.css';

type Page = {
	name: PageName;
	title: string;
	hint: string;
	icon: IconType;
};

const pageNames: Page[] = [
	{
		name: PageName.Draft,
		title: 'Draft',
		hint: 'Generate suggestions',
		icon: AiOutlineEdit,
	},
	{
		name: PageName.Revise,
		title: 'Revise',
		hint: 'Improve your text',
		icon: AiOutlineAudit,
	},
	{
		name: PageName.Chat,
		title: 'Chat',
		hint: 'Ask about your doc',
		icon: AiOutlineMessage,
	},
];

export default function Navbar() {
	const [page, changePage] = useAtom(pageNameAtom);

	return (
		<header className={classes.header}>
			<div className={classes.brandRow}>
				<span className={classes.brandMark} aria-hidden="true">
					✳
				</span>
				<span className={classes.wordmark}>Thoughtful</span>
				<span className={classes.brandTagline}>
					AI that helps you think
				</span>
			</div>

			<nav className={classes.tabs} aria-label="Tool pages">
				{pageNames.map(({ name, title, hint, icon: Icon }) => (
					<button
						key={name}
						type="button"
						title={hint}
						onClick={() => changePage(name)}
						className={`${classes.tabBtn} ${page === name ? classes.active : ''}`}
						aria-current={page === name ? 'page' : undefined}
					>
						<Icon className={classes.tabIcon} aria-hidden="true" />
						{title}
					</button>
				))}
			</nav>
		</header>
	);
}
