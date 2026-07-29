import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone prototype dev server. Calls the existing writing-tools backend
// (OpenAI proxy) directly at VITE_BACKEND_URL; CORS on the backend is open.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    open: true,
  },
});
