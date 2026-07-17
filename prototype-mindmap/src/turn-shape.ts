import { contentTokens } from "./normalize";
import { defaultConfig, type TurnShapeConfig } from "./config";
import type { SourceUtterance } from "./types";

export type TurnShapeKind = "compact" | "large";

export interface TurnShape {
  kind: TurnShapeKind;
  reasons: string[];
  utteranceCount: number;
  contentTokenCount: number;
  characterCount: number;
}

export function detectTurnShape(
  text: string,
  units: SourceUtterance[],
  options: { config?: TurnShapeConfig } = {},
): TurnShape {
  const config = options.config ?? defaultConfig.turnShape;
  const reasons: string[] = [];
  const tokenCount = contentTokens(text).length;

  if (units.length >= config.largeUnitCount) reasons.push(`unit_count:${units.length}`);
  if (tokenCount >= config.largeContentTokens) reasons.push(`content_tokens:${tokenCount}`);
  if (text.length >= config.largeChars) reasons.push(`chars:${text.length}`);

  return {
    kind: reasons.length === 0 ? "compact" : "large",
    reasons,
    utteranceCount: units.length,
    contentTokenCount: tokenCount,
    characterCount: text.length,
  };
}
