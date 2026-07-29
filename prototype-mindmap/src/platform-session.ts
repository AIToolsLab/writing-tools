/// <reference types="vite/client" />

// v2 — the session now records the backend it belongs to (see `backendUrl` below).
export const PLATFORM_SESSION_STORAGE_KEY = "prototype-mindmap-platform-session-v2";
export const PLATFORM_SESSION_VERSION = 2;

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;

/**
 * Fallback backend for a launch that didn't name one (a direct visit, the eval runner,
 * dev). A production bundle that quietly falls back to localhost points every user's
 * browser at their own machine — a confusing per-request failure rather than an obvious
 * one — so a PROD build without `VITE_BACKEND_URL` throws at module load, where the
 * first smoke check catches it.
 *
 * Launches from the sidebar don't use this: the platform names its own API base in the
 * launch fragment (`wt_api`), which is what makes one hosted bundle usable against
 * prod, staging and a developer's localhost without a rebuild.
 */
export function resolveBackendUrl(
  env: { PROD?: boolean; VITE_BACKEND_URL?: string | boolean } = viteEnv ?? {},
): string {
  const configured = typeof env?.VITE_BACKEND_URL === "string" ? env.VITE_BACKEND_URL.trim() : "";
  if (configured) return configured;
  if (env?.PROD === true) {
    throw new Error("VITE_BACKEND_URL must be set for production builds of the mindmap.");
  }
  return "http://localhost:8000/api";
}

export const PLATFORM_BACKEND_URL = resolveBackendUrl();

/**
 * Normalize a platform API base offered by a launch, or null if it isn't usable.
 *
 * The launcher puts its own API base in the fragment, so the tool follows the platform
 * that launched it rather than a URL baked in at build time. That value is
 * attacker-supplyable (anyone can craft a link to this page), which is survivable but
 * not free: a hostile base can't mint a real token, but it *can* serve a fake document
 * and collect whatever the writer does next. Two things contain it — the session
 * records its own backend so a hostile launch can never reuse a genuine session (see
 * `PlatformSession.backendUrl`), and plaintext is refused here so the base can't be
 * downgraded to http on the way.
 */
export function normalizePlatformApiBase(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export interface PlatformDocContext {
  documentLabel?: string;
  beforeCursor: string;
  selectedText: string;
  afterCursor: string;
  contextData?: unknown;
}

export type LaunchDecision = "continue_saved" | "start_new";

export interface PlatformSession {
  version: 2;
  /**
   * The platform this session was obtained from. Every later call uses it rather than
   * a build-time constant, which both frees one bundle to serve several deployments
   * and keeps a token from ever being presented to a backend that didn't issue it.
   */
  backendUrl: string;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  doc: PlatformDocContext | null;
  capturedAt: number;
  decision?: LaunchDecision;
}

export type GrantExchangeErrorCode =
  | "expired"
  | "already_used"
  | "invalid"
  | "network";

export class GrantExchangeError extends Error {
  constructor(readonly code: GrantExchangeErrorCode, message: string) {
    super(message);
    this.name = "GrantExchangeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validDocContext(value: unknown): PlatformDocContext | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.beforeCursor !== "string" ||
    typeof value.selectedText !== "string" ||
    typeof value.afterCursor !== "string"
  ) return null;
  if (value.documentLabel !== undefined && typeof value.documentLabel !== "string") return null;
  return {
    beforeCursor: value.beforeCursor,
    selectedText: value.selectedText,
    afterCursor: value.afterCursor,
    ...(typeof value.documentLabel === "string" ? { documentLabel: value.documentLabel } : {}),
  };
}

export function snapshotText(doc: PlatformDocContext | null): string {
  return doc ? `${doc.beforeCursor}${doc.selectedText}${doc.afterCursor}` : "";
}

/** Fragment keys the launcher writes, and `scrubLaunchParamsFromUrl` removes. */
const LAUNCH_PARAM_KEYS = ["wt_grant", "wt_api"] as const;

function hashParam(hash: string, wanted: string): string | null {
  const parts = hash.replace(/^#/, "").split("&");
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.split("=");
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey || "");
      value = decodeURIComponent(rawValue.join("="));
    } catch {
      continue;
    }
    if (key !== wanted) continue;
    return value || null;
  }
  return null;
}

export function grantFromHash(hash: string): string | null {
  return hashParam(hash, "wt_grant");
}

/**
 * The platform API base the launcher named, or null when the launch didn't name one
 * (or named an unusable one, which is refused rather than trusted — see
 * `normalizePlatformApiBase`). Callers fall back to `PLATFORM_BACKEND_URL`.
 */
export function apiBaseFromHash(hash: string): string | null {
  return normalizePlatformApiBase(hashParam(hash, "wt_api"));
}

