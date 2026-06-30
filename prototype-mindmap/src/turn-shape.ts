import { contentTokens } from "./normalize";
import type { SourceUtterance } from "./types";

export type TurnShapeKind = "compact" | "large_exploratory" | "large_selected";

export interface TurnShape {
  kind: TurnShapeKind;
  reasons: string[];
  selected: boolean;
}

const LARGE_UNIT_COUNT = 4;
const LARGE_CONTENT_TOKENS = 45;
const LARGE_CHARS = 500;

const EXPLICIT_SELECTION_RE =
  /\b(?:the|my)\s+(?:main|central|core|primary)\s+(?:idea|point|claim|argument)\s*(?:is|:)\b|\b(?:my\s+thesis|the\s+thesis)\s*(?:is|:)\b|\bi\s*(?:am|'m)\s+arguing\s+that\b|\bi\s+want\s+to\s+carry\s+forward\b/i;
const DIRECT_MAP_COMMAND_RE =
  /\b(?:put|add|create)\b.{1,120}\b(?:on|to)\s+(?:the\s+)?map\b|\bconnect\b.{1,120}\bto\b/i;

export function hasExplicitTurnSelection(text: string, hasAcceptedMapCommand = false): boolean {
  return hasAcceptedMapCommand || EXPLICIT_SELECTION_RE.test(text) || DIRECT_MAP_COMMAND_RE.test(text);
}

export function detectTurnShape(
  text: string,
  units: SourceUtterance[],
  options: { hasAcceptedMapCommand?: boolean } = {},
): TurnShape {
  const reasons: string[] = [];
  const tokenCount = contentTokens(text).length;

  if (units.length >= LARGE_UNIT_COUNT) reasons.push(`unit_count:${units.length}`);
  if (tokenCount >= LARGE_CONTENT_TOKENS) reasons.push(`content_tokens:${tokenCount}`);
  if (text.length >= LARGE_CHARS) reasons.push(`chars:${text.length}`);

  if (reasons.length === 0) {
    return { kind: "compact", reasons, selected: false };
  }

  const selected = hasExplicitTurnSelection(text, options.hasAcceptedMapCommand);
  return {
    kind: selected ? "large_selected" : "large_exploratory",
    reasons,
    selected,
  };
}
