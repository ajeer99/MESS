import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeTheme } from "./preferences";
import "./globals.css";

initializeTheme();

// Keep production on the existing ledger until the new backend, access checks
// and financial-history migration are ready. This is a local setup route only.
const Root = import.meta.env.DEV && window.location.pathname === "/books-setup"
  ? lazy(() => import("./books/BooksApp"))
  : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<p className="p-8 text-center text-muted-foreground">Loading…</p>}>
      <Root />
    </Suspense>
  </StrictMode>,
);

// Enable install-to-home-screen (PWA). The worker is a pure passthrough —
// it never caches, so there is no risk of serving a stale version.
window.addEventListener("load", () => {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installability is a bonus; ignore registration failures */
    });
  }
});
