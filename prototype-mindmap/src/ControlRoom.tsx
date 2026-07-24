// ---------------------------------------------------------------------------
// Control Room ("under the hood") panel
//
// A read-only diagnostics surface. It renders a diagnostic snapshot produced by
// `buildDiagnosticSnapshot` (the selector lives in App) plus provenance totals;
// it never authors a map write. The only outward actions it emits are
// coach-steering requests and idea dismiss/restore, all routed back through
// props. Extracted from App.tsx to keep that file focused and to isolate the
// Control Room surface for the session-digest work.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { UserRequestedMode } from "./llm-contract";
import type { ProvenanceTotals } from "./provenance-summary";
import { useMutationAccess } from "./mutation-policy";
import { useUiLocale } from "./ui-locale";
import type { SafetyCheck, TrackedIdea, UnderhoodEvent, UnderstandingSnapshot } from "./understanding";

function targetLabel(target: TrackedIdea["target"]): string {
  return target === "idea" ? "idea" : target === "hierarchy" ? "nesting" : "connection";
}

function eventStageMark(stage: NonNullable<UnderhoodEvent["stage"]>): string {
  return {
    noticed: "1",
    tracked: "2",
    checked: "3",
    held: "!",
    chosen: ">",
  }[stage];
}

function eventStage(event: UnderhoodEvent): NonNullable<UnderhoodEvent["stage"]> {
  const stage = event.stage as UnderhoodEvent["stage"] | undefined;
  if (stage) return stage;
  if (event.state === "held") return "held";
  if (event.state === "chosen") return "chosen";
  if (event.state === "passed") return "checked";
  return "noticed";
}

function underhoodTabLabel(snapshot: UnderstandingSnapshot | null): string {
  if (!snapshot) return "Control Room";
  return snapshot.activeEvents[0]?.title ?? snapshot.latest.title ?? "Control Room";
}

/**
 * The user-facing "next move" controls. Deliberately labelled in plain user
 * verbs - never stance names, candidate gists, or model prose - so the user can
 * steer (and unstick) the coach without being anchored on AI scaffolding. This
 * emits only a coach-steering request; it never authors a map write.
 */
const NEXT_MOVE_OPTIONS: { mode: UserRequestedMode; label: string; hint: string }[] = [
  { mode: "mirror", label: "Reflect back", hint: "Sum up what I've said so far" },
  { mode: "deepen", label: "Go deeper", hint: "Dig into the idea on the table" },
  { mode: "organize", label: "Connect ideas", hint: "Ask how my thoughts relate" },
  { mode: "pivot", label: "Ask differently", hint: "Same subject, a fresh angle" },
];

type UnderhoodSectionId =
  | "nextMove"
  | "provenance"
  | "latest"
  | "mattered"
  | "ideas"
  | "ignoredIdeas"
  | "waiting"
  | "safety"
  | "draftAnchors";

const STATIC_SAFETY_LABEL = "I won't change your map unless you ask me to.";

function isStaticSafetyCheck(check: SafetyCheck): boolean {
  return check.state === "ok" && check.label === STATIC_SAFETY_LABEL;
}

function UnderhoodSection({
  title,
  meta,
  collapsed,
  onToggle,
  className = "",
  children,
}: {
  title: string;
  meta?: string | number;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`underhood-section ${collapsed ? "collapsed" : ""} ${className}`.trim()}>
      <button
        type="button"
        className="underhood-section-title"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="section-title-main">
          <span className={`section-chevron ${collapsed ? "collapsed" : "expanded"}`} aria-hidden="true" />
          <span className="section-title-text">{title}</span>
        </span>
        {meta !== undefined && <span className="section-meta">{meta}</span>}
      </button>
      {!collapsed && children}
    </section>
  );
}

