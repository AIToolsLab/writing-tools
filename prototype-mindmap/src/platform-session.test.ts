import { describe, expect, it, vi } from "vitest";
import {
  GrantExchangeError,
  OAUTH_REQUEST_STORAGE_KEY,
  PLATFORM_SESSION_STORAGE_KEY,
  clearPlatformSession,
  exchangeGrant,
  finishRoomAuthorization,
  grantFromHash,
  hashWithoutGrant,
  launchRequired,
  readPlatformSession,
  resolveOAuthClientId,
  scrubOAuthFromUrl,
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

  it("ignores malformed fragment encoding instead of throwing during boot", () => {
    expect(() => grantFromHash("#%")).not.toThrow();
    expect(grantFromHash("#%")).toBeNull();
    expect(hashWithoutGrant("#%&view=map")).toBe("#%&view=map");
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

  it("accepts a missing document field as an empty optional snapshot", async () => {
    const session = await exchangeGrant("wtg_grant", {
      fetcher: vi.fn().mockResolvedValue(response({
        access_token: "wtk_token",
        expires_in: 60,
        client_id: "mindmap",
        scopes: ["openai:chat", "doc:read"],
      })),
    });
    expect(session.doc).toBeNull();
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

  it("accepts only legacy wtk tokens or compact JWTs from storage", () => {
    const storage = memoryStorage();
    const base = {
      version: 1,
      expiresAt: 1000,
      scopes: ["openai:chat"],
      doc: null,
      capturedAt: 0,
    };
    storage.setItem(PLATFORM_SESSION_STORAGE_KEY, JSON.stringify({
      ...base,
      accessToken: "header.payload.signature",
    }));
    expect(readPlatformSession(storage)?.accessToken).toBe("header.payload.signature");
    storage.setItem(PLATFORM_SESSION_STORAGE_KEY, JSON.stringify({
      ...base,
      accessToken: "this-is-not-a-token-even-if-long",
    }));
    expect(readPlatformSession(storage)).toBeNull();
  });

  it("rejects an OAuth token bound to a room other than the launched room", async () => {
    const storage = memoryStorage();
    storage.setItem(OAUTH_REQUEST_STORAGE_KEY, JSON.stringify({
      state: "room_requested.random",
      verifier: "verifier",
      roomId: "room_requested",
      clientId: "client",
      redirectUri: "https://mindmap.example/",
    }));
    const fetcher = vi.fn().mockResolvedValue(response({
      access_token: "header.payload.signature",
      room_id: "room_other",
      expires_in: 3600,
    }));
    await expect(finishRoomAuthorization(
      "?code=code&state=room_requested.random",
      storage,
      { backendUrl: "https://writer.example/api", fetcher },
    )).rejects.toMatchObject({ code: "invalid" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("shows a state-bound OAuth error and consumes the saved PKCE request", async () => {
    const storage = memoryStorage();
    storage.setItem(OAUTH_REQUEST_STORAGE_KEY, JSON.stringify({
      state: "room_requested.random",
      verifier: "verifier",
      roomId: "room_requested",
      clientId: "client",
      redirectUri: "https://mindmap.example/",
    }));

    await expect(finishRoomAuthorization(
      "?error=access_denied&error_description=That+room+is+unavailable.&state=room_requested.random",
      storage,
    )).rejects.toMatchObject({ code: "invalid", message: "That room is unavailable." });
    expect(storage.getItem(OAUTH_REQUEST_STORAGE_KEY)).toBeNull();
  });

  it("rejects an OAuth error with mismatched state without consuming the saved request", async () => {
    const storage = memoryStorage();
    const request = JSON.stringify({
      state: "room_requested.random",
      verifier: "verifier",
      roomId: "room_requested",
      clientId: "client",
      redirectUri: "https://mindmap.example/",
    });
    storage.setItem(OAUTH_REQUEST_STORAGE_KEY, request);

    await expect(finishRoomAuthorization(
      "?error=access_denied&error_description=Injected&state=wrong-state",
      storage,
    )).rejects.toMatchObject({
      code: "invalid",
      message: "The OAuth callback did not match this Mindmap launch.",
    });
    expect(storage.getItem(OAUTH_REQUEST_STORAGE_KEY)).toBe(request);
  });

  it("loads only the exact launched room after a successful OAuth exchange", async () => {
    const storage = memoryStorage();
    storage.setItem(OAUTH_REQUEST_STORAGE_KEY, JSON.stringify({
      state: "room_requested.random",
      verifier: "verifier",
      roomId: "room_requested",
      clientId: "client",
      redirectUri: "https://mindmap.example/",
    }));
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({
        access_token: "header.payload.signature",
        room_id: "room_requested",
        expires_in: 60,
        scope: "openai:chat doc:read",
      }))
      .mockResolvedValueOnce(response({
        doc: { beforeCursor: "draft", selectedText: "", afterCursor: "" },
        updated_at: 42,
      }));
    const session = await finishRoomAuthorization(
      "?code=code&state=room_requested.random",
      storage,
      { backendUrl: "https://writer.example/api", fetcher, now: () => 1 },
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "https://writer.example/api/rooms/room_requested",
      expect.objectContaining({
        credentials: "omit",
        headers: { Authorization: "Bearer header.payload.signature" },
      }),
    );
    expect(session).toMatchObject({ accessToken: "header.payload.signature", capturedAt: 42 });
  });

  it("scrubs OAuth callback parameters without depending on exchange success", () => {
    const replaceState = vi.fn();
    scrubOAuthFromUrl(
      { pathname: "/mindmap" },
      { state: { retained: true }, replaceState } as unknown as History,
    );
    expect(replaceState).toHaveBeenCalledWith({ retained: true }, "", "/mindmap");
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
    expect(launchRequired({ PROD: false, VITE_REQUIRE_LAUNCH: "true" })).toBe(true);
  });

  it("uses the configured fixed OAuth client and fails closed in production", () => {
    expect(resolveOAuthClientId({ VITE_OAUTH_CLIENT_ID: " trusted-mindmap " }))
      .toBe("trusted-mindmap");
    expect(resolveOAuthClientId({ PROD: false })).toBe("writing-tools-mindmap");
    expect(() => resolveOAuthClientId({ PROD: true })).toThrow(/VITE_OAUTH_CLIENT_ID/);
  });

  it("ignores VITE_REQUIRE_LAUNCH=false in production builds", () => {
    // Fail closed: a misconfigured deploy env must not be able to ship an ungated
    // production bundle. The override stays available for dev and Playwright.
    expect(launchRequired({ PROD: true, VITE_REQUIRE_LAUNCH: "false" })).toBe(true);
    expect(launchRequired({ PROD: false, VITE_REQUIRE_LAUNCH: "false" })).toBe(false);
  });
});
