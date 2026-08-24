/**
 * A rehype plugin that turns the presentational attributes GFM puts on table
 * cells into a React `style` object, before `rehype-react` gets a chance to
 * turn them into a style *string*.
 *
 * Why this has to exist: `rehype-react@6` runs every tree through
 * `@mapbox/hast-util-table-cell-style`, which rewrites `align` (and friends)
 * on `tr`/`th`/`td` into `properties.style` as a CSS string. Normally its own
 * renderer, `hast-to-hyperscript`, notices the target is React and parses that
 * string back into an object — but it detects React by looking for `_owner` or
 * `_store` on a probe element, and React 19 dropped both from its *production*
 * element shape. So in a production build the detection fails, the string
 * survives, and React throws error #62 ("The `style` prop expects a mapping
 * from style properties to values, not a string") from the first table cell —
 * taking the whole page down to the error boundary. Development builds render
 * fine, which is what makes it worth a comment this long.
 *
 * There is a second bug behind it: `mdast-util-to-hast` sets `align: null` on
 * every cell of an unaligned table, and the Mapbox helper only skips
 * `undefined`, so even a table with no alignment row gets `text-align: null;`.
 * Dropping empty values here fixes that too.
 *
 * Removing the attributes (rather than pre-formatting the string) leaves the
 * Mapbox helper with nothing to do, so it never re-introduces one.
 */

/** The `align`-style attributes, mapped to the CSS property each stands for. */
const CELL_STYLE_ATTRIBUTES: Record<string, string> = {
	align: 'textAlign',
	valign: 'verticalAlign',
	height: 'height',
	width: 'width',
};

const CELL_TAGS = new Set(['tr', 'th', 'td']);

type HastNode = {
	type: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
};

function convert(node: HastNode): void {
	for (const child of node.children ?? []) convert(child);

	if (
		node.type !== 'element' ||
		!node.tagName ||
		!CELL_TAGS.has(node.tagName)
	)
		return;
	const properties = node.properties;
	if (!properties) return;

	const style: Record<string, string | number> = {};
	for (const [attribute, cssProperty] of Object.entries(
		CELL_STYLE_ATTRIBUTES,
	)) {
		const value = properties[attribute];
		delete properties[attribute];
		// `align: null` is what an unaligned column looks like — not a value.
		if (value === null || value === undefined || value === '') continue;
		style[cssProperty] = value as string | number;
	}

	if (Object.keys(style).length > 0) properties.style = style;
}

export default function rehypeTableCellStyle() {
	return (tree: HastNode) => {
		convert(tree);
	};
}
