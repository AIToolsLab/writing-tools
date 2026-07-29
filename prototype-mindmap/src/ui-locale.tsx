import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { translatedLanguages, uiString } from "./ui-strings";

export const UI_LOCALE_STORAGE_KEY = "prototype-mindmap-ui-locale-v1";

const RTL_LOCALES = new Set(["ar", "fa", "he", "ur"]);
const AVAILABLE_LOCALES = ["en", ...translatedLanguages()] as const;

export interface UiLocaleOption {
  code: string;
  label: string;
  nativeLabel: string;
}

export interface UiLocaleValue {
  locale: string;
  setLocale: (locale: string) => void;
  options: UiLocaleOption[];
  t: (source: string) => string;
}

/** Interpolate translated UI templates without replacement-string semantics.
 * Filenames containing `$&`, `$'`, backticks, or braces remain literal. */
export function interpolateUi(
  template: string,
  replacements: Record<string, string>,
): string {
  return Object.entries(replacements).reduce(
    (result, [name, value]) => result.split(`{${name}}`).join(value),
    template,
  );
}

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

function primaryLocale(locale: string | null | undefined): string {
  return (locale || "en").toLowerCase().split("-")[0];
}

export function isSupportedUiLocale(locale: string): boolean {
  return AVAILABLE_LOCALES.includes(primaryLocale(locale) as (typeof AVAILABLE_LOCALES)[number]);
}

export function normalizeUiLocale(locale: string | null | undefined): string {
  const primary = primaryLocale(locale);
  return isSupportedUiLocale(primary) ? primary : "en";
}

export function defaultUiLocale(browserLocale?: string): string {
  const detected = browserLocale
    ?? (typeof navigator !== "undefined" ? navigator.language : "en");
  return normalizeUiLocale(detected);
}

export function restoreUiLocale(
  storage: StorageReader | undefined,
  browserLocale?: string,
): string {
  if (!storage) return defaultUiLocale(browserLocale);
  try {
    const stored = storage.getItem(UI_LOCALE_STORAGE_KEY);
    return stored && isSupportedUiLocale(stored)
      ? normalizeUiLocale(stored)
      : defaultUiLocale(browserLocale);
  } catch {
    return defaultUiLocale(browserLocale);
  }
}

export function persistUiLocale(storage: StorageWriter | undefined, locale: string): void {
  if (!storage) return;
  try {
    storage.setItem(UI_LOCALE_STORAGE_KEY, normalizeUiLocale(locale));
  } catch {
    // A blocked or full preference store must not prevent locale changes.
  }
}

export function uiDirection(locale: string): "ltr" | "rtl" {
  return RTL_LOCALES.has(primaryLocale(locale)) ? "rtl" : "ltr";
}

export function applyDocumentLocale(
  root: Pick<HTMLElement, "lang" | "dir">,
  locale: string,
): void {
  root.lang = normalizeUiLocale(locale);
  root.dir = uiDirection(locale);
}

function displayName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function uiLocaleOptions(locale: string): UiLocaleOption[] {
  return AVAILABLE_LOCALES.map((code) => ({
    code,
    label: displayName(code, locale),
    nativeLabel: displayName(code, code),
  })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

const DEFAULT_VALUE: UiLocaleValue = {
  locale: "en",
  setLocale: () => undefined,
  options: uiLocaleOptions("en"),
  t: (source) => source,
};

const UiLocaleContext = createContext<UiLocaleValue>(DEFAULT_VALUE);

export function UiLocaleProvider({
  children,
  initialLocale,
}: {
  children?: ReactNode;
  initialLocale?: string;
}) {
  const [locale, setLocaleState] = useState(() => {
    if (initialLocale) return normalizeUiLocale(initialLocale);
    const storage = typeof window !== "undefined" ? window.localStorage : undefined;
    return restoreUiLocale(storage);
  });

  const setLocale = useCallback((nextLocale: string) => {
    const normalized = normalizeUiLocale(nextLocale);
    setLocaleState(normalized);
    persistUiLocale(typeof window !== "undefined" ? window.localStorage : undefined, normalized);
  }, []);

  const t = useCallback(
    (source: string) => uiString(source, locale) ?? source,
    [locale],
  );

  const options = useMemo(() => uiLocaleOptions(locale), [locale]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    applyDocumentLocale(document.documentElement, locale);
  }, [locale]);

  const value = useMemo<UiLocaleValue>(
    () => ({ locale, setLocale, options, t }),
    [locale, options, setLocale, t],
  );

  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
}

export function useUiLocale(): UiLocaleValue {
  return useContext(UiLocaleContext);
}
