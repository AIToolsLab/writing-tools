# Word add-in manifests

Each deploy target needs its own manifest. The task pane loads whatever origin
`SourceLocation` names, and Office won't render a different origin inside the
pane unless the manifest declares it in `AppDomains` — so unlike the Google Docs
sidebar, which picks its source at runtime (`google-docs-addon/sidebar.html`),
Word decides at install time.

Two files:

- **`template.xml`** — the structure, once. Placeholders: `{{APP_ID}}`,
  `{{APP_NAME}}`, `{{BASE_URL}}`.
- **`environments.ts`** — the table of what differs, once.

`vite build` renders one manifest per environment into `frontend/dist/`:

| Environment | File | Origin | `DisplayName` |
| --- | --- | --- | --- |
| prod | `manifest.xml` | `app.thoughtful-ai.com` | Thoughtful |
| staging | `manifest-staging.xml` | `staging.thoughtful-ai.com` | Beta Thoughtful |
| dev | `manifest-dev.xml` | `localhost:3000` | Dev Thoughtful |

Every build emits all three, deliberately: which manifest you need depends on who
is installing it, not on the flags that produced the build. (This is also a bug
fix. The manifest used to be rendered according to the build's `--mode`, so the
image the Dockerfile builds carried a manifest naming the prod origin no matter
which environment it was deployed to.)

Manifests are sideloaded or uploaded to an add-in store, never fetched from a
running server, so nothing serves them and the dev server doesn't render them.

## Installing one

Word (web): Insert → Add-ins → Upload My Add-in → the file from `dist/`. Word
keys installs by `<Id>` and each environment has its own, so prod, staging and
dev can be installed side by side.

## Adding or changing an environment

Edit `environments.ts`. Two constraints `environments.test.ts` enforces, both
learned the hard way:

- **Ids must be distinct.** Two manifests sharing an id are one add-in to Word:
  they can't coexist, and installing one replaces the other.
- **The distinguishing word goes first in `name`.** The Add-ins menu truncates
  `DisplayName` to about ten characters, so "Thoughtful-dev" and "Thoughtful"
  both show up as "Thoughtful" — which is what made a dev install
  indistinguishable from a real one. The task pane header shows the full string,
  so the menu is the only place this bites.

Never hardcode an origin in `template.xml`; build it from `{{BASE_URL}}`. The
test fails the build if a rendered manifest mentions any origin other than its
own (plus Microsoft's `go.microsoft.com` "learn more" link).

## Validating

`office-addin-manifest` validates against a Microsoft web service, so these need
network access:

```bash
npm run build
npm run validate          # dev
npm run validate:staging  # staging, with AppSource's stricter rules
npm run validate:prod     # prod, likewise
```

## Known issue

`Commands.Url` points at `{{BASE_URL}}/commands/commands.html`, but the build
emits `commands.html` at the root of `dist/`, so the `FunctionFile` 404s. This
predates the template (it was the same in the checked-in manifest) and is
untouched here rather than folded silently into a refactor.
