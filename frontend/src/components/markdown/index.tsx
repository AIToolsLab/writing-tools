import type { ReactNode } from 'react';
import { Remark, type RemarkProps } from 'react-remark';
import remarkGfm from 'remark-gfm';

import classes from './styles.module.css';
import rehypeTableCellStyle from './tableCellStyle';

/**
 * Tables are the one block that can be wider than the panel it renders in, so
 * each gets its own horizontal scroller instead of widening the whole bubble.
 */
function ScrollableTable(props: { children?: ReactNode }) {
	return (
		<div className={classes.tableWrap}>
			<table {...props} />
		</div>
	);
}

type MarkdownProps = {
	children: string;
	/**
	 * Extra rehype-react options, for callers that swap in their own element
	 * components (Revise replaces `a` with a jump-to-document anchor). Any
	 * `components` given here are merged over the defaults.
	 */
	rehypeReactOptions?: RemarkProps['rehypeReactOptions'];
};

/**
 * Model output rendered as markdown.
 *
 * Two things this adds over a bare `<Remark>`:
 *
 * - **GFM.** `remark-parse` alone is CommonMark, which has no tables, so a
 *   table came through as literal pipe characters. `remark-gfm` adds tables,
 *   strikethrough, task lists, and autolinks. `rehypeTableCellStyle` goes with
 *   it — without that, a table crashes the page in a production build; see the
 *   comment there.
 * - **Element styling.** Tailwind's preflight resets `ul`/`ol` to no marker and
 *   no indent, and headings to plain body text, so markdown structure rendered
 *   as an undifferentiated run of lines. `styles.module.css` restores it. The
 *   rules live in a CSS module (unlayered) rather than a Tailwind layer, so
 *   they win over preflight regardless of specificity.
 */
export default function Markdown({
	children,
	rehypeReactOptions,
}: MarkdownProps) {
	return (
		<div className={classes.markdown}>
			<Remark
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeTableCellStyle]}
				rehypeReactOptions={{
					...rehypeReactOptions,
					components: {
						table: ScrollableTable,
						...rehypeReactOptions?.components,
					},
				}}
			>
				{children}
			</Remark>
		</div>
	);
}
