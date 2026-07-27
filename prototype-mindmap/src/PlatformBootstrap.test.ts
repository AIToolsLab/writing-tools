// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./PlatformBootstrap";
import { SESSION_STORAGE_KEY } from "./session-persistence";

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
});
