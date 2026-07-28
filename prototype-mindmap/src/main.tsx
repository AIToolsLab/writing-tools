import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import PlatformBootstrap from "./PlatformBootstrap";
import "./platform.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlatformBootstrap />
  </StrictMode>,
);
