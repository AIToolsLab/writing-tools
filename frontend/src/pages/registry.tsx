/**
 * The page registry — the single source of truth for which pages exist, how they
 * are labelled, where they appear in the navbar, and how they render.
 *
 * Adding a page used to mean editing three places: the `PageName` enum, the
 * navbar's `pageNames` array, and a `switch` in `pages/app`. Every in-flight
 * feature branch touched all three, so every branch conflicted with every other
 * one in exactly those files. Now a page is one enum member plus one entry here.
 *
 * ## Tiers
 *
 * - `core` — a primary destination, rendered inline in the tab strip.
 * - `lab`  — in progress. Reachable from the Labs (···) menu instead of the strip.
 *
 * The tier split exists for space, and the binding constraint is the Google Docs
 * sidebar: the platform locks it to ~300px with no splitter to drag, which leaves
 * roughly 57px of text per tab once the fixed-width Labs button is subtracted (see
 * `components/navbar/styles.module.css`). Three text tabs is what fits. Because
 * every lab page shares the single Labs button, the strip's width stops being a
 * function of how many experiments are in flight — that, not tidiness, is the
 * point. Promote a page by changing one word; do not add a fourth core tab
 * without re-checking it against 300px.
 *
 * ## Visibility
 *
 * `enabled` is optional and defaults to always-on. Give a lab page one when it
 * should stay out of even the Labs menu — see `flags.ts`, and note the caveat
 * there about which surfaces the URL override actually reaches.
 */
import type React from 'react';
import { PageName } from '@/contexts/pageContext';
import Chat from './chat';
import Debug from './debug';
import Draft from './draft';
import { isFlagEnabled } from './flags';
import MyWords from './my-words';
import Revise from './revise';
import Tools from './tools';

export type PageTier = 'core' | 'lab';

export type PageDef = {
	/** Stable identifier; also what `pageNameAtom` stores. */
	name: PageName;
	/** Tab label. Keep it short — see the 300px budget above. */
	title: string;
	/**
	 * One-line description. Shown under the title on wide task panes, as the
	 * button's tooltip when the strip is too narrow for it, and always as the
	 * second line of a Labs menu entry (the dropdown has room the strip doesn't).
	 */
	hint: string;
	tier: PageTier;
	/** Defaults to always-visible. Return false to withhold the page entirely. */
	enabled?: () => boolean;
	render: () => React.JSX.Element;
};

/**
 * Registration order is display order, within each tier.
 *
 * `render` is a thunk rather than a component reference so an entry can pass
 * props later without every consumer learning about them.
 */
export const PAGES: PageDef[] = [
	{
		name: PageName.Draft,
		title: 'Draft',
		hint: 'Generate suggestions',
		tier: 'core',
		render: () => <Draft />,
	},
	{
		name: PageName.Revise,
		title: 'Revise',
		hint: 'Improve your text',
		tier: 'core',
		render: () => <Revise />,
	},
	{
		name: PageName.Chat,
		title: 'Chat',
		hint: 'Ask about your doc',
		tier: 'core',
		render: () => <Chat />,
	},
	{
		name: PageName.Tools,
		title: 'Tools',
		hint: 'Launch writing tools',
		tier: 'lab',
		render: () => <Tools />,
	},
	{
		name: PageName.MyWords,
		title: 'My Words',
		hint: 'Shape your own words',
		tier: 'lab',
		// Kept out of even the Labs menu: the voice tab opens a realtime session
		// that spends a model key, and its per-session cost is not yet metered to
		// `llm_usage` the way proxied generations are. Off until it is.
		enabled: () => isFlagEnabled('my-words'),
		render: () => <MyWords />,
	},
	{
		name: PageName.Debug,
		title: 'Debug',
		hint: 'See what the model sees',
		tier: 'lab',
		// Deliberately not behind a flag, unlike My Words. A flag is set from the
		// URL, and the two surfaces whose document handling this page exists to
		// check — the Word task pane and the Google Docs sidebar — have no
		// addressable URL (see flags.ts). Gating it would leave it reachable only
		// where it is least needed. The Labs menu is the cross-surface way in.
		render: () => <Debug />,
	},
];

/** The page shown when nothing is selected, or when the selection isn't visible. */
export const DEFAULT_PAGE = PageName.Draft;

/**
 * The maximum core tabs the narrowest surface can hold.
 *
 * Measured, not chosen. The Google Docs sidebar is locked at ~300px, where three
 * tabs beside the fixed-width Labs button get 57.3px of text each and the widest
 * label ("Revise", 39.8px) fits comfortably. A fourth drops that to 37.0px —
 * under the label — and because a one-word label has no break opportunity it
 * doesn't wrap, it overflows its button. `registry.test.ts` asserts this bound,
 * so adding a core page fails the suite instead of the sidebar.
 *
 * The figure assumes the Labs button is present, which it is whenever any lab
 * page exists. Four tabs would fit without it (46.0px), but the strip is not
 * worth making conditional on that.
 */
export const MAX_CORE_PAGES = 3;

/**
 * `pages` is a seam for tests — production callers pass nothing and get the real
 * registry. It exists because the interesting logic is the filtering and the
 * fallback, and exercising those otherwise means mutating a module-level const.
 */

/** Every page whose `enabled` predicate passes, in registration order. */
export function visiblePages(pages: PageDef[] = PAGES): PageDef[] {
	return pages.filter((page) => page.enabled?.() ?? true);
}

/** Visible pages in one tier — what the navbar renders from. */
export function pagesByTier(
	tier: PageTier,
	pages: PageDef[] = PAGES,
): PageDef[] {
	return visiblePages(pages).filter((page) => page.tier === tier);
}

/**
 * The page to actually render for a stored selection.
 *
 * Falls back to DEFAULT_PAGE when the selection isn't visible, which is what
 * happens if a user is sitting on a lab page and its flag is then turned off:
 * the stored atom still names a page that should no longer be reachable. Callers
 * use this for both rendering and active-tab highlighting so the two can't
 * disagree. Returns undefined only if the registry has no visible pages at all.
 */
export function resolvePage(
	name: PageName,
	pages: PageDef[] = PAGES,
): PageDef | undefined {
	const visible = visiblePages(pages);
	return (
		visible.find((page) => page.name === name) ??
		visible.find((page) => page.name === DEFAULT_PAGE) ??
		visible[0]
	);
}
