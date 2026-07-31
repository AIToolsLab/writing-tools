/// <reference types="vite/client" />

export const PLATFORM_SESSION_STORAGE_KEY = "prototype-mindmap-platform-session-v1";
export const PLATFORM_SESSION_VERSION = 1;
export const OAUTH_REQUEST_STORAGE_KEY = "prototype-mindmap-oauth-request-v1";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env;

/**
 * A production bundle that quietly falls back to localhost points every user's browser
 * at their own machine — a confusing per-request failure rather than an obvious one.
 * Fail at module load so a misconfigured deploy is caught by the first smoke check.
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

export function resolveOAuthClientId(
  env: { PROD?: boolean; VITE_OAUTH_CLIENT_ID?: string | boolean } = viteEnv ?? {},
): string {
  const configured = typeof env.VITE_OAUTH_CLIENT_ID === "string"
    ? env.VITE_OAUTH_CLIENT_ID.trim()
    : "";
  if (configured) return configured;
  if (env.PROD === true) {
    throw new Error("VITE_OAUTH_CLIENT_ID must be set for production builds of the mindmap.");
  }
  return "writing-tools-mindmap";
}

export const OAUTH_CLIENT_ID = resolveOAuthClientId();

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
    if (
      parsed.version !== PLATFORM_SESSION_VERSION ||
      typeof parsed.accessToken !== "string" ||
      !isPlatformAccessToken(parsed.accessToken) ||
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

/** Legacy handoff tokens use wtk_; OAuth access tokens are compact JWTs. */
export function isPlatformAccessToken(token: string): boolean {
  return /^wtk_[A-Za-z0-9_-]+$/.test(token) ||
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

interface OAuthRequestState {
  state: string;
  verifier: string;
  roomId: string;
  clientId: string;
  redirectUri: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

export function roomFromSearch(search: string): string | null {
  const room = new URLSearchParams(search).get("room");
  return room?.startsWith("room_") ? room : null;
}

export function oauthCallbackFromSearch(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has("code") || params.has("error");
}

function oauthBase(backendUrl = PLATFORM_BACKEND_URL): string {
  return `${backendUrl.replace(/\/$/, "")}/auth/oauth2`;
}

function oauthResource(backendUrl = PLATFORM_BACKEND_URL): string {
  return new URL(backendUrl).origin;
}

function callbackUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export async function beginRoomAuthorization(
  roomId: string,
  storage: Storage,
  backendUrl = PLATFORM_BACKEND_URL,
): Promise<void> {
  const id = OAUTH_CLIENT_ID;
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  // Keep the non-secret room hint inside the standard state parameter. Better Auth
  // signs/round-trips state but intentionally strips unknown authorize parameters.
  // The random suffix still makes the complete state value an unpredictable CSRF
  // binding, and the callback must match it byte-for-byte.
  const state = `${roomId}.${base64Url(crypto.getRandomValues(new Uint8Array(24)))}`;
  const redirectUri = callbackUri();
  const request: OAuthRequestState = { state, verifier, roomId, clientId: id, redirectUri };
  storage.setItem(OAUTH_REQUEST_STORAGE_KEY, JSON.stringify(request));
  const authorize = new URL(`${oauthBase(backendUrl)}/authorize`);
  authorize.searchParams.set("client_id", id);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openai:chat doc:read");
  authorize.searchParams.set("resource", oauthResource(backendUrl));
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", await sha256(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  window.location.assign(authorize.toString());
}

export async function finishRoomAuthorization(
  search: string,
  storage: Storage,
  options: { backendUrl?: string; now?: () => number; fetcher?: typeof fetch } = {},
): Promise<PlatformSession> {
  const params = new URLSearchParams(search);
  const oauthError = params.get("error");
  if (oauthError) throw new GrantExchangeError("invalid", params.get("error_description") || oauthError);
  const code = params.get("code");
  let request: OAuthRequestState;
  try {
    request = JSON.parse(storage.getItem(OAUTH_REQUEST_STORAGE_KEY) ?? "null") as OAuthRequestState;
  } catch {
    throw new GrantExchangeError("invalid", "The saved PKCE request is missing.");
  }
  if (!request || !code || params.get("state") !== request.state) {
    throw new GrantExchangeError("invalid", "The OAuth callback did not match this Mindmap launch.");
  }
  storage.removeItem(OAUTH_REQUEST_STORAGE_KEY);
  const backendUrl = options.backendUrl ?? PLATFORM_BACKEND_URL;
  const fetcher = options.fetcher ?? fetch;
  let tokenResponse: Response;
  try {
    tokenResponse = await fetcher(`${oauthBase(backendUrl)}/token`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        code,
        code_verifier: request.verifier,
        resource: oauthResource(backendUrl),
      }),
    });
  } catch (error) {
    throw new GrantExchangeError(
      "network",
      error instanceof Error ? error.message : "Could not reach Writing Tools.",
    );
  }
  const token = await tokenResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (
    !tokenResponse.ok ||
    typeof token.access_token !== "string" ||
    !isPlatformAccessToken(token.access_token)
  ) {
    throw new GrantExchangeError("invalid", typeof token.error_description === "string" ? token.error_description : "Token exchange failed.");
  }
  const roomId = typeof token.room_id === "string" && token.room_id.startsWith("room_")
    ? token.room_id
    : null;
  if (!roomId) throw new GrantExchangeError("invalid", "The token was not bound to a room.");
  if (roomId !== request.roomId) {
    throw new GrantExchangeError("invalid", "The token was bound to a different room than this launch.");
  }
  let roomResponse: Response;
  try {
    roomResponse = await fetcher(`${backendUrl.replace(/\/$/, "")}/rooms/${encodeURIComponent(roomId)}`, {
      credentials: "omit",
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
  } catch (error) {
    throw new GrantExchangeError(
      "network",
      error instanceof Error ? error.message : "Could not reach Writing Tools.",
    );
  }
  const room = await roomResponse.json().catch(() => ({})) as Record<string, unknown>;
  const doc = validDocContext(room.doc);
  if (!roomResponse.ok || !doc) throw new GrantExchangeError("invalid", "The authorized room could not be loaded.");
  const now = (options.now ?? Date.now)();
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : 3600;
  return {
    version: 1,
    accessToken: token.access_token,
    expiresAt: now + expiresIn * 1000,
    scopes: typeof token.scope === "string" ? token.scope.split(" ") : ["openai:chat", "doc:read"],
    doc,
    capturedAt: typeof room.updated_at === "number" ? room.updated_at : now,
  };
}

export function scrubOAuthFromUrl(
  location: Pick<Location, "pathname"> = window.location,
  history: Pick<History, "replaceState" | "state"> = window.history,
): void {
  history.replaceState(history.state, "", location.pathname);
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
