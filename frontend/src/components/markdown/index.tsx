import type { ComponentProps } from 'react';
import ReactMarkdown, {
	defaultUrlTransform,
	type Components,
	type UrlTransform,
} from 'react-markdown';
import remarkGfm from 'remark-gfm';

import classes from './styles.module.css';

/**
 * Re-exported so pages configure markdown through this component rather than
 * reaching past it — React Markdown stays a dependency of this module alone,
 * which is what kept swapping the renderer underneath to four call sites.
 */
export { defaultUrlTransform };
export type { Components, UrlTransform };

/**
 * Tables are the one block that can be wider than the panel it renders in, so
 * each gets its own horizontal scroller instead of widening the whole bubble.
 */
function ScrollableTable(props: ComponentProps<'table'>) {
	return (
		<div className={classes.tableWrap}>
			<table {...props} />
		</div>
	);
}

const defaultComponents: Components = {
	table: ScrollableTable,
};

type MarkdownProps = {
	children: string;
	/**
	 * Element components, merged over the defaults — Revise renders `a` as a
	 * jump-to-document anchor.
	 *
	 * Pass components defined at module scope, not inline. React re-mounts a
	 * subtree whose component *identity* changed, so an inline component is a
	 * new one on every render and throws away whatever it had rendered.
	 */
	components?: Components;
	/**
	 * Override how link and image URLs are rewritten. The default drops any
	 * scheme outside a safe list, which is what keeps a `javascript:` URL in
	 * model output from becoming a live link — so replace it only to allow a
	 * scheme of our own, and defer to `defaultUrlTransform` for the rest.
	 */
	urlTransform?: UrlTransform;
};

/**
 * Model output rendered as markdown.
 *
 * Two things this adds over a bare `<ReactMarkdown>`:
 *
 * - **GFM.** `remark-parse` alone is CommonMark, which has no tables, so a
 *   table came through as literal pipe characters. `remark-gfm` adds tables,
 *   strikethrough, task lists, and autolinks.
 * - **Element styling.** Tailwind's preflight resets `ul`/`ol` to no marker and
 *   no indent, and headings to plain body text, so markdown structure rendered
 *   as an undifferentiated run of lines. `styles.module.css` restores it. The
 *   rules live in a CSS module (unlayered) rather than a Tailwind layer, so
 *   they win over preflight regardless of specificity.
 */
export default function Markdown({
	children,
	components,
	urlTransform,
}: MarkdownProps) {
	return (
		<div className={classes.markdown}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{ ...defaultComponents, ...components }}
				urlTransform={urlTransform}
			>
				{children}
			</ReactMarkdown>
		</div>
	);
}
