import { contentTokens, normalize } from "./normalize";

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

const DECLARATION_PATTERNS: Array<{ kind: DraftDeclarationKind; pattern: RegExp }> = [
  {
    kind: "main_idea",
    pattern:
      /\b(?:my|the)\s+(?:main|central|core|primary)\s+(?:idea|point|claim|argument)(?:\s+i\s+want\s+to\s+carry\s+forward)?\s*(?:is|:)\s*/gi,
  },
  {
    kind: "thesis",
    pattern: /\b(?:my\s+thesis|the\s+thesis)\s*(?:is|:)\s*/gi,
  },
  {
    kind: "argument",
    pattern: /\b(?:i\s*(?:am|'m)\s+arguing\s+that|i\s+want\s+to\s+argue\s+that|the\s+argument\s+is\s+that)\s*/gi,
  },
];

const TENTATIVE_BEFORE_RE =
  /\b(?:maybe|perhaps|possibly|not sure|i wonder|i'm wondering|i am wondering|i think|i guess|i suppose|i'm leaning toward|i am leaning toward|leaning toward|tentatively|for now|at this point|seems like|it seems like)[\s,;:\u2013\u2014-]*$/i;
const TENTATIVE_BODY_RE =
  /^\s*(?:(?:it|that|this)\s+)?(?:might|may|could|can maybe|might maybe|may maybe)\s+(?:be|mean|show|suggest|point to)\b/i;
const BODY_CLEANUP_RE = /^[\s,:"'\u201c\u201d\u2018\u2019]+|[\s,:"'\u201c\u201d\u2018\u2019]+$/g;
const MIN_CONTENT_TOKENS = 3;
const MAX_DECLARATION_CHARS = 240;
const MAX_REPEATED_FOCUS_CHARS = 180;
const REPEATED_FOCUS_MIN_OCCURRENCES = 3;

function bodyEnd(text: string, start: number): number {
  const rest = text.slice(start);
  const match = rest.match(/[.!?\n;]/);
  return match?.index === undefined ? text.length : start + match.index;
}

function isTentativeLeadIn(text: string, markerStart: number): boolean {
  const before = text.slice(Math.max(0, markerStart - 80), markerStart);
  return TENTATIVE_BEFORE_RE.test(before);
}

function isTentativeBody(body: string): boolean {
  return TENTATIVE_BODY_RE.test(body);
}

function cleanBody(body: string): string {
  return body.replace(BODY_CLEANUP_RE, "").replace(/\s+/g, " ").trim();
}

function repeatedFocuses(draft: string, alreadyDeclared: ReadonlySet<string>): DraftDeclaration[] {
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
    if (text.length === 0 || text.length > MAX_REPEATED_FOCUS_CHARS) continue;
    if (contentTokens(text).length < MIN_CONTENT_TOKENS) continue;

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
    .filter((occurrence) => occurrence.count >= REPEATED_FOCUS_MIN_OCCURRENCES)
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
export function detectDraftDeclarations(draft: string): DraftDeclaration[] {
  const declarations: DraftDeclaration[] = [];
  const seen = new Set<string>();
  const declaredText = new Set<string>();

  for (const { kind, pattern } of DECLARATION_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(draft)) !== null) {
      const markerStart = match.index;
      if (isTentativeLeadIn(draft, markerStart)) continue;

      const bodyStart = pattern.lastIndex;
      const end = bodyEnd(draft, bodyStart);
      const rawBody = draft.slice(bodyStart, end);
      if (isTentativeBody(rawBody)) continue;

      const text = cleanBody(rawBody);
      if (text.length === 0 || text.length > MAX_DECLARATION_CHARS) continue;
      if (contentTokens(text).length < MIN_CONTENT_TOKENS) continue;

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

  declarations.push(...repeatedFocuses(draft, declaredText));

  return declarations.sort((a, b) => a.start - b.start);
}
