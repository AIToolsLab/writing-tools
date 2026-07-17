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
