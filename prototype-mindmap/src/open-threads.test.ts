import { describe, expect, it } from "vitest";
import {
  activateOpenThread,
  deriveParkableSpans,
  findMatchingOpenThread,
  parkExploratoryTurn,
  promoteOpenThreadsForUtterances,
  reopenPromotedOpenThreads,
} from "./open-threads";
import type { SourceUtterance } from "./types";

function u(id: string, text: string, turnId = "t_1"): SourceUtterance {
  return { id, text, turnId, timestamp: 1, origin: "chat" };
}

describe("open threads", () => {
  it("parks substantive exact spans from segmented user turns", () => {
    const threads = parkExploratoryTurn([], [
      u("u_1", "The opening is about control."),
      u("u_2", "The middle is about authorship."),
      u("u_3", "Ok."),
    ]);

    expect(threads.map((thread) => thread.text)).toEqual([
      "The opening is about control.",
      "The middle is about authorship.",
    ]);
    expect(threads.every((thread) => thread.status === "parked")).toBe(true);
  });

  it("splits long unpunctuated voice spans on conservative user boundary markers", () => {
    const spans = deriveParkableSpans([
      u(
        "u_1",
        "control starts the frame also authorship has to stay with the writer and then evidence needs to be visible",
      ),
    ]);

    expect(spans.map((span) => span.text)).toEqual([
      "control starts the frame",
      "also authorship has to stay with the writer",
      "and then evidence needs to be visible",
    ]);
  });

  it("deduplicates by normalized exact wording", () => {
    const first = parkExploratoryTurn([], [u("u_1", "Human control matters.")]);
    const second = parkExploratoryTurn(first, [u("u_2", "human control matters")]);

    expect(second).toHaveLength(1);
  });

  it("activates and promotes without creating structure", () => {
    const [thread] = parkExploratoryTurn([], [u("u_1", "Artifact ownership is its own strand.")]);
    const match = findMatchingOpenThread([thread], "I want to talk about artifact ownership");
    expect(match?.id).toBe(thread.id);

    const active = activateOpenThread([thread], thread.id);
    expect(active[0].status).toBe("active");

    const promoted = promoteOpenThreadsForUtterances(active, ["u_1"]);
    expect(promoted[0].status).toBe("promoted");

    const reopened = reopenPromotedOpenThreads(promoted);
    expect(reopened[0].status).toBe("parked");
  });
});
