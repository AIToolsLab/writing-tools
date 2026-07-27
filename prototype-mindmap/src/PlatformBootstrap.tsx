import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import App from "./App";
import type { ProviderRuntimeConfig } from "./api";
import { MutationPolicyProvider } from "./mutation-policy";
import {
  clearSavedMindmap,
  savedMindmapSummary,
  type DraftSourceMetadata,
  type SavedMindmapSummary,
} from "./session-persistence";
import {
  clearPlatformSession,
  exchangeGrant,
  grantFromHash,
  GrantExchangeError,
  launchRequired,
  readPlatformSession,
  scrubGrantFromUrl,
  snapshotText,
  writePlatformSession,
  type PlatformSession,
} from "./platform-session";
import { ReaderViewProvider, useReaderView } from "./reader-view";
import { UiLocaleProvider, useUiLocale } from "./ui-locale";

type BlockingReason =
  | "launch_required"
  | "token_expired"
  | "grant_expired"
  | "grant_used"
  | "grant_invalid"
  | "network";

type BootState =
  | { kind: "connecting" }
  | { kind: "blocked"; reason: BlockingReason; detail?: string }
  | { kind: "choice"; session: PlatformSession; saved: SavedMindmapSummary }
  | {
      kind: "ready";
      session: PlatformSession | null;
      initialDraft?: { text: string; source?: DraftSourceMetadata };
    };

function ReaderMutationBoundary({ children }: { children: ReactNode }) {
  const reader = useReaderView();
  return (
    <MutationPolicyProvider
      mode={reader.isTranslatedView ? "translated_view" : "authoring"}
      onRejected={reader.reportReadOnlyRejection}
    >
      {children}
    </MutationPolicyProvider>
  );
}

