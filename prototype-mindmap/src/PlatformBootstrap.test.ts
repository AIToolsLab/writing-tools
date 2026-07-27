// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary, browserStorage, initialBootState } from "./PlatformBootstrap";
import { SESSION_STORAGE_KEY } from "./session-persistence";
import {
  PLATFORM_SESSION_STORAGE_KEY,
  type PlatformSession,
} from "./platform-session";

function Boom(): ReactNode {
  throw new Error("render exploded");
}

describe("AppErrorBoundary", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // React logs the caught error itself; silence it so a passing run stays readable.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders children untouched when nothing throws", () => {
    act(() => root.render(createElement(AppErrorBoundary, undefined, createElement("p", undefined, "alive"))));
    expect(container.textContent).toContain("alive");
  });

  it("shows a recoverable fallback instead of a blank page when a child throws", () => {
    act(() => root.render(createElement(AppErrorBoundary, undefined, createElement(Boom))));
    expect(container.textContent).toContain("Mindmap hit an unexpected error");
    expect(container.querySelector("button")?.textContent).toBe("Reload");
  });

  it("leaves the saved mindmap intact — a render crash must not destroy the user's work", () => {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ version: 7, draftText: "my work" }));
    act(() => root.render(createElement(AppErrorBoundary, undefined, createElement(Boom))));
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toContain("my work");
  });

  it("guards access to the storage property itself", () => {
    const getter = vi
      .spyOn(window, "sessionStorage", "get")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
    expect(browserStorage()).toBeNull();
    getter.mockRestore();
  });

  it("treats a blocked storage operation as unavailable", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
    expect(browserStorage()).toBeNull();
    getItem.mockRestore();
  });

  it("routes an expired stored token to relaunch guidance without clearing saved work", () => {
    const session: PlatformSession = {
      version: 1,
      accessToken: "wtk_expired",
      expiresAt: Date.now() - 1,
      scopes: ["openai:chat"],
      doc: null,
      capturedAt: Date.now() - 1000,
    };
    window.sessionStorage.setItem(
      PLATFORM_SESSION_STORAGE_KEY,
      JSON.stringify(session),
    );
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ version: 7, draftText: "keep me" }),
    );
    expect(initialBootState()).toEqual({
      kind: "blocked",
      reason: "token_expired",
    });
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toContain("keep me");
  });
});
