/**
 * Generate the interface dictionaries once, offline.
 *
 * Static i18n means one JSON file per language — that is what makes it free and
 * instant at runtime. Writing them by hand would be absurd, so this translates
 * `src/i18n/source.json` (the canonical English interface copy) into every
 * supported language in one pass and writes `src/i18n/<code>.json`.
 *
 * Run it when interface copy changes, not when the app runs:
 *
 *   npm run i18n              # fill in languages that have no file yet
 *   npm run i18n -- --force   # redo every language
 *   npm run i18n -- zh ko     # only these languages
 *
 * The backend proxy must be running (it holds the API key), the same one the
 * app talks to. Set BACKEND_URL to point somewhere else.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const i18nDir = join(here, "..", "src", "i18n");
const languageFile = join(here, "..", "src", "language.ts");

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000/api";
const MODEL = process.env.VITE_MINDMAP_MODEL ?? "gpt-5.6-terra";
/** Small enough that a long reply is never truncated mid-array. */
const BATCH_SIZE = 25;

/** Read the supported languages from the app itself, so the two cannot drift. */
function supportedLanguages() {
  const source = readFileSync(languageFile, "utf8");
  const block = /export const LANGUAGE_CODES = \[([\s\S]*?)\] as const;/.exec(source);
  if (!block) throw new Error("Could not find LANGUAGE_CODES in src/language.ts");
  return [...block[1].matchAll(/"([\w-]+)"/g)].map((match) => match[1]).filter((code) => code !== "en");
}

function languageName(code) {
  return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
}

async function translateBatch(items, code) {
  const system = [
    `You are translating the interface copy of a writing app into ${languageName(code)}.`,
    "These are buttons, labels, and short hints. Keep them short — interface copy must fit its control.",
    "Preserve leading symbols such as '+' and any capitalisation convention.",
    "Leave the button name \"Out\" in English — other strings quote it by name.",
    `Reply with JSON: {"translations": [...]} containing exactly ${items.length} strings, in the input order.`,
  ].join(" ");

  const response = await fetch(`${BACKEND_URL}/openai/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ items }) },
      ],
      stream: false,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) {
    throw new Error(`Backend ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const body = await response.json();
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty model response");
  const { translations } = JSON.parse(content);
  if (!Array.isArray(translations) || translations.length !== items.length) {
    // A short array would attribute one label's text to another control.
    throw new Error(`Expected ${items.length} translations, got ${translations?.length}`);
  }
  return translations.map(String);
}

async function generate(code, sources) {
  const entries = {};
  for (let start = 0; start < sources.length; start += BATCH_SIZE) {
    const items = sources.slice(start, start + BATCH_SIZE);
    const translations = await translateBatch(items, code);
    items.forEach((item, index) => {
      entries[item] = translations[index];
    });
  }
  writeFileSync(join(i18nDir, `${code}.json`), `${JSON.stringify(entries, null, 2)}\n`);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((arg) => !arg.startsWith("--"));

const sources = JSON.parse(readFileSync(join(i18nDir, "source.json"), "utf8"));
const languages = (only.length > 0 ? only : supportedLanguages()).filter(
  (code) => force || !existsSync(join(i18nDir, `${code}.json`)),
);

if (languages.length === 0) {
  console.log("Every language already has a dictionary. Use --force to redo them.");
  process.exit(0);
}

console.log(`Translating ${sources.length} interface strings into ${languages.length} languages…`);
let failed = 0;
for (const code of languages) {
  try {
    await generate(code, sources);
    console.log(`  ✓ ${code}.json (${languageName(code)})`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${code} — ${error.message}`);
  }
}
console.log(failed === 0 ? "Done." : `Done, with ${failed} failed. Re-run to retry just those.`);
process.exit(failed === 0 ? 0 : 1);
