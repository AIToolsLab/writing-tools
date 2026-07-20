import { describe, expect, it } from "vitest";
import { buildDiagnosticSnapshot } from "./understanding";

describe("tracked idea diagnostics", () => {
  it("shows the latest valid user evidence rather than the model-authored gist", () => {
    const snapshot = buildDiagnosticSnapshot([], [{
      id: "c1",
      target: "connection",
      gist: "AI-only summary that must not be shown",
      evidenceUtteranceIds: ["u1", "u2"],
      status: "parked",
      createdTurn: 1,
      lastTouchedTurn: 1,
    }], [
      { id: "u1", text: "Human control needs visibility.", timestamp: 1, origin: "chat", turnId: "t1" },
      { id: "u2", text: "Transparency lets people see who has power.", timestamp: 2, origin: "chat", turnId: "t2" },
    ]);

    expect(snapshot.trackedIdeas).toEqual([{
      id: "c1",
      target: "connection",
      label: "Transparency lets people see who has power.",
      status: "parked",
      evidenceCount: 2,
      ageInTurns: 0,
    }]);
    expect(JSON.stringify(snapshot)).not.toContain("AI-only summary");
  });

  it("fails closed when candidate evidence is command-only or non-harvestable", () => {
    const snapshot = buildDiagnosticSnapshot([], [{
      id: "c1",
      target: "idea",
      gist: "never show",
      evidenceUtteranceIds: ["command", "aside"],
      status: "active",
      createdTurn: 1,
      lastTouchedTurn: 1,
    }], [
      { id: "command", text: "Add this as a card.", timestamp: 1, origin: "chat", turnId: "t1", commandOnly: true },
      { id: "aside", text: "I am just checking in.", timestamp: 2, origin: "chat", turnId: "t2", nonHarvestable: true },
    ]);

    expect(snapshot.trackedIdeas).toEqual([]);
  });
});
