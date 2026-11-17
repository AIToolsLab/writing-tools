import type React from 'react';
import { describe, expect, it } from 'vitest';
import { PageName } from '@/contexts/pageContext';
import {
	DEFAULT_PAGE,
	MAX_CORE_PAGES,
	type PageDef,
	PAGES,
	pagesByTier,
	resolvePage,
	visiblePages,
} from '../registry';

/**
 * Stand-in pages for the filtering/fallback tests, so they don't depend on which
 * real features happen to be in flight. `render` is never called here — these
 * tests are about selection, not rendering.
 */
function page(
	name: PageName,
	tier: PageDef['tier'],
	enabled?: () => boolean,
): PageDef {
	return {
		name,
		title: name,
		hint: `${name} hint`,
		tier,
		enabled,
		render: () => null as unknown as React.JSX.Element,
	};
}

describe('page registry', () => {
	describe('the shipped registry', () => {
		it('fits the core tabs in the 300px Google Docs sidebar', () => {
			// The sidebar is locked by the platform — this is the one navbar
			// constraint that can't be fixed by resizing, so it's asserted rather
			// than left as a comment. If this fails, the new page belongs in the
			// Labs menu (tier: 'lab'), not the strip.
			expect(pagesByTier('core').length).toBeLessThanOrEqual(
				MAX_CORE_PAGES,
			);
		});

		it('can render whatever the default selection resolves to', () => {
			expect(resolvePage(DEFAULT_PAGE)).toBeDefined();
		});

		it('gives every page a unique name', () => {
			const names = PAGES.map((entry) => entry.name);

			expect(new Set(names).size).toBe(names.length);
		});

		it('gives every page a title and a hint', () => {
			for (const entry of PAGES) {
				expect(entry.title.length).toBeGreaterThan(0);
				expect(entry.hint.length).toBeGreaterThan(0);
			}
		});

		it('offers Tools from the Labs menu with no flag to set first', () => {
			// Asserted through the selectors a writer's navbar actually goes
			// through, not against the registry literal: Tools ships reachable
			// — open the Labs (···) menu and it is there — while staying out of
			// the three-tab strip. Adding a predicate that defaults off, or
			// promoting Tools to `core`, are both rollout decisions rather than
			// refactors, so they should fail here and be made deliberately.
			expect(pagesByTier('lab').map((entry) => entry.name)).toContain(
				PageName.Tools,
			);
			expect(pagesByTier('core').map((entry) => entry.name)).not.toContain(
				PageName.Tools,
			);
		});
	});

	describe('visibility', () => {
		it('treats a page with no predicate as always visible', () => {
			const pages = [page(PageName.Draft, 'core')];

			expect(visiblePages(pages)).toHaveLength(1);
		});

		it('withholds a page whose predicate is false', () => {
			const pages = [
				page(PageName.Draft, 'core'),
				page(PageName.TagLinker, 'lab', () => false),
			];

			expect(visiblePages(pages).map((entry) => entry.name)).toEqual([
				PageName.Draft,
			]);
		});
	});

	describe('tiers', () => {
		const pages = [
			page(PageName.Draft, 'core'),
			page(PageName.Revise, 'core'),
			page(PageName.TagLinker, 'lab'),
			page(PageName.Chat, 'lab', () => false),
		];

		it('keeps lab pages out of the inline strip', () => {
			expect(
				pagesByTier('core', pages).map((entry) => entry.name),
			).toEqual([PageName.Draft, PageName.Revise]);
		});

		it('lists only enabled lab pages in the Labs menu', () => {
			expect(
				pagesByTier('lab', pages).map((entry) => entry.name),
			).toEqual([PageName.TagLinker]);
		});

		it('preserves registration order within a tier', () => {
			const reversed = [
				page(PageName.Revise, 'core'),
				page(PageName.Draft, 'core'),
			];

			expect(
				pagesByTier('core', reversed).map((entry) => entry.name),
			).toEqual([PageName.Revise, PageName.Draft]);
		});
	});

	describe('resolvePage', () => {
		it('returns the selected page when it is visible', () => {
			const pages = [
				page(PageName.Draft, 'core'),
				page(PageName.Revise, 'core'),
			];

			expect(resolvePage(PageName.Revise, pages)?.name).toBe(
				PageName.Revise,
			);
		});

		it('falls back to the default when the selection was flagged off', () => {
			// A user sitting on a lab page when its flag is turned off: the stored
			// atom still names a page that should no longer be reachable.
			const pages = [
				page(DEFAULT_PAGE, 'core'),
				page(PageName.TagLinker, 'lab', () => false),
			];

			expect(resolvePage(PageName.TagLinker, pages)?.name).toBe(
				DEFAULT_PAGE,
			);
		});

		it('falls back to the first visible page when even the default is gone', () => {
			const pages = [page(PageName.Chat, 'core')];

			expect(resolvePage(PageName.TagLinker, pages)?.name).toBe(
				PageName.Chat,
			);
		});

		it('returns undefined when nothing is visible', () => {
			expect(resolvePage(PageName.Draft, [])).toBeUndefined();
		});
	});
});
