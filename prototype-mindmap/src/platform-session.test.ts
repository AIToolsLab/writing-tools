import { describe, expect, it, vi } from "vitest";
import {
  GrantExchangeError,
  PLATFORM_SESSION_STORAGE_KEY,
  clearPlatformSession,
  exchangeGrant,
  grantFromHash,
  hashWithoutGrant,
  launchRequired,
  readPlatformSession,
  snapshotText,
  writePlatformSession,
  type PlatformSession,
} from "./platform-session";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("platform launcher session", () => {
  it("extracts and scrubs a grant without dropping other fragment values", () => {
    expect(grantFromHash("#view=map&wt_grant=a%20b&lang=en")).toBe("a b");
    expect(hashWithoutGrant("#view=map&wt_grant=a%20b&lang=en")).toBe("#view=map&lang=en");
  });

  it("exchanges with omitted credentials and accepts a nullable document", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({
      access_token: "wtk_token",
      expires_in: 3600,
      client_id: "mindmap",
      scopes: ["openai:chat", "doc:read"],
      doc: null,
    }));
    const session = await exchangeGrant("wtg_grant", {
      fetcher,
      backendUrl: "https://app.example/api",
      now: () => 1000,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://app.example/api/handoff/exchange",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        body: JSON.stringify({ grant_id: "wtg_grant" }),
      }),
    );
    expect(session).toMatchObject({ accessToken: "wtk_token", expiresAt: 3_601_000, doc: null });
  });

  it("requires AI scope but treats document scope as optional and ignores an ungranted document", async () => {
    const session = await exchangeGrant("wtg_grant", {
      fetcher: vi.fn().mockResolvedValue(response({
        access_token: "wtk_token",
        expires_in: 60,
        client_id: "mindmap",
        scopes: ["openai:chat"],
        doc: { beforeCursor: "private", selectedText: "", afterCursor: "" },
      })),
      now: () => 0,
    });
    expect(session.doc).toBeNull();

    await expect(exchangeGrant("wtg_grant", {
      fetcher: vi.fn().mockResolvedValue(response({
        access_token: "wtk_token",
        expires_in: 60,
        client_id: "mindmap",
        scopes: ["doc:read"],
        doc: null,
      })),
    })).rejects.toMatchObject({ code: "invalid" });
  });

  it("validates and concatenates a granted document while dropping contextData", async () => {
    const session = await exchangeGrant("wtg_grant", {
      fetcher: vi.fn().mockResolvedValue(response({
        access_token: "wtk_token",
        expires_in: 60,
        client_id: "mindmap",
        scopes: ["openai:chat", "doc:read"],
        doc: {
          documentLabel: "Essay.docx",
          beforeCursor: "before ",
          selectedText: "selected",
          afterCursor: " after",
          contextData: [{ title: "private", content: "ignored" }],
        },
      })),
      now: () => 0,
    });
    expect(snapshotText(session.doc)).toBe("before selected after");
    expect(session.doc).not.toHaveProperty("contextData");
  });

  it("keeps an expired-by-browser-clock token as a server-authoritative expiry hint", () => {
    const storage = memoryStorage();
    const session: PlatformSession = {
      version: 1,
      accessToken: "wtk_token",
      expiresAt: 1,
      scopes: ["openai:chat"],
      doc: null,
      capturedAt: 0,
    };
    writePlatformSession(storage, session);
    expect(readPlatformSession(storage)).toEqual(session);
    clearPlatformSession(storage);
    expect(storage.getItem(PLATFORM_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("maps expired and already-used grants to distinct errors", async () => {
    for (const code of ["expired", "already_used"] as const) {
      try {
        await exchangeGrant("wtg_grant", {
          fetcher: vi.fn().mockResolvedValue(response({ detail: "No.", error: code }, 400)),
        });
        throw new Error("expected exchange to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(GrantExchangeError);
        expect((error as GrantExchangeError).code).toBe(code);
      }
    }
  });

  it("defaults launch enforcement by build mode and honors explicit overrides", () => {
    expect(launchRequired({ PROD: true })).toBe(true);
    expect(launchRequired({ PROD: false })).toBe(false);
    expect(launchRequired({ PROD: true, VITE_REQUIRE_LAUNCH: "false" })).toBe(false);
    expect(launchRequired({ PROD: false, VITE_REQUIRE_LAUNCH: "true" })).toBe(true);
  });
});
