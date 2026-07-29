import { describe, expect, it } from "vitest";
import { applyGatewayActions, executeCanvasAction, inspectAction } from "./action-gateway";
import { ThoughtUnitStore } from "./map-store";
import { activeProposals, createProposalStore, resolveProposal, updateProposal, type Proposal } from "./proposal-store";
import { SourceBank } from "./store";

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => ((value = (value * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

describe("proposal and gateway sequence fuzz", () => {
  it("never wedges proposals or creates an invalid graph across arbitrary lifecycle sequences", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = rng(seed);
      const bank = new SourceBank();
      const store = new ThoughtUnitStore();
      let proposals = createProposalStore();
      for (let step = 0; step < 80; step++) {
        const choice = Math.floor(random() * 7);
        if (choice === 0) {
          const wording = `idea ${seed}-${step}`;
          const utterance = bank.add(wording, "chat");
          const proposal: Proposal = { id: `p-${seed}-${step}`, mapRevision: step, referencedCardIds: [], attribution: "asserted", state: "shown", detail: { kind: "map_action", action: { kind: "create_card", text: wording, sourceUtteranceIds: [utterance.id] } } };
          proposals = createProposalStore([...proposals.values(), proposal]);
        } else if (choice === 1 && activeProposals(proposals).length) {
          const proposal = activeProposals(proposals)[Math.floor(random() * activeProposals(proposals).length)];
          proposals = updateProposal(proposals, proposal.id, { state: "edited" });
        } else if (choice === 2 && activeProposals(proposals).length) {
          const proposal = activeProposals(proposals)[0];
          if (proposal.detail.kind === "map_action") {
            const checked = inspectAction(proposal.detail.action, { actor: "ai_proposal", store, bank });
            if (checked.status === "ready") applyGatewayActions([checked.action], store, bank);
          }
          proposals = resolveProposal(proposals, proposal.id, "confirmed");
        } else if (choice === 3 && activeProposals(proposals).length) {
          proposals = resolveProposal(proposals, activeProposals(proposals)[0].id, "declined");
        } else if (choice === 4 && store.getAll().length >= 2) {
          const cards = store.getAll().filter((card) => card.role !== "connection_label");
          if (cards.length >= 2) executeCanvasAction({ kind: "set_parent", id: cards[1].id, parentId: cards[0].id, role: "content" }, { store, bank });
        } else if (choice === 5 && store.getAll().length) {
          const card = store.getAll().find((item) => item.role !== "connection_label");
          if (card) executeCanvasAction({ kind: "move_card", id: card.id, position: { x: step, y: seed } }, { store, bank });
        } else {
          const snapshot = store.snapshot();
          executeCanvasAction({ kind: "restore_snapshot", snapshot }, { store, bank });
        }

        for (const card of store.getAll()) {
          const seen = new Set<string>([card.id]);
          let parentId = card.parentId;
          while (parentId) {
            expect(seen.has(parentId)).toBe(false);
            seen.add(parentId);
            parentId = store.get(parentId)?.parentId;
          }
        }
        expect(activeProposals(proposals).every((proposal) => proposal.state === "shown" || proposal.state === "edited")).toBe(true);
      }
    }
  });
});