export function hashWithoutLaunchParams(hash: string): string {
  const kept = hash
    .replace(/^#/, "")
    .split("&")
    .filter((part) => {
      try {
        const key = decodeURIComponent(part.split("=")[0] || "");
        return !(LAUNCH_PARAM_KEYS as readonly string[]).includes(key);
      } catch {
        return true;
      }
    })
    .filter(Boolean);
  return kept.length ? `#${kept.join("&")}` : "";
}

export function scrubLaunchParamsFromUrl(
  location: Pick<Location, "pathname" | "search" | "hash">,
  history: Pick<History, "replaceState" | "state">,
): void {
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}${hashWithoutLaunchParams(location.hash)}`,
  );
}

export function launchRequired(
  env: { PROD?: boolean; VITE_REQUIRE_LAUNCH?: string | boolean } = viteEnv ?? {},
): boolean {
  // Production always requires a launch, and `VITE_REQUIRE_LAUNCH=false` cannot turn
  // that off. The override exists for dev servers and Playwright; honouring it in a
  // PROD build would let one stray env var ship an ungated bundle, with nothing at
  // runtime to signal that the gate was disabled.
  if (env?.PROD === true) return true;
  return env?.VITE_REQUIRE_LAUNCH === "true";
}

export function readPlatformSession(storage: Pick<Storage, "getItem">): PlatformSession | null {
  try {
    const parsed = JSON.parse(storage.getItem(PLATFORM_SESSION_STORAGE_KEY) ?? "null") as unknown;
    if (!isRecord(parsed)) return null;
    // A stored session names its own backend; anything else would let a session
    // obtained from one platform be replayed against another.
    const backendUrl = normalizePlatformApiBase(parsed.backendUrl);
    if (
      parsed.version !== PLATFORM_SESSION_VERSION ||
      !backendUrl ||
      typeof parsed.accessToken !== "string" ||
      !parsed.accessToken.startsWith("wtk_") ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      typeof parsed.capturedAt !== "number" ||
      !Number.isFinite(parsed.capturedAt) ||
      !Array.isArray(parsed.scopes) ||
      !parsed.scopes.every((scope) => typeof scope === "string") ||
      !parsed.scopes.includes("openai:chat")
    ) return null;
    const hasDocRead = parsed.scopes.includes("doc:read");
    const doc = hasDocRead && parsed.doc !== null ? validDocContext(parsed.doc) : null;
    if (hasDocRead && parsed.doc !== null && !doc) return null;
    const decision =
      parsed.decision === "continue_saved" || parsed.decision === "start_new"
        ? parsed.decision
        : undefined;
    return {
      version: 2,
      backendUrl,
      accessToken: parsed.accessToken,
      expiresAt: parsed.expiresAt,
      capturedAt: parsed.capturedAt,
      scopes: parsed.scopes as string[],
      doc,
      ...(decision ? { decision } : {}),
    };
  } catch {
    return null;
  }
}

export function writePlatformSession(
  storage: Pick<Storage, "setItem">,
  session: PlatformSession,
): void {
  storage.setItem(PLATFORM_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearPlatformSession(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(PLATFORM_SESSION_STORAGE_KEY);
}

export async function exchangeGrant(
  grantId: string,
  options: {
    fetcher?: typeof fetch;
    backendUrl?: string;
    now?: () => number;
  } = {},
): Promise<PlatformSession> {
  const fetcher = options.fetcher ?? fetch;
  // The launch names the platform; a direct visit falls back to the build-time value.
  const backendUrl = options.backendUrl ?? PLATFORM_BACKEND_URL;
  let response: Response;
  try {
    response = await fetcher(
      `${backendUrl}/handoff/exchange`,
      {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_id: grantId }),
      },
    );
  } catch (error) {
    throw new GrantExchangeError(
      "network",
      error instanceof Error ? error.message : "Could not reach Writing Tools.",
    );
  }

  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const serverCode = body.error;
    const code: GrantExchangeErrorCode =
      serverCode === "expired"
        ? "expired"
        : serverCode === "already_used"
          ? "already_used"
          : "invalid";
    throw new GrantExchangeError(code, typeof body.detail === "string" ? body.detail : "Grant exchange failed.");
  }

  const scopes = Array.isArray(body.scopes) && body.scopes.every((scope) => typeof scope === "string")
    ? body.scopes as string[]
    : [];
  if (
    typeof body.access_token !== "string" ||
    !body.access_token.startsWith("wtk_") ||
    body.client_id !== "mindmap" ||
    typeof body.expires_in !== "number" ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0 ||
    !scopes.includes("openai:chat")
  ) {
    throw new GrantExchangeError("invalid", "Writing Tools returned an invalid mindmap session.");
  }

  const hasDocRead = scopes.includes("doc:read");
  const doc = hasDocRead && body.doc != null ? validDocContext(body.doc) : null;
  if (hasDocRead && body.doc != null && !doc) {
    throw new GrantExchangeError("invalid", "Writing Tools returned an invalid document snapshot.");
  }
  const now = (options.now ?? Date.now)();
  return {
    version: 2,
    backendUrl,
    accessToken: body.access_token,
    expiresAt: now + body.expires_in * 1000,
    scopes,
    doc,
    capturedAt: now,
  };
}
