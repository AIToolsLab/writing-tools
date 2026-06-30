import { contentTokens, normalize } from "./normalize";
import { defaultConfig, type DraftDeclarationConfig } from "./config";

export type DraftDeclarationKind = "main_idea" | "thesis" | "argument" | "repeated_focus";

export interface DraftDeclaration {
  kind: DraftDeclarationKind;
  /** Exact declared idea text from the draft, trimmed to the declaration body. */
  text: string;
  /** Exact draft substring that carries both the declaration marker and idea. */
  userPhrase: string;
  start: number;
  end: number;
}

const BODY_CLEANUP_RE = /^[\s,:"'\u201c\u201d\u2018\u2019]+|[\s,:"'\u201c\u201d\u2018\u2019]+$/g;

function bodyEnd(text: string, start: number): number {
  const rest = text.slice(start);
  const match = rest.match(/[.!?\n;]/);
  return match?.index === undefined ? text.length : start + match.index;
}

function isTentativeLeadIn(text: string, markerStart: number, config: DraftDeclarationConfig): boolean {
  const before = text.slice(Math.max(0, markerStart - config.maxTentativeLookbackChars), markerStart);
  return new RegExp(config.tentativeBeforePattern, "i").test(before);
}

function isTentativeBody(body: string, config: DraftDeclarationConfig): boolean {
  return new RegExp(config.tentativeBodyPattern, "i").test(body);
}

function cleanBody(body: string): string {
  return body.replace(BODY_CLEANUP_RE, "").replace(/\s+/g, " ").trim();
}

function repeatedFocuses(
  draft: string,
  alreadyDeclared: ReadonlySet<string>,
  config: DraftDeclarationConfig,
): DraftDeclaration[] {
  const occurrences = new Map<
    string,
    {
      text: string;
      start: number;
      end: number;
      userPhrase: string;
      count: number;
    }
  >();
  const segmentRe = /[^\n.!?;]+(?:[.!?;]|$)/g;
  let match: RegExpExecArray | null;

  while ((match = segmentRe.exec(draft)) !== null) {
    const raw = match[0];
    const leadingWhitespace = raw.match(/^\s*/)?.[0].length ?? 0;
    const phraseStart = match.index + leadingWhitespace;
    const phraseEnd = match.index + raw.trimEnd().length;
    const userPhrase = draft.slice(phraseStart, phraseEnd).trim();
    if (!userPhrase || userPhrase.endsWith("?")) continue;

    const text = cleanBody(userPhrase.replace(/[.!?;]+$/, ""));
    if (text.length === 0 || text.length > config.maxRepeatedFocusChars) continue;
    if (contentTokens(text).length < config.minContentTokens) continue;

    const key = normalize(text);
    if (!key || alreadyDeclared.has(key)) continue;
    const current = occurrences.get(key);
    if (current) {
      current.count += 1;
    } else {
      occurrences.set(key, {
        text,
        start: phraseStart,
        end: phraseEnd,
        userPhrase,
        count: 1,
      });
    }
  }

  return [...occurrences.values()]
    .filter((occurrence) => occurrence.count >= config.repeatedFocusMinOccurrences)
    .map((occurrence) => ({
      kind: "repeated_focus",
      text: occurrence.text,
      userPhrase: occurrence.userPhrase,
      start: occurrence.start,
      end: occurrence.end,
    }));
}

/**
 * High-precision, suppression-only detector for ideas the user has already
 * declared in the draft. These spans are not candidates and can never become
 * map structure; they only tell the coach not to ask the user to restate them.
 */
export function detectDraftDeclarations(
  draft: string,
  config: DraftDeclarationConfig = defaultConfig.draftDeclarations,
): DraftDeclaration[] {
  const declarations: DraftDeclaration[] = [];
  const seen = new Set<string>();
  const declaredText = new Set<string>();

  for (const { kind, pattern: patternSource } of config.declarationPatterns) {
    const pattern = new RegExp(patternSource, "gi");
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(draft)) !== null) {
      const markerStart = match.index;
      if (isTentativeLeadIn(draft, markerStart, config)) continue;

      const bodyStart = pattern.lastIndex;
      const end = bodyEnd(draft, bodyStart);
      const rawBody = draft.slice(bodyStart, end);
      if (isTentativeBody(rawBody, config)) continue;

      const text = cleanBody(rawBody);
      if (text.length === 0 || text.length > config.maxDeclarationChars) continue;
      if (contentTokens(text).length < config.minContentTokens) continue;

      const phraseStart = markerStart;
      const phraseEnd = end;
      const userPhrase = draft.slice(phraseStart, phraseEnd).trim();
      const key = `${kind}:${text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      declaredText.add(normalize(text));

      declarations.push({
        kind,
        text,
        userPhrase,
        start: phraseStart,
        end: phraseEnd,
      });
    }
  }

  declarations.push(...repeatedFocuses(draft, declaredText, config));

  return declarations.sort((a, b) => a.start - b.start);
}
