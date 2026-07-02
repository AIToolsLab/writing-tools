import { beforeEach, describe, expect, it } from "vitest";
import { ThoughtUnitStore } from "./map-store";
import { resetIdCounter, SourceBank } from "./store";
import type { ConfirmedReflection, SourceUtterance, ThoughtUnit } from "./types";

beforeEach(() => {
  resetIdCounter();
});

function reflection(overrides: Partial<ConfirmedReflection> = {}): ConfirmedReflection {
  return {
    id: "cr1",
    text: "staying the author",
    candidateId: "cand1",
    target: "idea",
    sourceUtteranceIds: ["u1", "u2"],
    confirmedAt: 1,
    ...overrides,
  };
}

function unit(id: string, text: string, parentId?: string): ThoughtUnit {
  return {
    id,
    text,
    role: parentId ? "content" : "node",
    parentId,
    source: {
      utteranceIds: [`u-${id}`],
      createdBy: "user",
    },
    roleHistory: [{ role: parentId ? "content" : "node", changedBy: "user", at: 1 }],
  };
}

describe("ThoughtUnitStore", () => {
  it("creates exactly one standalone card from a confirmed reflection", () => {
    const store = new ThoughtUnitStore();
    const first = store.addFromReflection(reflection());
    const second = store.addFromReflection(reflection());

    expect(first).toBe(second);
    expect(store.getAll()).toHaveLength(1);
    expect(first.role).toBe("node");
    expect(first.parentId).toBeUndefined();
    expect(first.text).toBe("staying the author");
    expect(first.source.createdBy).toBe("ai_from_reflection");
    expect(first.source.reflectionId).toBe("cr1");
    expect(first.source.utteranceIds).toEqual(["u1", "u2"]);
    expect(first.roleHistory[0].changedBy).toBe("ai_proposed_user_confirmed");
  });

  it("creates exactly one user-authored card from a bank utterance", () => {
    const store = new ThoughtUnitStore();
    const utterance: SourceUtterance = {
      id: "u1",
      text: "all ideas should belong to the user",
      timestamp: 1,
      origin: "chat",
    };

    const first = store.addFromUserUtterance(utterance);
    const second = store.addFromUserUtterance(utterance);

    expect(first).toBe(second);
    expect(store.getAll()).toHaveLength(1);
    expect(first.role).toBe("node");
    expect(first.source.createdBy).toBe("user");
    expect(first.source.utteranceIds).toEqual(["u1"]);
    expect(first.roleHistory[0]).toMatchObject({
      role: "node",
      changedBy: "user",
    });
  });

  it("reparents a card and appends role history", () => {
    const store = new ThoughtUnitStore();
    store.add(unit("parent", "main idea"));
    store.add(unit("child", "detail"));

    const child = store.setParent("child", "parent", "content");

    expect(child?.parentId).toBe("parent");
    expect(child?.role).toBe("content");
    expect(child?.roleHistory[child.roleHistory.length - 1]).toMatchObject({
      role: "content",
      changedBy: "user",
    });
  });

  it("swaps a member card into the title position", () => {
    const store = new ThoughtUnitStore();
    store.add(unit("title", "old title"));
    store.add(unit("member", "better title", "title"));
    store.add(unit("sibling", "supporting point", "title"));

    const swapped = store.swapTitle("member");

    expect(swapped).toBe(true);
    expect(store.get("member")?.role).toBe("node");
    expect(store.get("member")?.parentId).toBeUndefined();
    expect(store.get("title")?.parentId).toBe("member");
    expect(store.get("title")?.role).toBe("content");
    expect(store.get("sibling")?.parentId).toBe("member");
    const siblingHistory = store.get("sibling")?.roleHistory ?? [];
    expect(siblingHistory[siblingHistory.length - 1]?.changedBy).toBe("user");
  });

  it("refuses a re-parent that would create a cycle", () => {
    const store = new ThoughtUnitStore();
    store.add(unit("a", "top"));
    store.add(unit("b", "under a"));
    store.setParent("b", "a", "content"); // a -> b

    // Dropping a under its own descendant b must be refused.
    expect(store.wouldCycle("a", "b")).toBe(true);
    const result = store.setParent("a", "b", "content");
    expect(result).toBeUndefined();
    expect(store.get("a")?.parentId).toBeUndefined();
    expect(store.get("b")?.parentId).toBe("a");
  });

  it("registers a user-labeled connection and writes its wording to the bank", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.add(unit("a", "author"));
    store.add(unit("b", "honesty"));

    const registered = store.registerConnection({
      sourceId: "a",
      targetId: "b",
      text: "keeps it honest",
      bank,
    });

    expect(bank.getAll()).toHaveLength(1);
    expect(bank.getAll()[0]).toMatchObject({
      text: "keeps it honest",
      origin: "declaration",
      commandOnly: true,
    });
    expect(registered.labelUnit.role).toBe("connection_label");
    expect(registered.labelUnit.source.utteranceIds).toEqual([registered.utterance?.id]);
    expect(store.getConnections()[0]).toMatchObject({
      sourceId: "a",
      targetId: "b",
      labelUnitId: registered.labelUnit.id,
    });
  });

  it("allows a connection with no wording and writes nothing to the bank", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.add(unit("a", "author"));
    store.add(unit("b", "honesty"));

    const registered = store.registerConnection({ sourceId: "a", targetId: "b", text: "   ", bank });

    expect(bank.getAll()).toHaveLength(0);
    expect(registered.utterance).toBeUndefined();
    expect(registered.labelUnit.text).toBe("");
    expect(registered.labelUnit.source.utteranceIds).toEqual([]);
    expect(store.getConnections()).toHaveLength(1);
  });

  it("deletes a connection and its label unit", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.add(unit("a", "author"));
    store.add(unit("b", "honesty"));
    const { connection, labelUnit } = store.registerConnection({
      sourceId: "a",
      targetId: "b",
      text: "keeps it honest",
      bank,
    });

    store.deleteConnection(connection.id);

    expect(store.getConnections()).toHaveLength(0);
    expect(store.get(labelUnit.id)).toBeUndefined();
  });

  it("deletes attached connection label units when deleting a connected card", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.add(unit("a", "author"));
    store.add(unit("b", "honesty"));
    const { labelUnit } = store.registerConnection({
      sourceId: "a",
      targetId: "b",
      text: "keeps it honest",
      bank,
    });

    store.delete("a");

    expect(store.getConnections()).toHaveLength(0);
    expect(store.get(labelUnit.id)).toBeUndefined();
  });

  it("places duplicate connections between the same two cards on different handles", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.add(unit("a", "author"));
    store.add(unit("b", "honesty"));

    const first = store.registerConnection({ sourceId: "a", targetId: "b", text: "supports", bank });
    const second = store.registerConnection({ sourceId: "b", targetId: "a", text: "qualifies", bank });

    expect(store.getConnections()).toHaveLength(2);
    expect(first.connection.sourceHandleId).toBeUndefined();
    expect(first.connection.targetHandleId).toBeUndefined();
    expect(second.connection.sourceHandleId).toBe("right");
    expect(second.connection.targetHandleId).toBe("left");
  });

  it("moves reconnected duplicate edges away from already-used handles", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.add(unit("a", "author"));
    store.add(unit("b", "honesty"));
    store.add(unit("c", "control"));
    const first = store.registerConnection({
      sourceId: "a",
      targetId: "b",
      sourceHandleId: "right",
      targetHandleId: "left",
      text: "supports",
      bank,
    });
    const second = store.registerConnection({
      sourceId: "a",
      targetId: "c",
      sourceHandleId: "right",
      targetHandleId: "left",
      text: "qualifies",
      bank,
    });

    store.reconnect(second.connection.id, "a", "b", "right", "left");

    const connections = store.getConnections();
    expect(connections.find((connection) => connection.id === first.connection.id)).toMatchObject({
      sourceHandleId: "right",
      targetHandleId: "left",
    });
    expect(connections.find((connection) => connection.id === second.connection.id)).toMatchObject({
      sourceId: "a",
      targetId: "b",
      sourceHandleId: "bottom",
      targetHandleId: "top",
    });
  });

  it("reconnects a connection and preserves chosen card-side handles", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.add(unit("a", "author"));
    store.add(unit("b", "honesty"));
    store.add(unit("c", "control"));
    const { connection } = store.registerConnection({
      sourceId: "a",
      targetId: "b",
      sourceHandleId: "left",
      targetHandleId: "left",
      text: "",
      bank,
    });

    store.reconnect(connection.id, "b", "c", "bottom", "top");

    expect(store.getConnections()[0]).toMatchObject({
      id: connection.id,
      sourceId: "b",
      targetId: "c",
      sourceHandleId: "bottom",
      targetHandleId: "top",
    });
  });

  it("edits card text through the same bank instance the loop reads", () => {
    const store = new ThoughtUnitStore();
    const bank = new SourceBank();
    store.addFromReflection(reflection());

    const card = store.getAll()[0];
    const utterance = store.editText(card.id, "staying the author keeps me responsible", bank);

    expect(utterance?.origin).toBe("node_edit");
    expect(store.get(card.id)?.source.utteranceIds).toContain(utterance?.id);
    expect(bank.getAll()).toContainEqual(
      expect.objectContaining({
        id: utterance?.id,
        text: "staying the author keeps me responsible",
        origin: "node_edit",
      }),
    );
  });

  it("persists card sizes through snapshots", () => {
    const store = new ThoughtUnitStore();
    store.add(unit("a", "resizable card"));
    store.setSize("a", { w: 360, h: 210 });

    const restored = new ThoughtUnitStore();
    restored.loadSnapshot(store.snapshot());

    expect(restored.getSize("a")).toEqual({ w: 360, h: 210 });
  });

  it("clamps runaway card sizes on write", () => {
    const store = new ThoughtUnitStore();
    store.add(unit("a", "card"));
    // The old auto-expand bug wrote scrollHeights in the ~173,000px range.
    store.setSize("a", { w: 173833, h: 173833 });

    expect(store.getSize("a")).toEqual({ w: 1200, h: 1200 });
  });

  it("sanitizes oversized and invalid sizes when loading a snapshot", () => {
    const store = new ThoughtUnitStore();
    store.add(unit("a", "huge"));
    store.add(unit("b", "tiny"));
    store.add(unit("c", "bad"));

    // Hand-build a corrupt snapshot the way a stale localStorage session would.
    const corrupt = {
      ...store.snapshot(),
      sizes: {
        a: { w: 99999, h: 173914 },
        b: { w: 5, h: 5 },
        c: { w: Number.NaN, h: Number.NaN },
      },
    };

    const restored = new ThoughtUnitStore();
    restored.loadSnapshot(corrupt);

    expect(restored.getSize("a")).toEqual({ w: 1200, h: 1200 });
    expect(restored.getSize("b")).toEqual({ w: 120, h: 60 });
    expect(restored.getSize("c")).toEqual({ w: 120, h: 60 });
  });

  it("places new root cards without overlapping existing ones", () => {
    const store = new ThoughtUnitStore();
    const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (let i = 0; i < 12; i++) {
      const unit = store.addBlankUserCard();
      const pos = store.getPosition(unit.id)!;
      const size = store.getSize(unit.id) ?? { w: 260, h: 140 };
      rects.push({ x: pos.x, y: pos.y, w: size.w, h: size.h });
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it("finds a visible non-overlapping root slot when the viewport still has room", () => {
    const store = new ThoughtUnitStore();
    store.addBlankUserCard({ x: 80, y: 80 });
    store.addBlankUserCard({ x: 360, y: 80 });
    store.addBlankUserCard({ x: 640, y: 80 });

    const pos = store.nextRootPositionWithin({
      left: 60,
      top: 60,
      right: 980,
      bottom: 620,
    });

    expect(pos).toBeDefined();
    expect(pos).toEqual({ x: 60, y: 420 });
  });
});
