import { Hono } from "hono";
import { auth } from "../auth.js";

const protected_ = new Hono();

// Milestone 3 — verifies session from cookie or Bearer token.
// Same three cases as the Next playground:
//   cookie present      → 200 { email, name }
//   no auth             → 401 { error: "Unauthorized" }
//   Authorization:Bearer → 200 { email, name }
protected_.get("/", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({
    email: session.user.email,
    name: session.user.name,
  });
});

export default protected_;
