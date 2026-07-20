/**
 * Deterministic thresholds and product facts used by the typed Stage 1 loop.
 * Conversational interpretation belongs to the model; this file contains only
 * values consumed by pointer validation, factual context, or explicit UI input.
 */

export interface MirrorThresholds {
  /** Minimum grounding ratio for each cited source span. */
  spanGroundingMin: number;
}

export interface TurnShapeConfig {
  largeUnitCount: number;
  largeContentTokens: number;
  largeChars: number;
}

export interface PacingConfig {
  /** Derived from the explicit Think/Map control; 0 is Think, 1 is Map. */
  mapPressure: number;
  /** Exact user-facing slider value, retained for factual prompt context. */
  thinkMapBias: number;
}

export interface CapabilitiesConfig {
  canDo: string[];
  cantDo: string[];
}

export interface MindmapConfig {
  mirror: MirrorThresholds;
  pacing: PacingConfig;
  capabilities: CapabilitiesConfig;
  turnShape: TurnShapeConfig;
}

/** Apply the explicit user-facing Think/Map setting without language routing. */
export function withQuestionIntentBias(config: MindmapConfig, bias: number): MindmapConfig {
  const normalized = Math.max(0, Math.min(100, bias));
  const mapLean = Math.max(0, normalized - 50) / 50;
  return {
    ...config,
    mirror: { ...config.mirror },
    pacing: { mapPressure: mapLean, thinkMapBias: normalized },
    capabilities: {
      canDo: [...config.capabilities.canDo],
      cantDo: [...config.capabilities.cantDo],
    },
    turnShape: { ...config.turnShape },
  };
}

export const defaultConfig: MindmapConfig = {
  mirror: {
    spanGroundingMin: 0.75,
  },
  pacing: { mapPressure: 0, thinkMapBias: 0 },
  capabilities: {
    canDo: [
      "reflect your own words back to you (a mirror you confirm chunk by chunk)",
      "ask focused questions to help you think, not to fill the map",
      "place a card, nest a card, connect two cards, or reword a card from traceable user wording or a card ref; every change is still a proposal you review",
      "point at parts of your own draft (read-only) to anchor a question",
    ],
    cantDo: [
      "write, rewrite, summarize, or edit your draft for you",
      "decide the structure, wording, hierarchy, or connections for you",
      "put anything on the map that is not grounded in your own words and chosen by you",
      "change card colors, styling, layout, or other appearance settings",
      "export, save to a file, or share your map",
    ],
  },
  turnShape: {
    largeUnitCount: 4,
    largeContentTokens: 45,
    largeChars: 500,
  },
};
