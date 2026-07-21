import { describe, expect, it } from "vitest";
import {
  LANGUAGE_CODES,
  defaultUiLanguage,
  effectiveLanguage,
  initialLanguageState,
  isReadOnlyView,
  languageLabel,
  languageOptions,
  restoreLanguageState,
  selectViewLanguage,
  setWriteLanguage,
  type LanguageState,
} from "./language";

const writingChinese: LanguageState = {
  writeLanguage: "zh",
  viewLanguage: null,
  chosen: true,
};

describe("languageOptions", () => {
  it("returns one option per supported code", () => {
    const options = languageOptions("en");
    expect(options).toHaveLength(LANGUAGE_CODES.length);
    expect(options.map((o) => o.code).sort()).toEqual([...LANGUAGE_CODES].sort());
  });

  it("labels in the requested locale and carries the autonym", () => {
    const chinese = languageOptions("en").find((o) => o.code === "zh");
    expect(chinese?.label).toBe("Chinese");
    expect(chinese?.nativeLabel).toBe("中文");
  });

  it("sorts by label so the picker is scannable", () => {
    const labels = languageOptions("en").map((o) => o.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en")));
  });
});

describe("languageLabel", () => {
  it("names a language in English", () => {
    expect(languageLabel("de")).toBe("German");
  });

  it("falls back to the code it was given", () => {
    expect(languageLabel("not-a-language")).toBe("not-a-language");
  });
});

describe("initialLanguageState", () => {
  it("opens on the writer's own view with only a guess", () => {
    const state = initialLanguageState();
    expect(state.viewLanguage).toBeNull();
    expect(state.chosen).toBe(false);
    expect(state.writeLanguage).toBe(defaultUiLanguage());
  });

  it("is not a translated view, so writing is allowed", () => {
    expect(isReadOnlyView(initialLanguageState())).toBe(false);
  });
});

describe("restoreLanguageState", () => {
  it("takes back a language chosen in an earlier session", () => {
    const state = restoreLanguageState("ja");
    expect(state.writeLanguage).toBe("ja");
    expect(state.chosen).toBe(true);
  });

  it("falls back to a fresh guess when nothing was stored", () => {
    expect(restoreLanguageState(undefined).chosen).toBe(false);
  });
});

describe("setWriteLanguage", () => {
  it("changes what the interface renders in, at any time", () => {
    const state = setWriteLanguage(writingChinese, "de");
    expect(state.writeLanguage).toBe("de");
    expect(state.chosen).toBe(true);
  });

  it("is never locked, so a writer can correct it repeatedly", () => {
    const twice = setWriteLanguage(setWriteLanguage(writingChinese, "de"), "fr");
    expect(twice.writeLanguage).toBe("fr");
  });

  it("leaves the writer's own view when it catches up with the translation", () => {
    // Viewing German and then writing in German is no longer a translation.
    const viewingGerman = selectViewLanguage(writingChinese, "de");
    expect(isReadOnlyView(viewingGerman)).toBe(true);

    const nowWritingGerman = setWriteLanguage(viewingGerman, "de");
    expect(nowWritingGerman.viewLanguage).toBeNull();
    expect(isReadOnlyView(nowWritingGerman)).toBe(false);
  });

  it("keeps an unrelated translation on screen", () => {
    const viewingEnglish = selectViewLanguage(writingChinese, "en");
    const nowWritingGerman = setWriteLanguage(viewingEnglish, "de");
    expect(nowWritingGerman.viewLanguage).toBe("en");
    expect(isReadOnlyView(nowWritingGerman)).toBe(true);
  });
});

describe("selectViewLanguage", () => {
  it("shows a reader's translation over the writer's words", () => {
    const state = selectViewLanguage(writingChinese, "en");
    expect(effectiveLanguage(state)).toBe("en");
    expect(isReadOnlyView(state)).toBe(true);
  });

  it("returns to the writer's own view on null", () => {
    const back = selectViewLanguage(selectViewLanguage(writingChinese, "en"), null);
    expect(back.viewLanguage).toBeNull();
    expect(isReadOnlyView(back)).toBe(false);
  });

  it("treats choosing the write language as returning to it", () => {
    const state = selectViewLanguage(writingChinese, "zh");
    expect(state.viewLanguage).toBeNull();
    expect(isReadOnlyView(state)).toBe(false);
  });

  it("never changes what the writer writes in", () => {
    expect(selectViewLanguage(writingChinese, "en").writeLanguage).toBe("zh");
  });
});

describe("effectiveLanguage", () => {
  it("is the write language until a translation is shown", () => {
    expect(effectiveLanguage(writingChinese)).toBe("zh");
    expect(effectiveLanguage(selectViewLanguage(writingChinese, "fr"))).toBe("fr");
  });
});
