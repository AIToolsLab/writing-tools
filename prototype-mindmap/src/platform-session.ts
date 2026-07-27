/// <reference types="vite/client" />

export const PLATFORM_SESSION_STORAGE_KEY = "prototype-mindmap-platform-session-v1";
export const PLATFORM_SESSION_VERSION = 1;

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;
export const PLATFORM_BACKEND_URL =
  (viteEnv?.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:8000/api";

export interface PlatformDocContext {
  documentLabel?: string;
  beforeCursor: string;
  selectedText: string;
  afterCursor: string;
  contextData?: unknown;
}

export type LaunchDecision = "continue_saved" | "start_new";

export interface PlatformSession {
  version: 1;
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

export function grantFromHash(hash: string): string | null {
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
    if (key !== "wt_grant") continue;
    return value || null;
  }
  return null;
}

export function hashWithoutGrant(hash: string): string {
  const kept = hash
    .replace(/^#/, "")
    .split("&")
    .filter((part) => {
      try {
        return decodeURIComponent(part.split("=")[0] || "") !== "wt_grant";
      } catch {
        return true;
      }
    })
    .filter(Boolean);
  return kept.length ? `#${kept.join("&")}` : "";
}

export function scrubGrantFromUrl(
  location: Pick<Location, "pathname" | "search" | "hash">,
  history: Pick<History, "replaceState" | "state">,
): void {
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${location.search}${hashWithoutGrant(location.hash)}`,
  );
}

export function launchRequired(
  env: { PROD?: boolean; VITE_REQUIRE_LAUNCH?: string | boolean } = viteEnv ?? {},
): boolean {
  const explicit = env?.VITE_REQUIRE_LAUNCH;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return env?.PROD === true;
}

export function readPlatformSession(storage: Pick<Storage, "getItem">): PlatformSession | null {
  try {
    const parsed = JSON.parse(storage.getItem(PLATFORM_SESSION_STORAGE_KEY) ?? "null") as unknown;
    if (!isRecord(parsed)) return null;
    if (
      parsed.version !== PLATFORM_SESSION_VERSION ||
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
      version: 1,
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
  let response: Response;
  try {
    response = await fetcher(
      `${options.backendUrl ?? PLATFORM_BACKEND_URL}/handoff/exchange`,
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
    version: 1,
    accessToken: body.access_token,
    expiresAt: now + body.expires_in * 1000,
    scopes,
    doc,
    capturedAt: now,
  };
}
