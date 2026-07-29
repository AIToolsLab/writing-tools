import type { ThoughtConnection } from "./map-store";
import type { ThoughtUnit } from "./types";

export interface ProvenanceTotals {
  userAuthored: number;
  aiConnected: number;
  aiSuggested: number;
  total: number;
}

function tier(origin: ThoughtUnit["source"]["origin"] | ThoughtConnection["origin"] | undefined): keyof Omit<ProvenanceTotals, "total"> {
  if (origin === "ai_suggested") return "aiSuggested";
  if (origin === "ai_connected") return "aiConnected";
  return "userAuthored";
}

export function provenanceTotals(units: ThoughtUnit[], connections: ThoughtConnection[]): ProvenanceTotals {
  const totals: ProvenanceTotals = { userAuthored: 0, aiConnected: 0, aiSuggested: 0, total: 0 };
  const count = (origin: ThoughtUnit["source"]["origin"] | ThoughtConnection["origin"] | undefined) => {
    totals[tier(origin)] += 1;
    totals.total += 1;
  };
  for (const unit of units) {
    if (unit.role === "connection_label") continue;
    count(unit.source.origin);
    if (unit.parentId) count(unit.parentProvenance?.origin ?? "user_canvas");
  }
  for (const connection of connections) count(connection.origin);
  return totals;
}
