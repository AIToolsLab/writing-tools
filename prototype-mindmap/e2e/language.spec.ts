import { expect, test, type Page } from "@playwright/test";

/**
 * Write language = what the interface renders in, and the one language content
 * is stored in. View language = a read-only translation for someone else to
 * read. Interface copy is static i18n (free); only writer content reaches the
 * engine, and only while a translated view is on screen.
 */

/** Stub the provider and count what actually reaches it. */
async function stubProvider(page: Page) {
  const requests: string[] = [];
  await page.route("**/openai/chat/completions", async (route) => {
    const body = route.request().postDataJSON() as { messages: Array<{ content: string }> };
    const isTranslation = body.messages[0].content.includes("professional translator");
    requests.push(isTranslation ? `translate:${body.messages[1].content}` : "coach");
    const content = isTranslation
      ? JSON.stringify({ translation: `«${body.messages[1].content}»` })
      : JSON.stringify({
        response: { kind: "question", text: "What matters most there?", stance: "deepen" },
      });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    });
  });
  return requests;
}

test("input is accepted in any language, whatever the writing language is", async ({ page }) => {
  await stubProvider(page);
  await page.goto("/");

  await expect(page.getByLabel("Writing language")).toHaveValue("en");
  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("我正在尝试为我的设计撰写一份用户研究问题");
  await composer.press("Enter");

  await expect(page.getByText("What matters most there?")).toBeVisible();
  // The writing language is a display setting, so typing must not move it.
  await expect(page.getByLabel("Writing language")).toHaveValue("en");
});

test("a translated view is read-only, so nothing can be written into it", async ({ page }) => {
  await stubProvider(page);
  await page.goto("/");

  const composer = page.locator("textarea.composer-textarea");
  await expect(composer).toBeEnabled();

  await page.getByLabel("Translation language").selectOption("de");

  await expect(composer).toBeDisabled();
  await expect(page.locator(".read-only-note")).toBeVisible();

  // Every content mutation is gated by that one boolean.
  for (const selector of [".map-add-card", ".map-clear-draft", ".map-clear-map", ".map-clean", ".clear-chat-btn"]) {
    await expect(page.locator(selector)).toBeDisabled();
  }
  // Switching back is the one control that must stay usable.
  await expect(page.getByLabel("Translation language")).toBeEnabled();
});

test("the write language locks on first content and unlocks when it is cleared", async ({ page }) => {
  await stubProvider(page);
  await page.goto("/");

  const writeLanguage = page.getByLabel("Writing language");
  await expect(writeLanguage).toBeEnabled();

  // A chat message is content, so it fixes the language the document is stored in.
  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("the power of language");
  await composer.press("Enter");
  await expect(page.getByText("What matters most there?")).toBeVisible();
  await expect(writeLanguage).toBeDisabled();

  // Clearing the content is the only way back, and it needs no extra bookkeeping.
  await page.locator(".clear-chat-btn").click();
  await expect(writeLanguage).toBeEnabled();
});

test("only the writer's own content reaches the engine, and only in a translated view", async ({ page }) => {
  const requests = await stubProvider(page);
  await page.goto("/");

  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("the power of language");
  await composer.press("Enter");
  await expect(page.getByText("What matters most there?")).toBeVisible();

  requests.length = 0;
  await page.getByLabel("Translation language").selectOption("de");

  // The writer's sentence is translated; interface copy never is.
  await expect(page.getByText("«the power of language»")).toBeVisible();
  expect(requests.every((request) => request.startsWith("translate:"))).toBe(true);
  expect(requests.some((request) => request.includes("Clear map"))).toBe(false);
});