function formatTime(value: number | undefined, unknownLabel: string): string {
  if (!value) return unknownLabel;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function incomingLabel(session: PlatformSession): string {
  return session.doc?.documentLabel?.trim() || "Document snapshot";
}

function initialDraft(session: PlatformSession): { text: string; source?: DraftSourceMetadata } {
  if (!session.doc) return { text: "" };
  return {
    text: snapshotText(session.doc),
    source: {
      kind: "launch_snapshot",
      documentLabel: incomingLabel(session),
      capturedAt: session.capturedAt,
    },
  };
}

function blockedCopy(reason: BlockingReason): { title: string; body: string } {
  switch (reason) {
    case "token_expired":
      return {
        title: "Your Mindmap access has expired",
        body: "Your saved mindmap is still here. Launch Mindmap again from Writing Tools, then choose your saved mindmap.",
      };
    case "grant_expired":
      return {
        title: "This launch took too long",
        body: "The two-minute launch grant expired before Mindmap could use it. Launch Mindmap again from Writing Tools.",
      };
    case "grant_used":
      return {
        title: "This launch link was already used",
        body: "Launch Mindmap again from Writing Tools to create a fresh link.",
      };
    case "grant_invalid":
      return {
        title: "This launch link is invalid",
        body: "Launch Mindmap again from Writing Tools.",
      };
    case "network":
      return {
        title: "Mindmap could not reach Writing Tools",
        body: "Check the connection and retry. If the link was consumed, launch Mindmap again.",
      };
    default:
      return {
        title: "Launch Mindmap from Writing Tools",
        body: "Open the Tools page in Writing Tools and launch Mindmap to connect your account.",
      };
  }
}

/**
 * Root error boundary. `Map.tsx` guards the canvas, but nothing sat above `App`, so any
 * throw during render blanked the page with no way back — the failure shape behind the
 * blank-map incident.
 *
 * It deliberately does NOT clear storage. A render crash must leave the saved mindmap
 * exactly as intact as a token expiry does, so reloading resumes the session rather
 * than starting the user over. If the crash is itself caused by bad persisted state,
 * that is a bug to fix in the loader's validation, not something to paper over here by
 * destroying the user's work.
 *
 * Class component because React exposes no hook equivalent for `componentDidCatch`.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Mindmap crashed during render.", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // Plain strings, not `t()`: the locale provider sits inside this boundary, and a
    // crash there would make the fallback itself throw.
    return (
      <main className="platform-gate">
        <h1>Mindmap hit an unexpected error</h1>
        <p>
          Your saved mindmap has not been changed. Reloading should bring it back — if
          this keeps happening, relaunch Mindmap from Writing Tools.
        </p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </main>
    );
  }
}

function initialBootState(): BootState {
  if (typeof window === "undefined") return { kind: "connecting" };
  const hasGrant = Boolean(grantFromHash(window.location.hash));
  const stored = readPlatformSession(window.sessionStorage);
  if (hasGrant) return { kind: "connecting" };
  if (stored) {
    const saved = savedMindmapSummary(window.localStorage);
    if (!stored.decision && saved) return { kind: "choice", session: stored, saved };
    return {
      kind: "ready",
      session: stored,
      ...(stored.decision === "start_new" && !saved
        ? { initialDraft: initialDraft(stored) }
        : {}),
    };
  }
  return launchRequired()
    ? { kind: "blocked", reason: "launch_required" }
    : { kind: "ready", session: null };
}

export default function PlatformBootstrap() {
  return (
    <UiLocaleProvider>
      <PlatformBootstrapContent />
    </UiLocaleProvider>
  );
}

function PlatformBootstrapContent() {
  const { t } = useUiLocale();
  const [boot, setBoot] = useState<BootState>(initialBootState);
  const [accessDenied, setAccessDenied] = useState(false);
  const exchangeStarted = useRef(false);

  useEffect(() => {
    const grant = grantFromHash(window.location.hash);
    if (!grant || exchangeStarted.current) return;
    exchangeStarted.current = true;
    void exchangeGrant(grant)
      .then((session) => {
        writePlatformSession(window.sessionStorage, session);
        scrubGrantFromUrl(window.location, window.history);
        const saved = savedMindmapSummary(window.localStorage);
        if (saved) {
          setBoot({ kind: "choice", session, saved });
          return;
        }
        const decided = { ...session, decision: "start_new" as const };
        writePlatformSession(window.sessionStorage, decided);
        setBoot({ kind: "ready", session: decided, initialDraft: initialDraft(decided) });
      })
      .catch((error: unknown) => {
        if (error instanceof GrantExchangeError) {
          const reason: BlockingReason =
            error.code === "expired"
              ? "grant_expired"
              : error.code === "already_used"
                ? "grant_used"
                : error.code === "network"
                  ? "network"
                  : "grant_invalid";
          setBoot({ kind: "blocked", reason, detail: error.message });
          return;
        }
        setBoot({ kind: "blocked", reason: "network", detail: String(error) });
      });
  }, []);

  const chooseContinue = useCallback((session: PlatformSession) => {
    const decided = { ...session, decision: "continue_saved" as const };
    writePlatformSession(window.sessionStorage, decided);
    setBoot({ kind: "ready", session: decided });
  }, []);

  const chooseStartNew = useCallback((session: PlatformSession) => {
    clearSavedMindmap(window.localStorage);
    const decided = { ...session, decision: "start_new" as const };
    writePlatformSession(window.sessionStorage, decided);
    setBoot({ kind: "ready", session: decided, initialDraft: initialDraft(decided) });
  }, []);

  const onAccessError = useCallback((status: 401 | 403) => {
    if (status === 403) {
      setAccessDenied(true);
      return;
    }
    clearPlatformSession(window.sessionStorage);
    setBoot({ kind: "blocked", reason: "token_expired" });
  }, []);

  const providerRuntime = useMemo<ProviderRuntimeConfig | undefined>(() => {
    if (boot.kind !== "ready" || !boot.session) return undefined;
    return {
      bearerToken: boot.session.accessToken,
      onAccessError,
    };
  }, [boot, onAccessError]);

  if (boot.kind === "connecting") {
    return <main className="platform-gate"><h1>{t("Connecting to Writing Tools…")}</h1></main>;
  }

  if (boot.kind === "blocked") {
    const copy = blockedCopy(boot.reason);
    return (
      <main className="platform-gate">
        <h1>{t(copy.title)}</h1>
        <p>{t(copy.body)}</p>
        {boot.detail && <p className="platform-detail">{boot.detail}</p>}
        {boot.reason === "network" && (
          <button type="button" onClick={() => window.location.reload()}>{t("Retry")}</button>
        )}
      </main>
    );
  }

  if (boot.kind === "choice") {
    const hasIncomingDocument = boot.session.doc !== null;
    return (
      <main className="platform-gate platform-choice">
        <h1>{t("Which mindmap would you like to open?")}</h1>
        <button type="button" onClick={() => chooseContinue(boot.session)}>
          <strong>{t("Continue “{document}”").replace("{document}", t(boot.saved.documentLabel))}</strong>
          <span>{t("Last saved {time}").replace("{time}", formatTime(boot.saved.lastSavedAt, t("time unknown")))}</span>
        </button>
        <button type="button" onClick={() => chooseStartNew(boot.session)}>
          <strong>
            {hasIncomingDocument
              ? t("Start new from “{document}”").replace("{document}", t(incomingLabel(boot.session)))
              : t("Start a new empty mindmap—no document shared")}
          </strong>
          <span>{t("Launched {time}").replace("{time}", formatTime(boot.session.capturedAt, t("time unknown")))}</span>
        </button>
      </main>
    );
  }

  return (
    <AppErrorBoundary>
      <ReaderViewProvider providerRuntime={providerRuntime} disabled={accessDenied}>
        <ReaderMutationBoundary>
          <App
            providerRuntime={providerRuntime}
            initialDraft={boot.initialDraft}
            aiAccessDenied={accessDenied}
          />
        </ReaderMutationBoundary>
      </ReaderViewProvider>
    </AppErrorBoundary>
  );
}
