import { describe, expect, it } from "vitest";
import {
  LANGUAGE_CODES,
  defaultDraftLanguage,
  effectiveLanguage,
  isReadOnlyView,
  languageLabel,
  languageOptions,
  matchesWritingLanguage,
  selectViewLanguage,
  setDraftLanguage,
  type LanguageState,
} from "./language";

const zhDraft: LanguageState = { draftLanguage: "zh", viewLanguage: null };

describe("languageOptions", () => {
  it("returns one option per supported code", () => {
    const options = languageOptions("en");
    expect(options).toHaveLength(LANGUAGE_CODES.length);
    expect(options.map((o) => o.code).sort()).toEqual([...LANGUAGE_CODES].sort());
  });

  it("labels in the requested locale and carries the autonym", () => {
    const options = languageOptions("en");
    const chinese = options.find((o) => o.code === "zh");
    expect(chinese?.label).toBe("Chinese");
    expect(chinese?.nativeLabel).toBe("中文");
  });

  it("sorts by label so the picker is scannable", () => {
    const labels = languageOptions("en").map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });
});

describe("languageLabel", () => {
  it("falls back to the raw code for an unknown subtag", () => {
    expect(languageLabel("zzz")).toBe("zzz");
  });
});

describe("defaultDraftLanguage", () => {
  it("is always a language the picker offers", () => {
    expect(LANGUAGE_CODES).toContain(defaultDraftLanguage());
  });
});

describe("view language", () => {
  it("starts on the original draft, ready to write", () => {
    expect(effectiveLanguage(zhDraft)).toBe("zh");
    expect(isReadOnlyView(zhDraft)).toBe(false);
  });

  it("treats another language as a read-only projection", () => {
    const viewing = selectViewLanguage(zhDraft, "en");
    expect(effectiveLanguage(viewing)).toBe("en");
    expect(isReadOnlyView(viewing)).toBe(true);
  });

  it("leaves the draft language untouched while translated", () => {
    expect(selectViewLanguage(zhDraft, "en").draftLanguage).toBe("zh");
  });

  it("returns to the draft when the draft language is chosen explicitly", () => {
    const viewing = selectViewLanguage(zhDraft, "zh");
    expect(viewing.viewLanguage).toBeNull();
    expect(isReadOnlyView(viewing)).toBe(false);
  });

  it("returns to the draft on null, which is what 'back to writing' uses", () => {
    const back = selectViewLanguage(selectViewLanguage(zhDraft, "en"), null);
    expect(back.viewLanguage).toBeNull();
    expect(isReadOnlyView(back)).toBe(false);
  });
});

describe("matchesWritingLanguage", () => {
  it("accepts text in the expected script", () => {
    expect(matchesWritingLanguage("我没有什么想法", "zh")).toBe(true);
    expect(matchesWritingLanguage("hello there", "en")).toBe(true);
    expect(matchesWritingLanguage("привет друзья", "ru")).toBe(true);
  });

  it("rejects Latin text while writing in a non-Latin language", () => {
    // The mistake worth blocking: writing language says Chinese, input is English.
    expect(matchesWritingLanguage("I have no idea", "zh")).toBe(false);
    expect(matchesWritingLanguage("hello", "ko")).toBe(false);
  });

  it("rejects clearly non-Latin text while writing in a Latin language", () => {
    expect(matchesWritingLanguage("我没有什么想法", "en")).toBe(false);
  });

  it("accepts any Latin text for a Latin-script language", () => {
    // Script cannot separate English from French, so valid input is never
    // rejected on a guess.
    expect(matchesWritingLanguage("bonjour tout le monde", "en")).toBe(true);
  });

  it("accepts mixed text that still contains the expected script", () => {
    // Quoting a foreign term must not block the whole message.
    expect(matchesWritingLanguage("我觉得 AI 应该这样做", "zh")).toBe(true);
    expect(matchesWritingLanguage("the term is 中文 here", "en")).toBe(true);
  });

  it("accepts empty input so the guard never blocks an empty send", () => {
    expect(matchesWritingLanguage("   ", "zh")).toBe(true);
  });
});

describe("setDraftLanguage", () => {
  it("can be changed at any time", () => {
    expect(setDraftLanguage(zhDraft, "ja").draftLanguage).toBe("ja");
  });

  it("stays correctable after the session has content", () => {
    // The initial value is only guessed from the browser locale. Locking a
    // wrong guess would strand a writer whose browser language is not the
    // language they write in.
    const afterWriting: LanguageState = { draftLanguage: "zh", viewLanguage: null };
    expect(setDraftLanguage(afterWriting, "en").draftLanguage).toBe("en");
  });

  it("clears a view that has become the draft language", () => {
    const viewing = selectViewLanguage(zhDraft, "en");
    const next = setDraftLanguage(viewing, "en");
    expect(next.draftLanguage).toBe("en");
    expect(isReadOnlyView(next)).toBe(false);
  });
});
