import { useEffect, useRef, useState } from "react";
// The real trace contract lives in ./trace (owned by coder 1). Re-export it so
// existing `import { deriveTraceEvent, type TraceEvent } from "./CoachTrace"`
// call sites keep resolving.
import { deriveTraceEvent, type TraceEvent, type TraceLevel } from "./trace";

export { deriveTraceEvent };
export type { TraceEvent, TraceLevel };

type ChipKind = "executed" | "reflected" | "clarifying" | "neutral" | "held" | "quiet";

function chipKind(event: TraceEvent): ChipKind {
  // Level wins first, so a held/quiet event keeps its calm tint regardless of
  // which icon the catalog picked (e.g. pause/sprout under a held reflection).
  if (event.level === "held") return "held";
  if (event.level === "quiet") return "quiet";
  switch (event.icon) {
    case "check":
      return "executed";
    case "reflect":
      return "reflected";
    case "help":
    case "link":
      return "clarifying";
    default:
      return "neutral";
  }
}

// Monochrome glyphs that inherit the chip's text color so the level tint reads
// cleanly. Covers every icon key the real catalog can emit (trace.ts) — the
// `?? icon` fallback below must never fire for a real event.
const ICON_GLYPH: Record<string, string> = {
  check: "✓",
  reflect: "◑",
  pause: "❙❙",
  sprout: "☘",
  pace: "◷",
  pin: "⊙",
  compass: "✦",
  refresh: "↻",
  chat: "…",
  help: "?",
  link: "↔",
  pencil: "✎",
  x: "✕",
  target: "◎",
};

function glyphFor(icon: string): string {
  return ICON_GLYPH[icon] ?? icon;
}

