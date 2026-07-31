import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	MANIFEST_ENV_NAMES,
	MANIFEST_ENVS,
	renderManifest,
	type ManifestEnv,
} from './environments';

// `import.meta.url` rather than `__dirname`: Vitest processes this file as ESM,
// where `__dirname` doesn't exist. (vite.config.ts is the mirror image — Vite
// bundles it as CJS, so it uses `__dirname` and can't use `import.meta`. That's
// why environments.ts stays pure and each caller reads the template itself.)
const template = readFileSync(
	fileURLToPath(new URL('./template.xml', import.meta.url)),
	'utf-8',
);

const rendered = Object.fromEntries(
	MANIFEST_ENV_NAMES.map((name) => [name, renderManifest(template, MANIFEST_ENVS[name])]),
) as Record<string, string>;

describe('manifest environments', () => {
	it('gives every environment a distinct add-in id', () => {
		// Office keys installs by id, so a duplicate would silently make two
		// environments the same add-in — uninstallable side by side.
		const ids = MANIFEST_ENV_NAMES.map((name) => MANIFEST_ENVS[name].id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('gives every environment a distinct origin and filename', () => {
		const origins = MANIFEST_ENV_NAMES.map((name) => MANIFEST_ENVS[name].baseUrl);
		const files = MANIFEST_ENV_NAMES.map((name) => MANIFEST_ENVS[name].fileName);
		expect(new Set(origins).size).toBe(origins.length);
		expect(new Set(files).size).toBe(files.length);
	});

	it('distinguishes environments within the first 10 characters of the name', () => {
		// Word's Add-ins menu truncates DisplayName to about this much, which is
		// why the marker leads rather than trails. If two environments become
		// indistinguishable there, a developer can't tell which add-in they're
		// opening — the bug that prompted all of this.
		const prefixes = MANIFEST_ENV_NAMES.map((name) =>
			MANIFEST_ENVS[name].name.slice(0, 10),
		);
		expect(new Set(prefixes).size).toBe(prefixes.length);
	});

	it('never lets a baseUrl end in a slash', () => {
		// The template appends "/taskpane.html" and friends directly.
		for (const name of MANIFEST_ENV_NAMES) {
			expect(MANIFEST_ENVS[name].baseUrl.endsWith('/')).toBe(false);
		}
	});

	it('throws on an unknown placeholder rather than emitting it', () => {
		expect(() => renderManifest('<Id>{{NOPE}}</Id>', MANIFEST_ENVS.prod)).toThrow(
			/\{\{NOPE\}\}/,
		);
	});
});

describe.each(MANIFEST_ENV_NAMES)('rendered %s manifest', (envName) => {
	const env: ManifestEnv = MANIFEST_ENVS[envName];
	const xml = rendered[envName];

	it('substitutes every placeholder', () => {
		expect(xml).not.toMatch(/\{\{/);
	});

	it('carries its own id, name and origin', () => {
		expect(xml).toContain(`<Id>${env.id}</Id>`);
		expect(xml).toContain(`<DisplayName DefaultValue="${env.name}" />`);
		expect(xml).toContain(`<SourceLocation DefaultValue="${env.baseUrl}/taskpane.html" />`);
	});

	it('mentions no other environment', () => {
		// The guard the old regex transform couldn't provide: it rewrote the
		// origins it knew about, so a URL hardcoded into the manifest later would
		// have shipped one environment's host inside another's manifest, silently.
		for (const otherName of MANIFEST_ENV_NAMES) {
			if (otherName === envName) continue;
			const other = MANIFEST_ENVS[otherName];
			expect(xml).not.toContain(other.baseUrl);
			expect(xml).not.toContain(other.id);
		}
	});

	it('points every add-in URL at its own origin', () => {
		// Catches a hardcoded origin the check above would miss because it belongs
		// to no environment at all (a typo'd host, a leftover ngrok tunnel).
		const urls = [...xml.matchAll(/DefaultValue="(https?:\/\/[^"]+)"/g)].map(
			(match) => match[1],
		);
		const foreign = urls.filter(
			(url) =>
				!url.startsWith(env.baseUrl) &&
				// The only legitimate third-party URL: Office's own "learn more" link.
				!url.startsWith('https://go.microsoft.com/'),
		);
		expect(foreign).toEqual([]);
		// Guards the regex above against silently matching nothing.
		expect(urls.length).toBeGreaterThan(5);
	});
});
