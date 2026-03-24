import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";

import ExcalidrawApp from "./App";
import { runMigration } from "./data/migration";

// Run legacy → multi-project migration before rendering.
// This is idempotent and fast (no-op if already migrated).
runMigration().catch((err) => {
  console.error("Migration failed:", err);
});

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
registerSW();
root.render(
  <StrictMode>
    <BrowserRouter>
      <ExcalidrawApp />
    </BrowserRouter>
  </StrictMode>,
);
