/// <reference types="vite/client" />

/**
 * What we already know how to say, so the model is asked once per string ever —
 * rather than once per render, per toggle, and per language switch.
 *
 * Three layers sit in front of the provider:
 *   1. a checked-in dictionary of interface copy, fixed before release,
 *   2. everything this browser has already had translated,
 *   3. the model, for genuine misses only.
 *
 * Interface copy is a finite set that is known at build time, so layer 1 answers
 * it for free and offline. The writer's own words only come into existence at
 * runtime and can never be enumerated in advance, which is why the model cannot
 * be removed outright — but each string still only reaches it once. See
 * ./language.ts for why a translation is never authoritative in the first place.
 */

/**
 * Checked-in interface dictionaries, one JSON file per language, mapping the
 * English source string to its translation. Loaded per language on demand so a
 * session only pays for the language it is actually showing.
 *
 * Generate them with `exportTranslationMemory` — see ./i18n/README.md.
 */
const DICTIONARIES = import.meta.glob<Record<string, string>>("./i18n/*.json", {
  import: "default",
});

const STORAGE_KEY = "mindmap.translation-memory.v1";

/**
 * Per-language cap on remembered strings. Interface copy is a few hundred
 * entries and a session's writing is a few hundred more, so this holds many
 * sessions while staying well inside a localStorage quota.
 */
const MAX_REMEMBERED_PER_LANGUAGE = 4000;

/** Writes are coalesced: one page can land a dozen batches in a burst. */
const PERSIST_DELAY_MS = 500;

const dictionaries = new Map<string, Record<string, string>>();
const pendingLoads = new Map<string, Promise<void>>();

/** target -> source -> translation, in insertion order (oldest first). */
const remembered = new Map<string, Map<string, string>>();

let restored = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    // Access itself throws when storage is disabled by policy.
    return undefined;
  }
}

function restore(): void {
  if (restored) return;
  restored = true;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>;
    for (const [target, entries] of Object.entries(parsed)) {
      if (entries && typeof entries === "object") {
        remembered.set(target, new Map(Object.entries(entries)));
      }
    }
  } catch {
    // A corrupt or unavailable store just means starting from an empty memory;
    // it must never stop the page from being translated.
  }
}

function persistNow(): void {
  persistTimer = undefined;
  const store = storage();
  if (!store) return;
  try {
    const plain: Record<string, Record<string, string>> = {};
    for (const [target, entries] of remembered) {
      plain[target] = Object.fromEntries(entries);
    }
    store.setItem(STORAGE_KEY, JSON.stringify(plain));
  } catch {
    // A full quota must never break translation itself.
  }
}

function schedulePersist(): void {
  if (!storage()) return;
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
}

/**
 * Load the checked-in dictionary for one language. Safe to call on every
 * translation request: the work happens once per language and later calls await
 * the same promise.
 */
export function loadInterfaceDictionary(target: string): Promise<void> {
  const existing = pendingLoads.get(target);
  if (existing) return existing;

  const load = DICTIONARIES[`./i18n/${target}.json`];
  const task = load
    ? load()
      .then((entries) => {
        dictionaries.set(target, entries ?? {});
      })
      .catch(() => {
        // A missing or malformed dictionary degrades to asking the model.
        dictionaries.set(target, {});
      })
    : Promise.resolve().then(() => {
      dictionaries.set(target, {});
    });

  pendingLoads.set(target, task);
  return task;
}

/**
 * The translation we already have for `source`, or undefined when it has to be
 * asked for. The dictionary wins over remembered text: it is the curated answer.
 */
export function lookupTranslation(source: string, target: string): string | undefined {
  const key = source.trim();
  if (!key) return undefined;
  restore();
  return dictionaries.get(target)?.[key] ?? remembered.get(target)?.get(key);
}

/**
 * Keep translations the model just produced, so no later render asks for them
 * again. Entries already covered by the checked-in dictionary are not stored
 * twice.
 */
export function rememberTranslations(
  entries: Array<[string, string]>,
  target: string,
): void {
  restore();
  let entriesForTarget = remembered.get(target);
  if (!entriesForTarget) {
    entriesForTarget = new Map();
    remembered.set(target, entriesForTarget);
  }

  let changed = false;
  for (const [source, translation] of entries) {
    const key = source.trim();
    if (!key || dictionaries.get(target)?.[key] !== undefined) continue;
    // Re-insert so a string still in use is treated as recently seen.
    entriesForTarget.delete(key);
    entriesForTarget.set(key, translation);
    changed = true;
  }
  if (!changed) return;

  while (entriesForTarget.size > MAX_REMEMBERED_PER_LANGUAGE) {
    const oldest = entriesForTarget.keys().next().value;
    if (oldest === undefined) break;
    entriesForTarget.delete(oldest);
  }
  schedulePersist();
}

/**
 * Everything learned for one language, as the shape a `./i18n/<code>.json`
 * dictionary uses. This is how an interface dictionary is produced: view the app
 * in that language until the interface is fully translated, export, and commit
 * the result — after which that copy costs nothing for every later user.
 *
 * The writer's own sentences land here too, so review the dump before committing
 * it: a dictionary is shipped to everyone, and one session's writing is not
 * interface copy.
 */
export function exportTranslationMemory(target: string): Record<string, string> {
  restore();
  return Object.fromEntries(remembered.get(target) ?? new Map());
}

/** Write pending changes out immediately, instead of after the coalescing delay. */
export function flushTranslationMemory(): void {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistNow();
}

/** Drop everything remembered on this browser. Exposed for tests and for a reset. */
export function clearTranslationMemory(): void {
  remembered.clear();
  dictionaries.clear();
  pendingLoads.clear();
  restored = false;
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  persistTimer = undefined;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do if the store cannot be written.
  }
}
