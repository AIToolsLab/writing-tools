import { useState } from "react";
import type { TurnOutput } from "./controller";

// ===========================================================================
// TEMPORARY LOCAL MOCK of the trace contract.
//
// Coder 1 owns the real implementation in `./trace`. This block mirrors the
// FROZEN contract exactly so the panel can be built and wired ahead of that
// landing. AT INTEGRATION: delete this block (the types + deriveTraceEvent) and
// instead import them from the real module:
//
//   import { deriveTraceEvent, type TraceEvent, type TraceLevel } from "./trace";
//
// Everything below the mock (the CoachTrace component + styles) is permanent.
// ===========================================================================
export type TraceLevel = "quiet" | "notice" | "held";

export interface TraceEvent {
  id: string;
  turnId: string;
  reason: string; // internal key — NEVER render this in the default view
  level: TraceLevel;
  icon: string; // Tabler-style key or emoji key, catalog-provided
  title: string; // short label, no trailing period
  explanation: string; // one calm sentence
  detail?: string; // expanded, plain-English (may include a score)
  technical?: Record<string, unknown>; // behind "Show technical detail" only
}

/**
 * MOCK derivation. Picks a level and calm catalog strings from the turn output
 * so the panel can be exercised end-to-end before `./trace` exists. The real
 * impl (coder 1) will be richer; this keeps the same shape and honors the
 * user-facing rules (system-subject copy, no model prose, no raw keys in copy).
 */
export function deriveTraceEvent(out: TurnOutput, turnId: string): TraceEvent {
  const base = { id: `trace_${turnId}`, turnId };

  // A suppressed turn (that isn't a plain command hand-back) is the coach
  // *choosing* to hold a reflection — calm, system as subject.
  const heldReason =
    out.suppressionReason && out.suppressionReason !== "command_precedence"
      ? out.suppressionReason
      : undefined;
  if (heldReason) {
    return {
      ...base,
      reason: String(heldReason),
      level: "held",
      icon: "pause",
      title: "I held back a reflection",
      explanation: "I didn't have enough of your own words to mirror this cleanly yet.",
      detail:
        out.suppressionDetail ??
        "The reflection didn't clear the grounding bar, so I asked a question instead of putting words in your mouth.",
      technical: {
        suppressionReason: out.suppressionReason,
        suppressionDetail: out.suppressionDetail,
        validationDebug: out.validationDebug,
        readinessNotes: out.readinessNotes,
      },
    };
  }

  if (out.mapCommands && out.mapCommands.length > 0) {
    const count = out.mapCommands.length;
    return {
      ...base,
      reason: "map_command_executed",
      level: "notice",
      icon: "check",
      title: count === 1 ? "Made a change on your map" : `Made ${count} changes on your map`,
      explanation: "I did the map action you asked for, using your exact words.",
      detail: "This only ran because your turn was a direct command with wording or references I could resolve.",
      technical: { mapCommands: out.mapCommands, commandDebug: out.commandDebug },
    };
  }

  if (out.validatedMirror) {
    return {
      ...base,
      reason: "mirror_shown",
      level: "notice",
      icon: "mirror",
      title: "Reflected your structure back",
      explanation: "I showed you the shape I heard, in your own words, for you to confirm.",
      detail: "A reflection only appears once enough of your wording supports it. You decide whether it holds.",
      technical: { validationDebug: out.validationDebug },
    };
  }

  if (out.mode === "clarify") {
    return {
      ...base,
      reason: "clarify",
      level: "notice",
      icon: "message",
      title: "Asked a clarifying question",
      explanation: "I zoomed in on one phrase so we stay grounded in what you meant.",
      technical: out.commandDebug ? { commandDebug: out.commandDebug } : undefined,
    };
  }

  return {
    ...base,
    reason: "question",
    level: "quiet",
    icon: "ear",
    title: "Kept listening",
    explanation: "I asked a question to help you take the next small step.",
    technical: undefined,
  };
}
// ===========================================================================
// END mock block.
// ===========================================================================

type ChipKind = "executed" | "reflected" | "clarifying" | "neutral" | "held" | "quiet";

