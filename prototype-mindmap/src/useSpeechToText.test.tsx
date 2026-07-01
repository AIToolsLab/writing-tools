// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSpeechToText, type SpeechToTextState } from "./useSpeechToText";

interface MockSpeechChunk {
  transcript: string;
  isFinal: boolean;
}

class MockSpeechRecognition {
  static latest: MockSpeechRecognition | null = null;

  continuous = false;
  interimResults = false;
  onresult:
    | ((event: Event & {
        resultIndex: number;
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
      }) => void)
    | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  start() {
    MockSpeechRecognition.latest = this;
  }

  stop() {
    this.onend?.();
  }

  emitResult(chunks: MockSpeechChunk[]) {
    const results = chunks.map((chunk) => ({
      0: { transcript: chunk.transcript },
      isFinal: chunk.isFinal,
    }));
    this.onresult?.({
      resultIndex: 0,
      results,
    } as unknown as Event & {
      resultIndex: number;
      results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
    });
  }

  emitError() {
    this.onerror?.();
  }
}

function Harness({ onChange }: { onChange: (state: SpeechToTextState) => void }) {
  onChange(useSpeechToText());
  return null;
}

describe("useSpeechToText", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latestState: SpeechToTextState;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    MockSpeechRecognition.latest = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    delete (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition;
    delete (window as Window & { webkitSpeechRecognition?: typeof MockSpeechRecognition }).webkitSpeechRecognition;
  });

  function renderHarness() {
    act(() => {
      root.render(
        <Harness
          onChange={(state) => {
            latestState = state;
          }}
        />,
      );
    });
  }

  it("reports unsupported when no browser speech API exists", () => {
    renderHarness();

    expect(latestState.supported).toBe(false);
    expect(latestState.listening).toBe(false);
  });

  it("detects browser speech support and splits final from interim transcript", () => {
    (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition;

    renderHarness();

    expect(latestState.supported).toBe(true);

    act(() => {
      latestState.start("Existing thought");
    });

    expect(latestState.listening).toBe(true);
    expect(latestState.transcript).toBe("Existing thought");

    act(() => {
      MockSpeechRecognition.latest?.emitResult([
        { transcript: "new final idea", isFinal: true },
        { transcript: "more to come", isFinal: false },
      ]);
    });

    expect(latestState.transcript).toBe("Existing thought new final idea");
    expect(latestState.interim).toBe("more to come");
  });

  it("reset clears transcript state", () => {
    (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition;

    renderHarness();

    act(() => {
      latestState.start("Seed text");
    });

    act(() => {
      MockSpeechRecognition.latest?.emitResult([{ transcript: "confirmed words", isFinal: true }]);
    });

    act(() => {
      latestState.reset();
    });

    expect(latestState.transcript).toBe("");
    expect(latestState.interim).toBe("");
  });

  it("clears listening state on stop and error", () => {
    (window as Window & { SpeechRecognition?: typeof MockSpeechRecognition }).SpeechRecognition =
      MockSpeechRecognition;

    renderHarness();

    act(() => {
      latestState.start();
    });

    expect(latestState.listening).toBe(true);

    act(() => {
      latestState.stop();
    });

    expect(latestState.listening).toBe(false);

    act(() => {
      latestState.start();
    });

    expect(latestState.listening).toBe(true);

    act(() => {
      MockSpeechRecognition.latest?.emitError();
    });

    expect(latestState.listening).toBe(false);
  });
});
