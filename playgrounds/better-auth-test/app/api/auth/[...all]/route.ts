import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Better Auth handles all /api/auth/* routes: OAuth redirects,
// callbacks, session reads, sign-out, etc.
export const { GET, POST } = toNextJsHandler(auth);
