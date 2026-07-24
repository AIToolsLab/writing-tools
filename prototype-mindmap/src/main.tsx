import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MutationPolicyProvider } from "./mutation-policy";
import { ReaderViewProvider, useReaderView } from "./reader-view";
import { UiLocaleProvider } from "./ui-locale";

function ReaderMutationBoundary({ children }: { children: ReactNode }) {
  const reader = useReaderView();
  return <MutationPolicyProvider mode={reader.isTranslatedView ? "translated_view" : "authoring"} onRejected={reader.reportReadOnlyRejection}>{children}</MutationPolicyProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiLocaleProvider>
      <ReaderViewProvider>
        <ReaderMutationBoundary><App /></ReaderMutationBoundary>
      </ReaderViewProvider>
    </UiLocaleProvider>
  </StrictMode>,
);
