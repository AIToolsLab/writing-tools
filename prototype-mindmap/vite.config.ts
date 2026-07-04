import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Honor a PORT override (used by preview tooling that assigns a free port);
    // the normal `npm run dev` still opens on 5181.
    port: Number(process.env.PORT) || 5181,
    open: !process.env.PORT,
  },
});
