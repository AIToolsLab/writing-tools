import { fileURLToPath } from "node:url";
import { preview } from "vite";

export default async function startPagesPreview(): Promise<(() => Promise<void>) | undefined> {
  if (process.env.PLAYWRIGHT_SKIP_SERVER) return undefined;

  const port = Number(process.env.PLAYWRIGHT_PAGES_PORT ?? 4174);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const server = await preview({
    root,
    preview: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });

  return async () => {
    await server.close();
  };
}
