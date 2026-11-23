import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeTheme } from "./preferences";
import "./globals.css";

initializeTheme();

// The existing ledger stays at the root route. The new multi-book onboarding
// lives on its own path and is safe to expose: every action behind it requires
// a signed-in Supabase account, and expense entry is not enabled there yet.
const Root = window.location.pathname === "/books-setup"
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
