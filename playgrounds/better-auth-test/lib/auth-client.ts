import { createAuthClient } from "better-auth/react";

// baseURL tells the client where to send auth requests.
// Must match BETTER_AUTH_URL and the dev server port (3001).
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001",
});
