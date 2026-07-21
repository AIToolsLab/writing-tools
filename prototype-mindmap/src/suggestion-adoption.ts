import { contentTokens, stem } from "./normalize";
import type { SuggestionAdoptionTrace, ThoughtUnit } from "./types";

export const SUGGESTION_ADOPTION_THRESHOLD = 0.5;

export interface VisibleSuggestion {
  id: number;
  text: string;
}

export interface SuggestionMatch {
  messageId?: number;
  overlapRatio: number;
  matchedStems: string[];
  cardStems: string[];
}

function distinctContentStems(text: string): string[] {
  return Array.from(new Set(contentTokens(text).map(stem).filter(Boolean)));
}

export function bestSuggestionMatch(cardText: string, suggestions: VisibleSuggestion[]): SuggestionMatch {
  const cardStems = distinctContentStems(cardText);
  if (!cardStems.length || !suggestions.length) return { overlapRatio: 0, matchedStems: [], cardStems };

  let best: SuggestionMatch = { overlapRatio: 0, matchedStems: [], cardStems };
  for (const suggestion of suggestions) {
    const suggestionStems = new Set(distinctContentStems(suggestion.text));
    const matchedStems = cardStems.filter((token) => suggestionStems.has(token));
    const overlapRatio = matchedStems.length / cardStems.length;
    if (overlapRatio > best.overlapRatio || (overlapRatio === best.overlapRatio && suggestion.id > (best.messageId ?? -Infinity))) {
      best = { messageId: suggestion.id, overlapRatio, matchedStems, cardStems };
    }
  }
  return best;
}

export function reconcileSuggestionAdoption(unit: ThoughtUnit, suggestions: VisibleSuggestion[]): ThoughtUnit {
  if (unit.role === "connection_label") return unit;
  const match = bestSuggestionMatch(unit.text, suggestions);
  const previous = unit.source.suggestionAdoption;
  if (!previous && (match.messageId === undefined || match.overlapRatio < SUGGESTION_ADOPTION_THRESHOLD)) return unit;

  const adoption: SuggestionAdoptionTrace = previous
    ? {
        ...previous,
        currentBestSuggestionMessageId: match.messageId,
        currentOverlapRatio: match.overlapRatio,
        peakOverlapRatio: Math.max(previous.peakOverlapRatio, match.overlapRatio),
      }
    : {
        adoptedFromMessageId: match.messageId!,
        currentBestSuggestionMessageId: match.messageId,
        currentOverlapRatio: match.overlapRatio,
        peakOverlapRatio: match.overlapRatio,
      };

  return {
    ...unit,
    source: { ...unit.source, origin: "ai_suggested", suggestionAdoption: adoption },
  };
}