const COACH_TRACE_CSS = `
  .coach-trace-status-wrap {
    /* Light-mode defaults; overridden by the dark-mode block below. */
    --ct-bg: #fbfbf9;
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

    position: relative;
    display: flex;
    min-width: 0;
    flex: 0 1 auto;
  }

  /* ---- compact live status pill ---- */
  .coach-trace-status {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 320px;
    min-width: 0;
    padding: 5px 9px;
    border-radius: 8px;
    border: 1px solid var(--ct-border);
    background: var(--ct-bg);
    color: var(--ct-text);
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  button.coach-trace-status:hover { border-color: var(--ct-text-secondary); }
  .coach-trace-status.placeholder { cursor: default; opacity: 0.7; }
  .coach-trace-status.level-held    { background: var(--ct-held-bg);       border-color: color-mix(in srgb, var(--ct-held-fg) 30%, var(--ct-border)); }
  .coach-trace-status.level-notice  { background: var(--ct-bg); }
  .coach-trace-status.level-quiet   { background: var(--ct-bg); opacity: 0.85; }

  .ct-status-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.25;
  }
  .ct-status-title {
    display: block;
    font-size: 12px;
    font-weight: 700;
    color: var(--ct-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ct-status-explanation {
    display: block;
    font-size: 11px;
    color: var(--ct-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ct-status-count {
    flex-shrink: 0;
    margin-left: 2px;
    font-size: 10px;
    font-weight: 700;
    color: var(--ct-text-secondary);
    background: var(--ct-chip-neutral-bg);
    border-radius: 99px;
    padding: 1px 6px;
  }

  /* ---- shared chip ---- */
  .ct-chip {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    background: var(--ct-chip-neutral-bg);
    color: var(--ct-chip-neutral-fg);
  }
  .ct-chip.kind-executed   { background: var(--ct-executed-bg);   color: var(--ct-executed-fg); }
  .ct-chip.kind-reflected  { background: var(--ct-reflected-bg);  color: var(--ct-reflected-fg); }
  .ct-chip.kind-clarifying { background: var(--ct-clarifying-bg); color: var(--ct-clarifying-fg); }
  .ct-chip.kind-held       { background: var(--ct-held-bg);       color: var(--ct-held-fg); }

  /* ---- history popover ---- */
  .coach-trace-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 50;
    width: 400px;
    max-width: min(400px, calc(100vw - 32px));
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--ct-bg);
    border: 1px solid var(--ct-border);
    border-radius: 10px;
    box-shadow: 0 14px 36px rgba(30, 30, 30, 0.16);
    overflow: hidden;
  }
  .coach-trace-popover-title {
    flex-shrink: 0;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ct-text-secondary);
    border-bottom: 1px solid var(--ct-hairline);
    background: var(--ct-bg);
  }
  .coach-trace-popover-list {
    overflow-y: auto;
    min-height: 0;
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
  .ct-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .ct-title {
    display: block;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.35;
    color: var(--ct-text);
  }
  .ct-explanation {
    display: block;
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
    padding: 10px 12px 12px 46px;
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
    .coach-trace-status-wrap {
      --ct-bg: #1a1916;
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

/**
 * One history row: collapsed = title + explanation; click to reveal detail, then
 * a ghost toggle for the technical block. `reason` and raw keys live only inside
 * `technical`, shown on demand — never in the default/expanded copy.
 */
function TraceRow({ event }: { event: TraceEvent }) {
  const [expanded, setExpanded] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const canExpand = Boolean(event.detail || event.technical);

  return (
    <div>
      <button
        type="button"
        className={`ct-row level-${event.level}${expanded ? " expanded" : ""}`}
        onClick={() => canExpand && setExpanded((v) => !v)}
        aria-expanded={canExpand ? expanded : undefined}
      >
        <div className="ct-row-main">
          <span className={`ct-chip kind-${chipKind(event)}`} aria-hidden="true">
            {glyphFor(event.icon)}
          </span>
          <span className="ct-body">
            <span className="ct-title">{event.title}</span>
            <span className="ct-explanation">{event.explanation}</span>
          </span>
          {canExpand && (
            <span className="ct-caret" aria-hidden="true">
              ›
            </span>
          )}
        </div>
      </button>

      {expanded && canExpand && (
        <div className="ct-detail">
          {event.detail && <div className="ct-detail-text">{event.detail}</div>}
          {event.technical && (
            <>
              <button
                type="button"
                className="ct-technical-toggle"
                onClick={() => setShowTechnical((v) => !v)}
                aria-expanded={showTechnical}
              >
                {showTechnical ? "Hide technical detail" : "Show technical detail"}
              </button>
              {showTechnical && (
                <pre className="ct-technical">{JSON.stringify(event.technical, null, 2)}</pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Floating history: newest first, internally scrollable, above the canvas. */
function CoachTracePopover({ events }: { events: TraceEvent[] }) {
  const ordered = [...events].reverse();
  return (
    <div className="coach-trace-popover" role="dialog" aria-label="Coach trace history">
      <div className="coach-trace-popover-title">Coach trace</div>
      <div className="coach-trace-popover-list">
        {ordered.map((event) => (
          <TraceRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

/**
 * Compact, always-visible live-status chip for the map header. Shows ONLY the
 * latest decision (title + explanation, catalog strings only — never a raw
 * reason key or model prose). Clicking opens the full history popover; the
 * technical/expand affordances live there, not on the compact chip.
 */
export function CoachTraceStatus({ events }: { events: TraceEvent[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const latest = events.length > 0 ? events[events.length - 1] : undefined;

  // Close on outside click or Escape while the history is open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // A cleared trace (e.g. Clear chat) must not leave a stale popover open.
  useEffect(() => {
    if (events.length === 0) setOpen(false);
  }, [events.length]);

  return (
    <div className="coach-trace-status-wrap" ref={wrapRef}>
      <style>{COACH_TRACE_CSS}</style>
      {latest ? (
        <button
          type="button"
          className={`coach-trace-status level-${latest.level}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="What the coach just did — click for history"
        >
          <span className={`ct-chip kind-${chipKind(latest)}`} aria-hidden="true">
            {glyphFor(latest.icon)}
          </span>
          <span className="ct-status-copy">
            <span className="ct-status-title">{latest.title}</span>
            <span className="ct-status-explanation">{latest.explanation}</span>
          </span>
          {events.length > 1 && <span className="ct-status-count">{events.length}</span>}
        </button>
      ) : (
        <div className="coach-trace-status placeholder">
          <span className="ct-status-copy">
            <span className="ct-status-title">Coach trace</span>
            <span className="ct-status-explanation">will appear here as we talk</span>
          </span>
        </div>
      )}
      {open && latest && <CoachTracePopover events={events} />}
    </div>
  );
}

export default CoachTraceStatus;
