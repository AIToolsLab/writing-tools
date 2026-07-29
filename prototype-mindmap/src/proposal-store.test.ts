import { describe, expect, it } from "vitest";
import { activeProposals, canTransitionProposal, createProposalStore, resolveProposal, updateProposal } from "./proposal-store";

const proposal = {
  id: "p1",
  mapRevision: 3,
  referencedCardIds: [],
  attribution: "asserted" as const,
  state: "shown" as const,
  detail: {
    kind: "map_action" as const,
    action: { kind: "create_card" as const, text: "human control", sourceUtteranceIds: ["u1"] },
  },
};

describe("ProposalStore", () => {
  it("keeps independent proposals active and resolves only the selected item", () => {
    const store = createProposalStore([proposal, { ...proposal, id: "p2" }]);
    const edited = updateProposal(store, "p1", { state: "edited" });
    const resolved = resolveProposal(edited, "p1", "declined");
    expect(activeProposals(resolved).map((item) => item.id)).toEqual(["p2"]);
    expect(resolved.get("p1")?.state).toBe("declined");
  });

  it("locks terminal lifecycle states", () => {
    const declined = resolveProposal(createProposalStore([proposal]), "p1", "declined");
    expect(updateProposal(declined, "p1", { state: "confirmed" }).get("p1")?.state).toBe("declined");
    expect(canTransitionProposal("edited", "invalidated")).toBe(true);
  });
});
