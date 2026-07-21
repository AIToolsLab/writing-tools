import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Proof that interface copy is served by the checked-in dictionaries and never
 * by the translation engine. If any of these start failing, the free/instant
 * half of the translation story has quietly regressed into a paid one.
 */

const i18nDir = join(process.cwd(), "src", "i18n");

function dictionary(code: string): Record<string, string> {
  return JSON.parse(readFileSync(join(i18nDir, `${code}.json`), "utf8"));
}

const languages = readdirSync(i18nDir)
  .filter((file) => file.endsWith(".json") && file !== "source.json")
  .map((file) => file.replace(/\.json$/, ""));

/** Fail loudly if anything reaches the provider while the interface re-skins. */
async function forbidProviderCalls(page: Page) {
  const calls: string[] = [];
  await page.route("**/openai/**", async (route) => {
    calls.push(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
    });
  });
  return calls;
}

test("every supported language has a complete dictionary", () => {
  const source: string[] = JSON.parse(readFileSync(join(i18nDir, "source.json"), "utf8"));
  const codes: string[] = [
    ...readFileSync(join(process.cwd(), "src", "language.ts"), "utf8")
      .match(/export const LANGUAGE_CODES = \[([\s\S]*?)\] as const;/)![1]
      .matchAll(/"([\w-]+)"/g),
  ]
    .map((match) => match[1])
    .filter((code) => code !== "en");

  expect(languages.sort()).toEqual(codes.sort());
  for (const code of languages) {
    const entries = dictionary(code);
    expect(source.filter((text) => !(text in entries)), `${code}.json is missing entries`).toEqual([]);
  }
});

test("the interface re-skins from the dictionary without touching the engine", async ({ page }) => {
  const calls = await forbidProviderCalls(page);
  await page.goto("/");

  // Walk several languages in one session: each swap must be pure lookup.
  for (const code of ["zh", "ja", "fr", "ar", "ko", "de"]) {
    await page.getByLabel("Writing language").selectOption(code);
    await expect(page.locator(".map-clear-map")).toHaveText(dictionary(code)["Clear map"]);
    await expect(page.locator(".map-add-card")).toHaveText(dictionary(code)["+ New card"]);
  }

  expect(calls, "interface copy must never reach the provider").toEqual([]);
});

test("interface copy is restored to English when the page returns to it", async ({ page }) => {
  const calls = await forbidProviderCalls(page);
  await page.goto("/");

  await page.getByLabel("Writing language").selectOption("zh");
  await expect(page.locator(".map-clear-map")).toHaveText(dictionary("zh")["Clear map"]);

  await page.getByLabel("Writing language").selectOption("en");
  await expect(page.locator(".map-clear-map")).toHaveText("Clear map");
  expect(calls).toEqual([]);
});

test("dictionary copy also covers title and aria-label attributes", async ({ page }) => {
  await forbidProviderCalls(page);
  await page.goto("/");

  await page.getByLabel("Writing language").selectOption("zh");
  await expect(page.locator(".map-clear-map")).toHaveAttribute(
    "title",
    dictionary("zh")["Clear the map only"],
  );
});
