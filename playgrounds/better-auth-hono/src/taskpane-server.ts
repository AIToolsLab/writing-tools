import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

// Standalone static server for the task-pane simulator.
// Runs on a DIFFERENT origin (3002) than the backend (3001) so that
// cookies set during browser login never reach this origin. The simulator
// must succeed using only the bearer token from the device flow.
const app = new Hono();
const PORT = 3002;

app.use("/*", serveStatic({ root: "./taskpane" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Task-pane simulator at http://localhost:${PORT}`);
  console.log(`(backend expected at http://localhost:3001)`);
});
