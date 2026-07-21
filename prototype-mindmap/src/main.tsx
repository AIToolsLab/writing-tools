import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { missingUiStrings } from "./ui-strings";

// Dev-only handle for growing src/i18n/source.json: walk the interface in a
// non-English language, then `copy(__missingUiStrings())` and paste the entries
// into source.json before re-running `npm run i18n`. See ./i18n/README.md.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__missingUiStrings = () =>
    JSON.stringify(missingUiStrings(), null, 2);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
