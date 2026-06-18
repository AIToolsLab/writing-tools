import { Hono } from "hono";

const ping = new Hono();

// Mirrors FastAPI's GET /api/ping
ping.get("/", (c) => c.json({ status: "ok" }));

export default ping;
