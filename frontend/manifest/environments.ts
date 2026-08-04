/**
 * The one place the Word add-in's environments differ.
 *
 * Word has no equivalent of the Google Docs sidebar's runtime source picker: the
 * task pane loads whatever origin `SourceLocation` names, so each deploy target
 * needs its own manifest. That used to be produced by rewriting a checked-in dev
 * manifest with regexes at build time (`.replace(/-dev/g, '')` and friends),
 * which had two problems worth remembering, since they're what this file exists
 * to prevent:
 *
 *  1. It could only express two environments. A third has no spelling in a
 *     transform whose whole vocabulary is "strip the `-dev` suffix".
 *  2. It only rewrote strings someone remembered to write in the `-dev` form.
 *     `CommandsGroup.Label` was plain "Thoughtful", so the ribbon group looked
 *     identical in dev and prod — drift that nothing detected, in the exact file
 *     whose purpose is to tell the environments apart.
 *
 * Now `manifest/template.xml` holds the structure once, this table holds the
 * differences once, and `environments.test.ts` asserts a rendered manifest can
 * never mention another environment's origin.
 */

export type ManifestEnvName = 'dev' | 'staging' | 'prod';

export interface ManifestEnv {
	/**
	 * Office keys an installed add-in by this GUID: two manifests sharing one id
	 * are the same add-in as far as Word is concerned, so they can't be installed
	 * side by side and an update to one replaces the other. Every environment
	 * therefore needs its own.
	 */
	id: string;
	/**
	 * Origin serving `taskpane.html`, with no trailing slash. Every URL in the
	 * rendered manifest is built from this.
	 */
	baseUrl: string;
	/**
	 * `DisplayName`, and the base for every user-visible string derived from it.
	 *
	 * The distinguishing word goes FIRST. Word's Add-ins menu truncates this to
	 * roughly ten characters, so a trailing marker is invisible exactly where you
	 * need it — "Thoughtful-dev" and "Thoughtful" both render as "Thoughtful"
	 * there, which is what made a dev install indistinguishable from a real one.
	 * The task pane header shows the full string, so only the menu is affected.
	 */
	name: string;
	/** Filename emitted into `dist/`. */
	fileName: string;
}

export const MANIFEST_ENVS: Record<ManifestEnvName, ManifestEnv> = {
	dev: {
		id: '46d2493d-60db-4522-b2aa-e6f2c08d2507',
		baseUrl: 'https://localhost:3000',
		name: 'Dev Thoughtful',
		fileName: 'manifest-dev.xml',
	},
	staging: {
		id: '46d2493d-60db-4522-b2aa-e6f2c08d2509',
		baseUrl: 'https://staging.thoughtful-ai.com',
		name: 'Beta Thoughtful',
		fileName: 'manifest-staging.xml',
	},
	prod: {
		id: '46d2493d-60db-4522-b2aa-e6f2c08d2508',
		baseUrl: 'https://app.thoughtful-ai.com',
		// Keeps the bare filename: this is the manifest already submitted to
		// AppSource and handed out for sideloading, so it stays where it was.
		name: 'Thoughtful',
		fileName: 'manifest.xml',
	},
};

export const MANIFEST_ENV_NAMES = Object.keys(MANIFEST_ENVS) as ManifestEnvName[];

/** Path of the template, relative to the frontend root. */
export const TEMPLATE_RELATIVE_PATH = 'manifest/template.xml';

const SUBSTITUTIONS: Record<string, keyof ManifestEnv> = {
	APP_ID: 'id',
	APP_NAME: 'name',
	BASE_URL: 'baseUrl',
};

/** Comments addressed to whoever edits the template, dropped when rendering. */
const TEMPLATE_DOC_COMMENT = /<!--\s*TEMPLATE-DOC[\s\S]*?-->\n?/g;

/** Replaces it, so a rendered manifest says where to make changes instead. */
function banner(env: ManifestEnv): string {
	return `<!-- Generated from ${TEMPLATE_RELATIVE_PATH} for the "${env.name}" (${env.baseUrl}) environment. Do not edit; see frontend/manifest/. -->`;
}

/**
 * Substitutes `{{PLACEHOLDER}}` tokens for one environment's values, and swaps
 * the template's authoring notes for a generated-file banner.
 *
 * Throws on an unknown placeholder rather than leaving it in place: a manifest
 * containing a literal `{{TYPO}}` is one Office rejects at install time, and a
 * build failure is a much cheaper way to find that out.
 */
export function renderManifest(template: string, env: ManifestEnv): string {
	// The XML declaration has to stay on the first line, so splice the banner in
	// after it rather than prepending.
	const withBanner = template
		.replace(TEMPLATE_DOC_COMMENT, '')
		.replace(/^(<\?xml[^?]*\?>\n)/, `$1${banner(env)}\n`);

	return withBanner.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => {
		const field = SUBSTITUTIONS[token];
		if (!field) {
			throw new Error(
				`Unknown placeholder {{${token}}} in ${TEMPLATE_RELATIVE_PATH}. ` +
					`Known placeholders: ${Object.keys(SUBSTITUTIONS)
						.map((name) => `{{${name}}}`)
						.join(', ')}.`,
			);
		}
		return env[field];
	});
}
