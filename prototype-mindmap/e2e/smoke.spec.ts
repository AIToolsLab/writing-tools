import { expect, test } from "@playwright/test";

function envelope(response: unknown) {
  return { choices: [{ message: { content: JSON.stringify(response) } }] };
}

test("fresh conversation follows up without restating the resolved question", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  let calls = 0;
  await page.route("**/openai/chat/completions", async (route) => {
    calls += 1;
    const response = calls === 1
      ? { response: { kind: "question", text: "What is one main idea in the draft?", stance: "deepen" } }
      : { response: { kind: "question", text: "What makes language matter to that idea?", stance: "deepen" } };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope(response)) });
  });

  await page.goto("/");
  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("I want to think through the big ideas in my draft");
  await composer.press("Enter");
  await expect(page.getByText("What is one main idea in the draft?")).toBeVisible();
  await composer.fill("The power of language");
  await composer.press("Enter");
  await expect(page.getByText("What makes language matter to that idea?")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a chat-derived card remains off the map until confirm", async ({ page }) => {
  await page.route("**/openai/chat/completions", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope({ response: { kind: "map_proposal", text: "Review this map change.", action: { kind: "create_card", text: "human control", sourceUtteranceIds: ["u_1"] } } })) });
  });
  await page.goto("/");
  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("human control");
  await composer.press("Enter");
  await expect(page.getByText("Review this map change", { exact: true })).toBeVisible();
  await expect(page.getByText("No cards yet")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("textarea.map-card-editor")).toHaveValue("human control");
});

test("a launcher grant hydrates a labelled snapshot and authenticates the provider call", async ({ page }) => {
  await page.route("**/handoff/exchange", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ grant_id: "grant-local" });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "wtk_local",
        expires_in: 3600,
        client_id: "mindmap",
        scopes: ["openai:chat", "doc:read"],
        doc: {
          documentLabel: "Launcher Essay.docx",
          beforeCursor: "First ",
          selectedText: "selected",
          afterCursor: " paragraph.",
        },
      }),
    });
  });
  await page.route("**/openai/chat/completions", async (route) => {
    expect(route.request().headers().authorization).toBe("Bearer wtk_local");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(envelope({
        response: { kind: "question", text: "What matters in this snapshot?", stance: "deepen" },
      })),
    });
  });

  await page.goto("/#wt_grant=grant-local");
  await expect(page.getByText(/Snapshot of Launcher Essay\.docx captured at launch/)).toBeVisible();
  await expect(page.locator(".draft-editor")).toContainText("First selected paragraph.");
  await expect.poll(() => new URL(page.url()).hash).toBe("");

  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("Help me think about this.");
  await composer.press("Enter");
  await expect(page.getByText("What matters in this snapshot?")).toBeVisible();
});

test("reader-language switching keeps populated cards mounted throughout translation", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  let translationRequests = 0;
  let releaseFirstTranslation: (() => void) | undefined;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.route("**/openai/chat/completions", async (route) => {
    const body = route.request().postDataJSON() as { messages?: Array<{ content?: string }> };
    const system = body.messages?.[0]?.content ?? "";
    if (!system.startsWith("Translate the supplied display text")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope({ response: { kind: "question", text: "unused", stance: "deepen" } })) });
      return;
    }
    translationRequests += 1;
    // Hold only the first request. Delaying every queued UI/card translation
    // leaves route handlers alive during Playwright's page teardown.
    if (translationRequests === 1) {
      await new Promise<void>((resolve) => {
        releaseFirstTranslation = resolve;
      });
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(envelope({ translation: `ZH:${body.messages?.[1]?.content ?? ""}` })) });
  });

  await page.goto("/");
  const addCard = page.getByRole("button", { name: "+ New card" });
  const cards = page.locator("textarea.map-card-editor");
  await addCard.click();
  await expect(cards).toHaveCount(1);
  await cards.nth(0).fill("first authored card");
  await cards.nth(0).blur();
  await addCard.click();
  await expect(cards).toHaveCount(2);
  await cards.nth(1).fill("second authored card");
  await cards.nth(1).blur();
  const originalValues = await cards.evaluateAll((elements) => elements.map((element) => (element as HTMLTextAreaElement).value));
  const nodeIds = await page.locator(".react-flow__node").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-id")));
  expect(originalValues).toEqual(["first authored card", "second authored card"]);
  expect(nodeIds).toHaveLength(2);

  await page.getByLabel("Reader language").selectOption("zh");
  await expect.poll(() => translationRequests).toBeGreaterThan(0);
  await expect(cards).toHaveCount(2);
  expect(await page.locator(".react-flow__node").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-id")))).toEqual(nodeIds);
  releaseFirstTranslation?.();
  await expect(cards).toHaveCount(2);
  expect(await page.locator(".react-flow__node").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-id")))).toEqual(nodeIds);
  await expect(cards.nth(0)).toHaveValue("ZH:first authored card");
  await expect(cards).toHaveCount(2);
  expect(await page.locator(".react-flow__node").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-id")))).toEqual(nodeIds);

  await page.getByLabel("Reader language").selectOption("");
  await expect(cards).toHaveCount(2);
  expect(await page.locator(".react-flow__node").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-id")))).toEqual(nodeIds);
  await expect(cards.nth(0)).toHaveValue(originalValues[0]!);
  await expect(cards.nth(1)).toHaveValue(originalValues[1]!);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
