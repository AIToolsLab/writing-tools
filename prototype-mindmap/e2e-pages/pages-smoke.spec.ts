import { expect, test } from "@playwright/test";

const PRODUCTION_API = "https://app.thoughtful-ai.com/api";

function envelope(response: unknown) {
  return { choices: [{ message: { content: JSON.stringify(response) } }] };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

test("the production artifact blocks a direct visit", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedAssets: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().startsWith("http://127.0.0.1:") && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/");

  await expect(page.getByRole("heading", {
    name: "Launch Mindmap from Writing Tools",
  })).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedAssets).toEqual([]);
});

test("the production artifact exchanges a grant and authenticates AI calls", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedAssets: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().startsWith("http://127.0.0.1:") && response.status() >= 400) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.route("**/handoff/exchange", async (route) => {
    expect(route.request().url()).toBe(`${PRODUCTION_API}/handoff/exchange`);
    expect(route.request().postDataJSON()).toEqual({ grant_id: "pages-grant" });
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        access_token: "wtk_pages",
        expires_in: 3600,
        client_id: "mindmap",
        scopes: ["openai:chat", "doc:read"],
        doc: {
          documentLabel: "Pages Essay.docx",
          beforeCursor: "A production ",
          selectedText: "snapshot",
          afterCursor: " for testing.",
        },
      }),
    });
  });
  await page.route("**/openai/chat/completions", async (route) => {
    expect(route.request().url()).toBe(`${PRODUCTION_API}/openai/chat/completions`);
    expect(route.request().headers().authorization).toBe("Bearer wtk_pages");
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(envelope({
        response: {
          kind: "question",
          text: "What matters in this production snapshot?",
          stance: "deepen",
        },
      })),
    });
  });

  await page.goto("/#wt_grant=pages-grant");
  await expect(page.getByText(/Snapshot of Pages Essay\.docx captured at launch/)).toBeVisible();
  await expect(page.locator(".draft-editor")).toContainText(
    "A production snapshot for testing.",
  );
  await expect.poll(() => new URL(page.url()).hash).toBe("");

  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("Help me think about this.");
  await composer.press("Enter");
  await expect(page.getByText("What matters in this production snapshot?")).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(failedAssets).toEqual([]);
});

// Unskip after #579 merges — depends on the wt_api launch schema.
test.skip("a launch uses the issuing platform API instead of the build-time fallback", async ({
  page,
}) => {
  const launchApi = "https://platform.example/api";
  let fallbackRequests = 0;
  page.on("request", (request) => {
    if (request.url().startsWith(`${PRODUCTION_API}/`)) fallbackRequests += 1;
  });
  await page.route("**/handoff/exchange", async (route) => {
    expect(route.request().url()).toBe(`${launchApi}/handoff/exchange`);
    expect(route.request().postDataJSON()).toEqual({ grant_id: "issuing-platform-grant" });
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        access_token: "wtk_issuing_platform",
        expires_in: 3600,
        client_id: "mindmap",
        scopes: ["openai:chat"],
        doc: null,
      }),
    });
  });
  await page.route("**/openai/chat/completions", async (route) => {
    expect(route.request().url()).toBe(`${launchApi}/openai/chat/completions`);
    expect(route.request().headers().authorization).toBe("Bearer wtk_issuing_platform");
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(envelope({
        response: {
          kind: "question",
          text: "This call used the issuing platform.",
          stance: "deepen",
        },
      })),
    });
  });

  const launchHash = new URLSearchParams({
    wt_grant: "issuing-platform-grant",
    wt_api: launchApi,
  });
  await page.goto(`/#${launchHash.toString()}`);
  const composer = page.locator("textarea.composer-textarea");
  await composer.fill("Use the platform that launched this page.");
  await composer.press("Enter");
  await expect(page.getByText("This call used the issuing platform.")).toBeVisible();
  expect(fallbackRequests).toBe(0);
});
