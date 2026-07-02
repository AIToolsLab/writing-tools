import { beforeEach, describe, expect, it } from "vitest";
import { applyAcceptedMapCommands } from "./map-commands";
import { ThoughtUnitStore } from "./map-store";
import { resetIdCounter, SourceBank } from "./store";
import type { ThoughtUnit } from "./types";

beforeEach(() => {
  resetIdCounter();
});

describe("applyAcceptedMapCommands", () => {
  function unit(id: string, text: string): ThoughtUnit {
    return {
      id,
      text,
      role: "node",
      source: { utteranceIds: [`u_${id}`], createdBy: "user" },
      roleHistory: [{ role: "node", changedBy: "user", at: 1 }],
    };
  }

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
    expect(declarations[0].commandOnly).toBe(true);
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

  it("nests a new user card under an existing parent", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    const chatUtterance = bank.add("put human control under authorship", "chat");
    store.add(unit("parent", "authorship"));

    applyAcceptedMapCommands(
      [
        {
          kind: "nest_card",
          child: { text: "human control", sourceUtteranceIds: [chatUtterance.id] },
          parentId: "parent",
        },
      ],
      store,
      bank,
    );

    const child = store.getAll().find((u) => u.text === "human control");
    expect(child).toMatchObject({
      parentId: "parent",
      role: "content",
      source: { createdBy: "user" },
    });
    expect(child?.source.utteranceIds).toContain(chatUtterance.id);
    expect(bank.getAll().some((u) => u.origin === "declaration" && u.text === "human control")).toBe(true);
    expect(bank.getAll().find((u) => u.origin === "declaration" && u.text === "human control")?.commandOnly).toBe(true);
  });

  it("reuses one card when create and nest commands cite the same child wording", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    const chatUtterance = bank.add("No AI words-AI is only allowed to use grammatical function words", "chat");
    store.add(unit("parent", "Mechanism 1 to prevent authorship: Constrain"));

    applyAcceptedMapCommands(
      [
        {
          kind: "create_card",
          text: "No AI words-AI is only allowed to use grammatical function words",
          sourceUtteranceIds: [chatUtterance.id],
        },
        {
          kind: "nest_card",
          child: {
            text: "No AI words-AI is only allowed to use grammatical function words",
            sourceUtteranceIds: [chatUtterance.id],
          },
          parentId: "parent",
        },
      ],
      store,
      bank,
    );

    const children = store.getAll().filter((unit) =>
      unit.text === "No AI words-AI is only allowed to use grammatical function words",
    );
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ parentId: "parent", role: "content" });
  });

  it("does not reuse a different card merely because it came from the same utterance", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    const chatUtterance = bank.add("No silent commit and No AI words", "chat");
    store.add(unit("parent", "Mechanism 1 to prevent authorship: Constrain"));

    applyAcceptedMapCommands(
      [
        {
          kind: "create_card",
          text: "No silent commit",
          sourceUtteranceIds: [chatUtterance.id],
        },
        {
          kind: "nest_card",
          child: {
            text: "No AI words",
            sourceUtteranceIds: [chatUtterance.id],
          },
          parentId: "parent",
        },
      ],
      store,
      bank,
    );

    expect(store.getAll().some((storeUnit) => storeUnit.text === "No silent commit")).toBe(true);
    const child = store.getAll().find((storeUnit) => storeUnit.text === "No AI words");
    expect(child).toMatchObject({ parentId: "parent", role: "content" });
  });

  it("registers an unlabeled user-commanded connection", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.add(unit("source", "human control"));
    store.add(unit("target", "authorship"));

    applyAcceptedMapCommands(
      [
        {
          kind: "connect_cards",
          source: { id: "source" },
          target: { id: "target" },
        },
      ],
      store,
      bank,
    );

    expect(store.getConnections()).toHaveLength(1);
    expect(store.getConnections()[0]).toMatchObject({
      sourceId: "source",
      targetId: "target",
    });
    const label = store.get(store.getConnections()[0].labelUnitId);
    expect(label?.text).toBe("");
    expect(bank.getAll()).toHaveLength(0);
  });

  it("registers a labeled user-commanded connection with label provenance", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    const chatUtterance = bank.add("connect human control to authorship with preserves", "chat");
    store.add(unit("source", "human control"));
    store.add(unit("target", "authorship"));

    applyAcceptedMapCommands(
      [
        {
          kind: "connect_cards",
          source: { id: "source" },
          target: { id: "target" },
          labelText: "preserves",
          labelSourceUtteranceIds: [chatUtterance.id],
        },
      ],
      store,
      bank,
    );

    expect(store.getConnections()).toHaveLength(1);
    const label = store.get(store.getConnections()[0].labelUnitId);
    expect(label?.text).toBe("preserves");
    expect(label?.source.utteranceIds).toContain(chatUtterance.id);
    expect(bank.getAll().some((u) => u.origin === "declaration" && u.text === "preserves")).toBe(true);
    expect(bank.getAll().find((u) => u.origin === "declaration" && u.text === "preserves")?.commandOnly).toBe(true);
  });
});