function chipKind(event: TraceEvent): ChipKind {
  if (event.level === "held") return "held";
  if (event.level === "quiet") return "quiet";
  switch (event.icon) {
    case "check":
      return "executed";
    case "mirror":
      return "reflected";
    case "message":
      return "clarifying";
    default:
      return "neutral";
  }
}

// Monochrome glyphs that inherit the chip's text color, so the level tint reads
// cleanly. Falls back to the catalog key itself (which may already be an emoji).
const ICON_GLYPH: Record<string, string> = {
  check: "✓",
  mirror: "◑",
  message: "?",
  pause: "❙❙",
  ear: "·",
};

function glyphFor(icon: string): string {
  return ICON_GLYPH[icon] ?? icon;
}

const COACH_TRACE_CSS = `
  .coach-trace {
    /* Light-mode defaults; overridden by the dark-mode block below. */
    --ct-bg: #fbfbf9;
    --ct-header-bg: #f4f3ef;
    --ct-border: #e5e3de;
    --ct-hairline: rgba(0, 0, 0, 0.08);
    --ct-text: #26241f;
    --ct-text-secondary: #75716a;
    --ct-chip-neutral-bg: #e9e7e1;
    --ct-chip-neutral-fg: #6d6a62;
    --ct-executed-bg: #e3f3e8;
    --ct-executed-fg: #1f7a43;
    --ct-reflected-bg: #efe9fb;
    --ct-reflected-fg: #6a4fb0;
    --ct-clarifying-bg: #e6f1fb;
    --ct-clarifying-fg: #2a6ea8;
    --ct-held-bg: #fbf1dd;
    --ct-held-fg: #9a6a12;
    --ct-technical-bg: #1d1b17;
    --ct-technical-fg: #e8e5dd;

    border-top: 1px solid var(--ct-border);
    background: var(--ct-bg);
    color: var(--ct-text);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    max-height: 46%;
  }

  .coach-trace-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: var(--ct-header-bg);
    border-bottom: 1px solid var(--ct-hairline);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }
  .coach-trace-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ct-text-secondary);
  }
  .coach-trace-count {
    font-size: 11px;
    font-weight: 600;
    color: var(--ct-text-secondary);
    background: var(--ct-chip-neutral-bg);
    border-radius: 99px;
    padding: 1px 7px;
  }
  .coach-trace-caret {
    margin-left: auto;
    font-size: 11px;
    color: var(--ct-text-secondary);
  }

  .coach-trace-list {
    overflow-y: auto;
    min-height: 0;
  }

  .coach-trace-empty {
    padding: 14px;
    font-size: 12px;
    font-style: italic;
    color: var(--ct-text-secondary);
  }

  .ct-row {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-top: 0.5px solid var(--ct-hairline);
    padding: 0;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .ct-row:first-child { border-top: none; }
  .ct-row.level-quiet { opacity: 0.7; }
  .ct-row:hover { background: var(--ct-hairline); }

  .ct-row-main {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 12px;
  }

  .ct-chip {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
    background: var(--ct-chip-neutral-bg);
    color: var(--ct-chip-neutral-fg);
  }
  .ct-chip.kind-executed   { background: var(--ct-executed-bg);   color: var(--ct-executed-fg); }
  .ct-chip.kind-reflected  { background: var(--ct-reflected-bg);  color: var(--ct-reflected-fg); }
  .ct-chip.kind-clarifying { background: var(--ct-clarifying-bg); color: var(--ct-clarifying-fg); }
  .ct-chip.kind-held       { background: var(--ct-held-bg);       color: var(--ct-held-fg); }

  .ct-body { flex: 1; min-width: 0; }
  .ct-title {
    font-size: 14px;
    font-weight: 500;
    line-height: 1.35;
    color: var(--ct-text);
  }
  .ct-explanation {
    font-size: 14px;
    line-height: 1.4;
    color: var(--ct-text-secondary);
  }

  .ct-caret {
    flex-shrink: 0;
    align-self: center;
    font-size: 12px;
    color: var(--ct-text-secondary);
    transition: transform 0.15s;
  }
  .ct-row.expanded .ct-caret { transform: rotate(90deg); }

  .ct-detail {
    border-top: 0.5px solid var(--ct-hairline);
    padding: 10px 12px 12px 50px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ct-detail-text {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ct-text);
  }
  .ct-technical-toggle {
    align-self: flex-start;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 9px;
    border-radius: 6px;
    border: 1px solid var(--ct-border);
    background: transparent;
    color: var(--ct-text-secondary);
    cursor: pointer;
  }
  .ct-technical-toggle:hover { background: var(--ct-hairline); }
  .ct-technical {
    margin: 0;
    padding: 9px 11px;
    border-radius: 7px;
    background: var(--ct-technical-bg);
    color: var(--ct-technical-fg);
    font-family: "SFMono-Regular", ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-x: auto;
  }

  @media (prefers-color-scheme: dark) {
    .coach-trace {
      --ct-bg: #1a1916;
      --ct-header-bg: #201e1a;
      --ct-border: #33302b;
      --ct-hairline: rgba(255, 255, 255, 0.08);
      --ct-text: #ece9e2;
      --ct-text-secondary: #9c978d;
      --ct-chip-neutral-bg: #33302b;
      --ct-chip-neutral-fg: #b6b1a7;
      --ct-executed-bg: #16321f;
      --ct-executed-fg: #6bcf8f;
      --ct-reflected-bg: #241d38;
      --ct-reflected-fg: #b299f0;
      --ct-clarifying-bg: #14283a;
      --ct-clarifying-fg: #7bbdf0;
      --ct-held-bg: #352a12;
      --ct-held-fg: #e2b45c;
      --ct-technical-bg: #100f0d;
      --ct-technical-fg: #d8d4cc;
    }
  }
`;

