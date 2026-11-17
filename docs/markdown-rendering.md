# Rendering model output as markdown

Every page that shows model output — Chat, Revise, Draft — renders it through
`frontend/src/components/markdown`. Use that component rather than React
Markdown directly: it carries the GFM plugin, the element styles Tailwind
strips, and the table wrapper, and it is the only module in the app that
imports `react-markdown`, which is what kept swapping the renderer underneath
down to four call sites.

## What it does

```tsx
import Markdown from '@/components/markdown';

<Markdown>{reply}</Markdown>;
```

Callers that need their own element components pass them through:

```tsx
<Markdown components={docTextComponents} urlTransform={allowDocTextUrls}>
	{viz.response}
</Markdown>
```

Anything in `components` is merged over the defaults, so a caller can replace
the built-in `table` wrapper if it ever needs to. **Define those components at
module scope**, not inline — React re-mounts a subtree whose component identity
changed, so an inline component is a new one on every render and throws away
what it had rendered.

## GFM is not optional

`remark-parse` on its own is CommonMark, which has no table syntax — a table in
a reply reached the writer as literal pipe characters. `remark-gfm` adds
tables, strikethrough, task lists and autolinks.

## URL schemes are filtered

React Markdown runs every link and image URL through `defaultUrlTransform`,
which blanks out any scheme outside a safe list (http, https, mailto and a few
others). That is what stops a `javascript:` URL in model output from becoming a
live link, so leave it on.

Replies cite the writer's own text with a `doctext:` URL, which the default
drops — the links would render but do nothing when clicked. `components/
docTextLink/` passes a `urlTransform` that allows that one scheme and defers to
`defaultUrlTransform` for everything else. Copy that shape if another scheme of
our own is ever needed; don't replace the transform wholesale.

That module is also where the rest of the citation behaviour lives — the jump
itself, the pending spinner, the not-found note, and the screen-reader status —
so Revise and Chat render them identically. A page wires it up with
`useDocJump(page)`, `<DocTextMarkdown jump={…}>` in place of `<Markdown>`, and
one `<DocJumpStatus>`; it also has to tell the model how to write the links,
since nothing will emit them otherwise.

## Tailwind's preflight eats list formatting

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

## Why not react-remark

The app used `react-remark` until this was written. Don't go back, and don't
"simplify" the pinned versions here toward it.

`react-remark@2.1.0` is the last release, and it is built on unified 9 /
remark-parse 9. That has two consequences:

- **`remark-gfm` can't be upgraded past v1 alongside it.** gfm is not
  self-contained — it injects a micromark extension into whatever tokenizer
  `remark-parse` provides. Current gfm ships an extension written against
  micromark 3/4, and remark-parse 9 bundles micromark 2, so the first table
  throws `TypeError: Cannot read properties of undefined` mid-parse. npm gives
  no warning: gfm doesn't depend on remark-parse, so nothing looks wrong in
  `npm ls`. Worse, `react-remark` funnels pipeline errors into an `onError`
  option that defaults to a no-op, so the visible symptom was an **empty
  message bubble**.
- **Tables crashed production builds.** `rehype-react@6` runs trees through
  `@mapbox/hast-util-table-cell-style`, which rewrites cell `align` into a
  `style` *string* (and, because it only skips `undefined`, writes a literal
  `text-align: null;` for the `align: null` that `mdast-util-to-hast` puts on
  every cell of an unaligned table). `hast-to-hyperscript` is supposed to parse
  that string into an object for React — but it detects React by looking for
  `_owner`/`_store` on a probe element, and React 19 dropped both from its
  **production** element shape. So in production the string survived and React
  threw error #62, dropping the whole page into its error boundary.
  Development builds rendered fine.

React Markdown is on unified 11, takes current `remark-gfm`, and hands React a
real style object, so both problems and the workaround plugin they needed are
gone.

**Test production builds.** `npm test` runs against React's development build
and would not have caught the second bug. The Playwright suite runs against
`dist/`, so `tests/chat-revise-flows.spec.ts` is what covers it: it asserts a
real `<table>` in the transcript, and that a `doctext:` citation survives the
URL filter and still selects its text on click.
