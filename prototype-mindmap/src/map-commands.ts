import type { AcceptedMapCommand } from "./controller";
import type { ThoughtUnitStore } from "./map-store";
import { normalize } from "./normalize";
import type { SourceBank } from "./store";
import type { ThoughtUnit } from "./types";

function ensureCard(
  ref: Extract<AcceptedMapCommand, { kind: "nest_card" }>["child"] | Extract<AcceptedMapCommand, { kind: "connect_cards" }>["source"],
  store: ThoughtUnitStore,
  bank: SourceBank,
): ThoughtUnit | undefined {
  if ("id" in ref) return store.get(ref.id);
  const normalizedText = normalize(ref.text);
  const existingByText = store.getAll().find((unit) =>
    unit.role !== "connection_label" && normalize(unit.text) === normalizedText,
  );
  if (existingByText) return existingByText;

  const existingBySameSourceAndText = store.getAll().find((unit) =>
    unit.role !== "connection_label" &&
    normalize(unit.text) === normalizedText &&
    ref.sourceUtteranceIds.some((id) => unit.source.utteranceIds.includes(id)),
  );
  if (existingBySameSourceAndText) return existingBySameSourceAndText;

  const utterance = bank.add(ref.text, "declaration");
  const unit = store.addFromUserUtterance(utterance);
  return store.update(unit.id, {
    source: {
      ...unit.source,
      utteranceIds: Array.from(new Set([...ref.sourceUtteranceIds, utterance.id])),
    },
  }) ?? unit;
}

export function applyAcceptedMapCommands(
  commands: AcceptedMapCommand[],
  store: ThoughtUnitStore,
  bank: SourceBank,
): ThoughtUnit[] {
  const created: ThoughtUnit[] = [];

  for (const command of commands) {
    if (command.kind === "create_card") {
      const unit = ensureCard(
        { text: command.text, sourceUtteranceIds: command.sourceUtteranceIds },
        store,
        bank,
      );
      if (unit) created.push(unit);
      continue;
    }

    if (command.kind === "nest_card") {
      const child = ensureCard(command.child, store, bank);
      if (!child || !store.get(command.parentId)) continue;
      const hasChildren = store.getAll().some((unit) => unit.parentId === child.id);
      const nested = store.setParent(child.id, command.parentId, hasChildren ? "subnode" : "content");
      if (nested) created.push(nested);
      continue;
    }

    if (command.kind === "connect_cards") {
      const source = ensureCard(command.source, store, bank);
      const target = ensureCard(command.target, store, bank);
      if (!source || !target || source.id === target.id) continue;
      const registered = store.registerConnection({
        sourceId: source.id,
        targetId: target.id,
        text: command.labelText ?? "",
        bank,
      });
      if (command.labelSourceUtteranceIds && command.labelSourceUtteranceIds.length > 0) {
        store.update(registered.labelUnit.id, {
          source: {
            ...registered.labelUnit.source,
            utteranceIds: Array.from(
              new Set([
                ...command.labelSourceUtteranceIds,
                ...registered.labelUnit.source.utteranceIds,
              ]),
            ),
          },
        });
      }
      created.push(registered.labelUnit);
    }
  }

  return created;
}
