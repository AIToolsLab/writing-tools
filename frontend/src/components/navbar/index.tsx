import { useAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { pageNameAtom } from '@/contexts/pageContext';
import { type PageDef, pagesByTier, resolvePage } from '@/pages/registry';
import classes from './styles.module.css';

/**
 * The tab strip.
 *
 * Core pages render inline; lab pages live behind the single Labs (···) button so
 * the strip's width never depends on how many are in flight. What pages exist and
 * which tier they're in is decided in `pages/registry.tsx`, not here.
 *
 * Whether a tab shows its hint is a CSS media query, not state — see the
 * breakpoint in styles.module.css. Doing it there rather than with a width hook
 * keeps a resize listener (and a re-render per resize tick) out of the strip, and
 * leaves one definition of the threshold instead of a JS copy drifting from a CSS
 * one. The `title` tooltip carries the hint at every width regardless.
 */
export default function Navbar() {
	const [page, changePage] = useAtom(pageNameAtom);
	const [labsOpen, setLabsOpen] = useState(false);
	const labsRef = useRef<HTMLDivElement>(null);

	const corePages = pagesByTier('core');
	const labPages = pagesByTier('lab');
	// Highlight what's actually rendered: `pages/app` resolves the same way, so a
	// stored selection that is no longer visible can't leave the strip with no
	// active tab while a fallback page is on screen.
	const activePage = resolvePage(page)?.name;

	// Dismiss the menu on an outside click or Escape. Both listeners are only
	// attached while it's open, so the closed strip costs nothing.
	useEffect(() => {
		if (!labsOpen) return;

		function onPointerDown(event: MouseEvent) {
			if (!labsRef.current?.contains(event.target as Node)) setLabsOpen(false);
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') setLabsOpen(false);
		}

		document.addEventListener('mousedown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('mousedown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [labsOpen]);

	function select(pageDef: PageDef) {
		changePage(pageDef.name);
		setLabsOpen(false);
	}

	return (
		<div className={classes.tabs}>
			{corePages.map((pageDef) => (
				<button
					key={pageDef.name}
					type="button"
					// Carries the hint at every width; below the CSS breakpoint the
					// tooltip is the only way to read it.
					title={pageDef.hint}
					onClick={() => select(pageDef)}
					className={`${classes.tabBtn} ${
						activePage === pageDef.name ? classes.active : ''
					}`}
				>
					<span className={classes.tabTitle}>{pageDef.title}</span>
					<span className={classes.tabHint}>{pageDef.hint}</span>
				</button>
			))}

			{labPages.length > 0 ? (
				<div
					ref={labsRef}
					className={classes.labs}
				>
					<button
						type="button"
						title="Experimental pages"
						aria-label="Experimental pages"
						aria-haspopup="menu"
						aria-expanded={labsOpen}
						onClick={() => setLabsOpen((open) => !open)}
						className={`${classes.overflowBtn} ${
							labsOpen ||
							labPages.some((pageDef) => pageDef.name === activePage)
								? classes.active
								: ''
						}`}
					>
						···
					</button>

					{labsOpen ? (
						<ul
							className={classes.labsMenu}
							role="menu"
						>
							{/*
								The menu has the width the strip doesn't, so lab entries
								show their hint inline rather than as a tooltip. The
								heading does the work an "experimental" badge would have
								done on an inline tab — grouping says it once, instead of
								every tab repeating it.
							*/}
							<li
								className={classes.labsHeading}
								role="presentation"
							>
								Experimental
							</li>
							{labPages.map((pageDef) => (
								<li
									key={pageDef.name}
									role="none"
								>
									<button
										type="button"
										role="menuitem"
										onClick={() => select(pageDef)}
										className={`${classes.labsItem} ${
											activePage === pageDef.name
												? classes.labsItemActive
												: ''
										}`}
									>
										{pageDef.title}
										<span className={classes.tabHint}>
											{pageDef.hint}
										</span>
									</button>
								</li>
							))}
						</ul>
					) : null}
				</div>
			) : null}
		</div>
	);
}
