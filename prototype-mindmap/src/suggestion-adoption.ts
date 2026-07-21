import { contentTokens, stem } from "./normalize";
import type { SuggestionAdoptionTrace, ThoughtUnit } from "./types";
import type { ThoughtUnitStore } from "./map-store";

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
    if (overlapRatio === 0) continue;
    if (overlapRatio > best.overlapRatio || (overlapRatio === best.overlapRatio && suggestion.id > (best.messageId ?? -Infinity))) {
      best = { messageId: suggestion.id, overlapRatio, matchedStems, cardStems };
    }
  }
  return best;
}

export function reconcileSuggestionAdoption(unit: ThoughtUnit, suggestions: VisibleSuggestion[], allowNewAdoption = false): ThoughtUnit {
  if (unit.role === "connection_label") return unit;
  const match = bestSuggestionMatch(unit.text, suggestions);
  const previous = unit.source.suggestionAdoption;
  if (!previous && (!allowNewAdoption || match.messageId === undefined || match.overlapRatio < SUGGESTION_ADOPTION_THRESHOLD)) return unit;

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

export interface SuggestionAdoptionChange {
  cardId: string;
  before?: SuggestionAdoptionTrace;
  after: SuggestionAdoptionTrace;
}

/**
 * Sweep after any map mutation. Only wording changed in this mutation may newly
 * adopt a prior suggestion; untouched cards can only update an existing trace.
 */
export function reconcileStoreSuggestionAdoption(store: ThoughtUnitStore, suggestions: VisibleSuggestion[], textChangedCardIds: ReadonlySet<string> = new Set()): SuggestionAdoptionChange[] {
  const changes: SuggestionAdoptionChange[] = [];
  for (const unit of store.getAll()) {
    const next = reconcileSuggestionAdoption(unit, suggestions, textChangedCardIds.has(unit.id));
    if (next === unit) continue;
    const before = unit.source.suggestionAdoption;
    const after = next.source.suggestionAdoption!;
    store.update(unit.id, { source: next.source });
    if (!before || before.currentOverlapRatio !== after.currentOverlapRatio || before.currentBestSuggestionMessageId !== after.currentBestSuggestionMessageId) {
      changes.push({ cardId: unit.id, before, after });
    }
  }
  return changes;
}
