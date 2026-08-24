# Rendering model output as markdown

Every page that shows model output — Chat, Revise, Draft — renders it through
`frontend/src/components/markdown`. Use that component, not `<Remark>`
directly. Two separate bugs made a bare `<Remark>` render markdown wrong, and
both fixes live behind it.

## What it does

```tsx
import Markdown from '@/components/markdown';

<Markdown>{reply}</Markdown>;
```

Callers that need their own element components pass them through:

```tsx
<Markdown rehypeReactOptions={{ components: { a: DocTextAnchor } }}>
	{viz.response}
</Markdown>
```

Anything given in `components` is merged over the defaults, so a caller can
replace the built-in `table` wrapper if it ever needs to.

## Bug 1: tables never rendered

`react-remark` runs `remark-parse` with no plugins, which is plain CommonMark —
and CommonMark has no tables. A table in a reply reached the writer as literal
pipe characters. `remark-gfm` adds the GitHub extensions: tables,
strikethrough, task lists, and autolinks.

The version matters. `react-remark@2` is built on unified 9 / remark-parse 9,
so it needs `remark-gfm@1`; remark-gfm 2 and later are ESM-only and expect
unified 10. Upgrading one without the other breaks the build.

## Bug 2: a table crashed the page in production

Adding `remark-gfm` alone traded "no table" for "no page". In a **production
build only**, the first table threw React error #62 — *"The `style` prop
expects a mapping from style properties to values, not a string"* — and the app
dropped into its error boundary. Development builds rendered fine, which is why
this needs writing down.

The chain:

1. `mdast-util-to-hast` puts `align` on every table cell, and sets it to `null`
   for a table with no alignment row.
2. `rehype-react@6` runs the tree through
   `@mapbox/hast-util-table-cell-style`, which rewrites `align` into
   `properties.style` as a CSS **string**. Its check for "no value here" is
   `=== undefined`, so `align: null` becomes the literal `text-align: null;`.
3. `hast-to-hyperscript` is supposed to parse that string back into an object
   when the target is React. It detects React by rendering a probe element and
   looking for `_owner` or `_store` on it — and **React 19 dropped both from
   its production element shape**. So in a production build the detection
   fails, the string survives, and React rejects it.

`components/markdown/tableCellStyle.ts` is a small rehype plugin that converts
those attributes into a React style object (dropping empty values) before
`rehype-react` sees them, which leaves the Mapbox helper with nothing to
rewrite.

The same detection failure also means hast property names come through in their
HTML spelling (`class` rather than `className`) in production. Markdown doesn't
generate any of those attributes today, so nothing depends on it — but a rehype
plugin that starts adding `class` would need checking against a production
build, not just `npm run dev-server`.

**Test production builds.** `npm test` runs against React's development build
and would not have caught this. The Playwright suite runs against `dist/`, so
`tests/chat-revise-flows.spec.ts` covers it: it asserts a real `<table>` in the
transcript.

## Bug 3: Tailwind's preflight ate the list formatting

`@import 'tailwindcss'` (in `src/taskpane.css` and `src/editor/styles.css`)
pulls in preflight, which resets `ul`/`ol` to `list-style: none` with no
padding, and headings to plain body text. Nothing put those back for markdown
we render ourselves, so a bulleted reply arrived as an undifferentiated run of
lines.

`components/markdown/styles.module.css` restores them. It works without
`!important` or a specificity ladder because preflight lives in `@layer base`
and **unlayered CSS always beats layered CSS**, whatever the specificity. A
plain `.markdown ul { list-style-type: disc }` in a CSS module wins.

That is the pattern to reuse for any other element preflight strips. Keep those
rules in this one module rather than re-fixing lists per page — Draft used to
carry its own copy.

## Tables and width

Chat's panel is capped at 500px, and the Google Docs sidebar is narrower still,
so a table is the one block that can be wider than the space it renders in. The
component gives each table its own `overflow-x: auto` wrapper, so a wide table
scrolls on its own rather than widening the bubble or the transcript.
