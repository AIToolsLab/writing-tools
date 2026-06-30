import { beforeEach, describe, expect, it } from "vitest";
import { applyAcceptedMapCommands } from "./map-commands";
import { ThoughtUnitStore } from "./map-store";
import { resetIdCounter, SourceBank } from "./store";

beforeEach(() => {
  resetIdCounter();
});

describe("applyAcceptedMapCommands", () => {
  it("creates a user card, writes a declaration to the same bank, and preserves chat provenance", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    const chatUtterance = bank.add("drop human control on the canvas", "chat");

    const created = applyAcceptedMapCommands(
      [
        {
          kind: "create_card",
          text: "human control",
          sourceUtteranceIds: [chatUtterance.id],
        },
      ],
      store,
      bank,
    );

    expect(created).toHaveLength(1);
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]).toMatchObject({
      text: "human control",
      role: "node",
      source: { createdBy: "user" },
    });
    expect(store.getAll()[0].source.utteranceIds).toContain(chatUtterance.id);

    const declarations = bank.getAll().filter((u) => u.origin === "declaration");
    expect(declarations).toHaveLength(1);
    expect(declarations[0].text).toBe("human control");
    expect(store.getAll()[0].source.utteranceIds).toContain(declarations[0].id);
  });

  it("can be reverted with the same snapshot path App undo uses", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    const chatUtterance = bank.add("drop human control on the canvas", "chat");
    const before = {
      map: store.snapshot(),
      bank: bank.getAll(),
    };

    applyAcceptedMapCommands(
      [
        {
          kind: "create_card",
          text: "human control",
          sourceUtteranceIds: [chatUtterance.id],
        },
      ],
      store,
      bank,
    );

    expect(store.getAll()).toHaveLength(1);
    expect(bank.getAll()).toHaveLength(2);

    store.loadSnapshot(before.map);
    bank.replaceAll(before.bank);

    expect(store.getAll()).toHaveLength(0);
    expect(bank.getAll()).toEqual([chatUtterance]);
  });
});
