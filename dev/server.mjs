// Local preview server for the Partners Expenses Function.
// Serves the real handler with an in-memory fake database. Local only; never deployed.
// POST /__reset clears the fake database and reloads the handler module (clears
// in-memory login lockouts, picks up handler edits without a restart).
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fakeSupabase, resetState } from "./fake-supabase.mjs";

const port = Number(process.argv[2] ?? 8000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
const supabase = fakeSupabase();

let handleApp;
async function loadHandler() {
  const href = pathToFileURL(resolve("functions/handler.mjs")).href;
  const mod = await import(`${href}?t=${Date.now()}`);
  handleApp = mod.handleApp;
}
await loadHandler();

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/__reset" && incoming.method === "POST") {
      resetState();
      await loadHandler();
      outgoing.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      outgoing.end('{"ok":true}');
      return;
    }
    if (url.pathname !== "/functions/v1/app") {
      outgoing.writeHead(404, { "content-type": "application/json" });
      outgoing.end('{"error":"not_found"}');
      return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const headers = { ...incoming.headers };
    delete headers["content-length"];
    const request = new Request(`http://127.0.0.1:${port}${incoming.url}`, {
      method: incoming.method,
      headers,
      body: ["GET", "HEAD"].includes(incoming.method ?? "GET") || raw.length === 0 ? undefined : raw,
    });
    const response = await handleApp({ request, supabase });
    const body = Buffer.from(await response.arrayBuffer());
    const responseHeaders = {};
    response.headers.forEach((value, name) => { responseHeaders[name] = value; });
    outgoing.writeHead(response.status, responseHeaders);
    outgoing.end(body);
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "application/json" });
    outgoing.end('{"error":"local_preview_failed"}');
    console.error("local preview error:", error?.message ?? error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local API preview: http://127.0.0.1:${server.address().port}/functions/v1/app (fake in-memory database)`);
});
