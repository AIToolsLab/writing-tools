/** Display-only translation helpers. They never alter authored text. */
export const READER_TRANSLATION_CONCURRENCY = 4;

const PROTECTED = /```[\s\S]*?```|`[^`\n]+`|\bhttps?:\/\/[^\s<>"')]+|\b[\w.+-]+@[\w-]+\.[\w.]+\b|#\d+\b|\[\[\[\d+\]\]\]/g;

export interface ProtectedText {
  text: string;
  restore: (translated: string) => string;
}

/** Keeps non-prose spans byte-for-byte intact across a provider round trip. */
export function protectReaderText(source: string): ProtectedText {
  const protectedParts: string[] = [];
  const text = source.replace(PROTECTED, (part) => {
    const marker = `[[[${protectedParts.length}]]]`;
    protectedParts.push(part);
    return marker;
  });
  return {
    text,
    restore: (translated) => translated.replace(/\[\[\[(\d+)\]\]\]/g, (marker, index) => protectedParts[Number(index)] ?? marker),
  };
}

export function readerCacheKey(language: string, source: string): string {
  return `${language}\u0000${source}`;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  work: (item: T) => Promise<R>,
  limit = READER_TRANSLATION_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
