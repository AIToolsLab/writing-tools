import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MutationPolicyProvider } from "./mutation-policy";
import { UiLocaleProvider } from "./ui-locale";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiLocaleProvider>
      <MutationPolicyProvider mode="authoring">
        <App />
      </MutationPolicyProvider>
    </UiLocaleProvider>
  </StrictMode>,
);