export function UnderTheHoodPanel({
  snapshot,
  onDraftAnchor,
  onRequestMode,
  onDismissIdea,
  onRestoreIdea,
  busy = false,
  open: controlledOpen,
  onOpenChange,
  provenance,
}: {
  snapshot: UnderstandingSnapshot | null;
  onDraftAnchor: (anchor: string) => void;
  onRequestMode?: (mode: UserRequestedMode) => void;
  onDismissIdea?: (ideaId: string) => void;
  onRestoreIdea?: (ideaId: string) => void;
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  provenance?: ProvenanceTotals;
}) {
  const { t } = useUiLocale();
  const readOnly = useMutationAccess().mode === "translated_view";
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );
  const [activeEvent, setActiveEvent] = useState(0);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [sectionCollapsed, setSectionCollapsed] = useState<Partial<Record<UnderhoodSectionId, boolean>>>({});
  const events = useMemo(
    () => (snapshot?.activeEvents ?? []).filter((event) => event.kind !== "question_chosen"),
    [snapshot?.activeEvents],
  );
  const safetyChecks = snapshot?.safetyChecks ?? [];
  const showSafetyChecks =
    safetyChecks.length > 0 && !safetyChecks.every((check) => isStaticSafetyCheck(check));

  function sectionIsCollapsed(id: UnderhoodSectionId, defaultCollapsed = false): boolean {
    return sectionCollapsed[id] ?? defaultCollapsed;
  }

  function toggleSection(id: UnderhoodSectionId, defaultCollapsed = false) {
    setSectionCollapsed((current) => ({
      ...current,
      [id]: !(current[id] ?? defaultCollapsed),
    }));
  }

  useEffect(() => {
    setExpandedEvents(new Set());
    if (!snapshot || !open) {
      setActiveEvent(0);
      return;
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setActiveEvent(events.length);
      return;
    }
    setActiveEvent(0);
    const timers = events.map((_, index) =>
      window.setTimeout(() => setActiveEvent(index + 1), 220 + index * 260),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [events, open, snapshot]);

  function toggleEventDetail(id: string) {
    setExpandedEvents((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`underhood-tab ${snapshot ? "live" : ""}`}
        onClick={() => setOpen(true)}
        aria-label={t("Open Control Room panel")}
      >
        {underhoodTabLabel(snapshot)}
      </button>
    );
  }

  return (
    <aside className="underhood-panel" aria-label={t("Control Room")}>
      <div className="underhood-head">
        <div className="underhood-title">
          <strong>{t("Control Room")}</strong>
          <span>{snapshot?.banner ?? t("This will show what the coach is considering as we talk.")}</span>
        </div>
        <button
          type="button"
          className="underhood-close"
          onClick={() => setOpen(false)}
          aria-label={t("Close Control Room panel")}
        >
          x
        </button>
      </div>

      {onRequestMode && (
        <UnderhoodSection
          title={t("Steer the coach")}
          collapsed={sectionIsCollapsed("nextMove")}
          onToggle={() => toggleSection("nextMove")}
          className="underhood-nextmove"
        >
          <div className="nextmove-list">
            {NEXT_MOVE_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                className={`nextmove-button mode-${option.mode}`}
                onClick={() => onRequestMode(option.mode)}
                disabled={readOnly || busy}
                title={t(option.hint)}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        </UnderhoodSection>
      )}

      {!snapshot ? (
        <div className="underhood-empty">
          {t("Start a turn and I'll show the read-only checks, tracked ideas, and safety gates here.")}
        </div>
      ) : (
        <div className="underhood-body">
          {provenance && provenance.total > 0 && (
            <UnderhoodSection title={t("Map provenance")} meta={provenance.total} collapsed={sectionIsCollapsed("provenance")} onToggle={() => toggleSection("provenance")}>
              <div className="event-list">
                <div className="event-row provenance-row revealed"><span className="event-title">{t("Your contributions")}</span><span className="section-meta">{provenance.userAuthored}</span></div>
                <div className="event-row provenance-row revealed"><span className="event-title">{t("AI-connected from your words")}</span><span className="section-meta">{provenance.aiConnected}</span></div>
                <div className="event-row provenance-row revealed"><span className="event-title">{t("AI suggestions")}</span><span className="section-meta">{provenance.aiSuggested}</span></div>
              </div>
            </UnderhoodSection>
          )}
          <UnderhoodSection
            title={t("Latest move")}
            collapsed={sectionIsCollapsed("latest")}
            onToggle={() => toggleSection("latest")}
          >
            <div className="underhood-latest">
              <span className={`underhood-orb ${snapshot.latest.level}`} aria-hidden="true">
                {snapshot.latest.level === "held" ? "!" : snapshot.latest.level === "notice" ? "*" : "..."}
              </span>
              <div className="underhood-latest-text">
                <strong>{snapshot.latest.title}</strong>
                <span>{snapshot.latest.explanation}</span>
              </div>
            </div>
          </UnderhoodSection>

          {events.length > 0 && (
          <UnderhoodSection
            title={t("What mattered this turn")}
            meta={`${Math.min(activeEvent, events.length)}/${events.length}`}
            collapsed={sectionIsCollapsed("mattered")}
            onToggle={() => toggleSection("mattered")}
          >
            <div className="event-list">
              {events.map((event, index) => {
                const revealed = index < activeEvent;
                const active = index === activeEvent;
                const expanded = expandedEvents.has(event.id);
                const hasDetail = Boolean(event.technicalDetail?.length);
                const stage = eventStage(event);
                return (
                  <div
                    key={event.id}
                    className={`event-row ${event.state} stage-${stage} ${revealed ? "revealed" : ""} ${active ? "active" : ""}`}
                  >
                    <span className="event-dot">{revealed ? eventStageMark(stage) : ""}</span>
                    <span className="event-copy">
                      <span className="event-stage">{stage}</span>
                      <span className="event-title">{event.title}</span>
                      <span className="event-detail">{event.detail}</span>
                      {event.evidence && <span className="event-evidence">{event.evidence}</span>}
                      {hasDetail && revealed && (
                        <>
                          <button
                            type="button"
                            className="event-detail-toggle"
                            onClick={() => toggleEventDetail(event.id)}
                            aria-expanded={expanded}
                          >
                            {expanded ? t("Hide detail") : t("Show detail")}
                          </button>
                          {expanded && (
                            <div className="event-technical">
                              {event.technicalDetail?.map((detail) => (
                                <span key={detail}>{detail}</span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </span>
                    <span className="event-state">{revealed ? event.stateLabel : t("checking")}</span>
                  </div>
                );
              })}
            </div>
          </UnderhoodSection>
          )}

          <UnderhoodSection
            title={t("Ideas I'm tracking")}
            meta={snapshot.trackedIdeas.length}
            collapsed={sectionIsCollapsed("ideas", snapshot.trackedIdeas.length > 3)}
            onToggle={() => toggleSection("ideas", snapshot.trackedIdeas.length > 3)}
          >
            {snapshot.trackedIdeas.length === 0 ? (
              <div className="waiting-card">{t("No user-grounded ideas are being held right now.")}</div>
            ) : (
              <div className="idea-list">
                {snapshot.trackedIdeas.map((idea) => (
                  <div key={idea.id} className="idea-card">
                    <div className="idea-top">
                      <div>
                        <div className="idea-label">{idea.label}</div>
                        <span className="anchor-kind">{targetLabel(idea.target)} · {idea.status === "active" ? "in view" : "saved for later"}</span>
                      </div>
                      <div className="idea-actions">
                        {onDismissIdea && (
                          <button
                            type="button"
                            className="idea-dismiss"
                            onClick={() => onDismissIdea(idea.id)}
                            disabled={readOnly || busy}
                          >
                            {t("Dismiss")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </UnderhoodSection>

          {(snapshot.ignoredIdeas?.length ?? 0) > 0 && (
            <UnderhoodSection
              title={t("Ignored ideas")}
              meta={snapshot.ignoredIdeas.length}
              collapsed={sectionIsCollapsed("ignoredIdeas", true)}
              onToggle={() => toggleSection("ignoredIdeas", true)}
            >
              <div className="idea-list">
                {snapshot.ignoredIdeas.map((idea) => (
                  <div key={idea.id} className="idea-card">
                    <div className="idea-top">
                      <div>
                        <div className="idea-label">{idea.label}</div>
                        <span className="anchor-kind">{targetLabel(idea.target)}</span>
                      </div>
                      {onRestoreIdea && (
                        <button type="button" className="idea-dismiss" onClick={() => onRestoreIdea(idea.id)} disabled={readOnly || busy}>{t("Restore")}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </UnderhoodSection>
          )}

          {snapshot.waitingFor && (
            <UnderhoodSection
              title="Waiting for"
              collapsed={sectionIsCollapsed("waiting")}
              onToggle={() => toggleSection("waiting")}
            >
              <div className="waiting-card">{snapshot.waitingFor}</div>
            </UnderhoodSection>
          )}

          {showSafetyChecks && (
          <UnderhoodSection
            title="Safety checks"
            meta={safetyChecks.length}
            collapsed={sectionIsCollapsed("safety")}
            onToggle={() => toggleSection("safety")}
          >
            <div className="safety-list">
              {safetyChecks.map((check: SafetyCheck) => (
                <div
                  key={check.id}
                  className={`safety-row ${check.state}`}
                  aria-label={`${check.state}: ${check.label}`}
                >
                  <span className="safety-mark" />
                  <span>{check.label}</span>
                  <span className="safety-state">{check.state}</span>
                </div>
              ))}
            </div>
          </UnderhoodSection>
          )}

          {snapshot.draftAnchors.length > 0 && (
            <UnderhoodSection
              title="Draft anchors"
              meta={snapshot.draftAnchors.length}
              collapsed={sectionIsCollapsed("draftAnchors", true)}
              onToggle={() => toggleSection("draftAnchors", true)}
            >
              <div className="anchor-list">
                {snapshot.draftAnchors.map((anchor) => (
                  <button
                    key={anchor.anchor}
                    type="button"
                    className="anchor-button"
                    onClick={() => onDraftAnchor(anchor.anchor)}
                  >
                    {anchor.label}
                    <span className="anchor-kind">{anchor.kind.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            </UnderhoodSection>
          )}
        </div>
      )}
    </aside>
  );
}
