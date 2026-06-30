import { contentTokens } from "./normalize";
import { defaultConfig, type TurnShapeConfig } from "./config";
import type { SourceUtterance } from "./types";

export type TurnShapeKind = "compact" | "large_exploratory" | "large_selected";

export interface TurnShape {
  kind: TurnShapeKind;
  reasons: string[];
  selected: boolean;
}

export function hasExplicitTurnSelection(
  text: string,
  hasAcceptedMapCommand = false,
  config: TurnShapeConfig = defaultConfig.turnShape,
): boolean {
  const explicitSelectionRe = new RegExp(config.explicitSelectionPattern, "i");
  const directMapCommandRe = new RegExp(config.directMapCommandPattern, "i");
  return hasAcceptedMapCommand || explicitSelectionRe.test(text) || directMapCommandRe.test(text);
}

export function detectTurnShape(
  text: string,
  units: SourceUtterance[],
  options: { hasAcceptedMapCommand?: boolean; config?: TurnShapeConfig } = {},
): TurnShape {
  const config = options.config ?? defaultConfig.turnShape;
  const reasons: string[] = [];
  const tokenCount = contentTokens(text).length;

  if (units.length >= config.largeUnitCount) reasons.push(`unit_count:${units.length}`);
  if (tokenCount >= config.largeContentTokens) reasons.push(`content_tokens:${tokenCount}`);
  if (text.length >= config.largeChars) reasons.push(`chars:${text.length}`);

  if (reasons.length === 0) {
    return { kind: "compact", reasons, selected: false };
  }

  const selected = hasExplicitTurnSelection(text, options.hasAcceptedMapCommand, config);
  return {
    kind: selected ? "large_selected" : "large_exploratory",
    reasons,
    selected,
  };
}
