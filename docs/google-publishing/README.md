# Publishing the Google Docs add-on

A checklist for getting Thoughtful onto the Google Workspace Marketplace. It's
written so the console steps don't have to be rediscovered each time. Google renames
console pages often, so if a label below doesn't match, search for the nearby
field names instead.

GCP project: `thoughtful-ai-tools` (number 9212093823). Apps Script project:
`1sRpuT11owQd6taN1-o1iqeKtWYFbLiyo3v2QOF0MNusBgP6ykY12XjXo`, which is standalone
and set to that standard GCP project.

## Decide first: Public or Private

On Marketplace SDK → App Configuration, **visibility can't be changed after you
publish**.

- **Private** lists the add-on only inside one Google Workspace domain and skips
  Google's review. It only works if the GCP project belongs to that domain's
  organization.
- **Public** means Google reviews the add-on, and anyone can install it. While the
  backend allowlist (`backend/src/userAllowlist.ts`) only admits `@calvin.edu`,
  most public installers will reach the "not allowed" screen, and reviewers will
  too unless they get a test account (see below).

## 1. Domain verification (Search Console)

The consent screen only accepts home page, privacy policy, and ToS URLs on an
**authorized domain**, and an authorized domain must be verified.

1. Go to <https://search.google.com/search-console>. Sign in with an account that
   is an **Owner or Editor of the GCP project**.
2. Add property → **Domain** → `thoughtful-ai.com`. A Domain property covers every
   subdomain, including `app.`.
3. Search Console gives you a `google-site-verification=…` TXT record. Add it at the
   DNS host for `thoughtful-ai.com`, wait for it to propagate, then click **Verify**.
4. Google Auth Platform → **Branding** → Authorized domains → add `thoughtful-ai.com`.

## 2. Google Auth Platform (consent screen)

Under **Branding**:

- App name: **Thoughtful**. It should match the listing and the legal pages.
- Logo: 120×120 PNG/JPG, at most 1 MB. Adding a logo triggers **brand
  verification**, which usually takes a few business days. Start this early.
- Home page: `https://app.thoughtful-ai.com/`. It has to be public, describe the
  app, and link to the privacy policy.
- Privacy policy: `https://app.thoughtful-ai.com/privacypolicy.html`
- Terms of service: `https://app.thoughtful-ai.com/termsofservice.html`

Under **Data Access**, list the scopes from `oauthScopes` in
`google-docs-addon/appsscript.json`. All three are non-sensitive, so no
security assessment is needed.

Under **Audience**, click **Publish app** to move from Testing to In production.

The backend's "Sign in with Google" (Better Auth) is a separate OAuth client. If it
lives in this same project, it shares this consent screen and publishing status. If
it lives in another project, that project needs the same treatment, or users outside
its test-user list can't sign in.

## 3. Release the script

See `google-docs-addon/README.md` → *Releasing a new version*. In short:
`clasp push`, then `clasp version "…"`, then enter that number in step 4.

## 4. Marketplace SDK → App Configuration

- App visibility: decide using the section at the top of this doc.
- Installation settings: individual + admin install.
- App integration: **Editor add-on → Docs add-on**, with the script ID and
  **script version** from step 3. Don't choose "Google Workspace add-on": that
  type uses the card UI, and Thoughtful uses an HtmlService sidebar.
- OAuth scopes: exactly the `oauthScopes` from `appsscript.json`.
- Developer name, website, and email.

## 5. Marketplace SDK → Store Listing

Draft text is in `google-docs-addon/store-listing.md`. The listing needs:

| Asset | Size | Have it? |
|---|---|---|
| Application icon | 32×32 and 128×128 PNG | New logo needed (see `logo-concepts/`) |
| Card banner | 220×140 | `frontend/public/assets/c2_220_140.png` (check it's current) |
| Screenshots | 1280×800 (at least one) | Need fresh Google Docs ones |
| Terms of service, privacy policy, support URLs | | `termsofservice.html`, `privacypolicy.html`, `support.html` |

Every feature the listing describes must work in the build being reviewed.
"Jump across tabs" in particular needs checking before it's claimed.

## 6. A test account for reviewers

Reviewers use their own Google accounts, so on the Google Docs surface (which has
no demo mode) they'll be stopped by the allowlist. The lowest-effort option:

1. Create a dedicated Google account for review.
2. Sign in to the add-on with it once, so the user row exists. Expect the "not
   allowed" screen.
3. Grant it access with no deploy:
   `UPDATE "user" SET "alwaysAllow" = 1 WHERE email = '<that address>';`
4. Put the credentials and a short "how to try it" note in the review submission.

Google may challenge a reviewer's sign-in from a new location. Turn off 2-step
verification on that account and expect to answer a challenge or two.

## 7. Submit

Marketplace SDK → **Publish**. Once the add-on is published, a new release only
needs step 3 and the script version change in step 4. Changing scopes or the
listing can trigger another review.
