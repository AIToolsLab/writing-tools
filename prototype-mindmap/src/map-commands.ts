import type { AcceptedMapCommand } from "./controller";
import type { ThoughtUnitStore } from "./map-store";
import type { SourceBank } from "./store";
import type { ThoughtUnit } from "./types";

export function applyAcceptedMapCommands(
  commands: AcceptedMapCommand[],
  store: ThoughtUnitStore,
  bank: SourceBank,
): ThoughtUnit[] {
  const created: ThoughtUnit[] = [];

  for (const command of commands) {
    if (command.kind !== "create_card") continue;
    const utterance = bank.add(command.text, "declaration");
    const unit = store.addFromUserUtterance(utterance);
    const updated = store.update(unit.id, {
      source: {
        ...unit.source,
        utteranceIds: Array.from(
          new Set([...command.sourceUtteranceIds, utterance.id]),
        ),
      },
    });
    created.push(updated ?? unit);
  }

  return created;
}