interface CoachTraceProps {
  events: TraceEvent[];
  /** Optional: start collapsed. Defaults to open so the timeline is visible. */
  defaultOpen?: boolean;
}

/**
 * User-facing timeline of the coach's decisions. Renders ONLY catalog strings
 * from each TraceEvent — never model prose, never a raw debug blob. `reason` and
 * `technical` appear only behind the on-demand "Show technical detail" toggle.
 * This is a separate panel from the developer `.map-debug` view.
 */
export function CoachTrace({ events, defaultOpen = true }: CoachTraceProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [technicalOpen, setTechnicalOpen] = useState<Set<string>>(new Set());

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTechnical(id: string) {
    setTechnicalOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="coach-trace">
      <style>{COACH_TRACE_CSS}</style>
      <div
        className="coach-trace-header"
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
        title="What the coach did and why"
      >
        <span className="coach-trace-title">Coach trace</span>
        {events.length > 0 && <span className="coach-trace-count">{events.length}</span>}
        <span className="coach-trace-caret">{open ? "▾" : "▸"}</span>
      </div>

      {open && (
        <div className="coach-trace-list">
          {events.length === 0 ? (
            <div className="coach-trace-empty">
              As we talk, I'll note what I did and why here.
            </div>
          ) : (
            events.map((event) => {
              const isExpanded = expanded.has(event.id);
              const showTechnical = technicalOpen.has(event.id);
              const canExpand = Boolean(event.detail || event.technical);
              return (
                <div key={event.id}>
                  <button
                    type="button"
                    className={`ct-row level-${event.level}${isExpanded ? " expanded" : ""}`}
                    onClick={() => canExpand && toggleRow(event.id)}
                    aria-expanded={canExpand ? isExpanded : undefined}
                  >
                    <div className="ct-row-main">
                      <span className={`ct-chip kind-${chipKind(event)}`} aria-hidden="true">
                        {glyphFor(event.icon)}
                      </span>
                      <span className="ct-body">
                        <span className="ct-title">{event.title}</span>
                        <span className="ct-explanation">{event.explanation}</span>
                      </span>
                      {canExpand && <span className="ct-caret" aria-hidden="true">›</span>}
                    </div>
                  </button>

                  {isExpanded && canExpand && (
                    <div className="ct-detail">
                      {event.detail && <div className="ct-detail-text">{event.detail}</div>}
                      {event.technical && (
                        <>
                          <button
                            type="button"
                            className="ct-technical-toggle"
                            onClick={() => toggleTechnical(event.id)}
                            aria-expanded={showTechnical}
                          >
                            {showTechnical ? "Hide technical detail" : "Show technical detail"}
                          </button>
                          {showTechnical && (
                            <pre className="ct-technical">
                              {JSON.stringify({ reason: event.reason, ...event.technical }, null, 2)}
                            </pre>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default CoachTrace;
