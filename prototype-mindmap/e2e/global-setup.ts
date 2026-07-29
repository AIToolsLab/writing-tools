import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export default async function startDevelopmentServer(): Promise<
  (() => Promise<void>) | undefined
> {
  if (process.env.PLAYWRIGHT_SKIP_SERVER) return undefined;

  const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const server = await createServer({
    root,
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
      open: false,
    },
  });
  await server.listen();

  return async () => {
    await server.close();
  };
}
