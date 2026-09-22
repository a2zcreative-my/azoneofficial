/**
 * THE STATIC EXPORT PLUS A FIXTURE API ON ONE ORIGIN — v1.175.0, in the repo.
 *
 * A browser that cannot intercept requests (WebKitGTK via WebDriver) needs the
 * API on the same origin as the page, which is what this is for. Serve the
 * `out/` directory a production build produced, then point a probe at it.
 *
 *   pnpm build && node tests/browser/serve.mjs out 4177
 *   ROLE=live_host node tests/browser/serve.mjs out 4177
 *
 * env: ROLE (which role is signed in), ALREADY_PUNCHED=1 (the clock-out
 * endpoint answers "already punched", for checking that toast).
 *
 * No dependencies: plain Node.
 */
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fixture } from "./fixture.mjs";

const [dir, portS] = process.argv.slice(2);
const port = Number(portS ?? 4177);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".ttf": "font/ttf", ".webp": "image/webp", ".jpg": "image/jpeg" };
http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith("/api/v1/")) {
    const p = url.pathname.replace("/api/v1", "");
    if ((req.headers.accept ?? "").includes("text/event-stream")) { res.writeHead(200, { "content-type": "text/event-stream" }); res.write(": fixture\n\n"); return; }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (process.env.ALREADY_PUNCHED && req.method === "POST" && p === "/staff/attendance") {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "already_punched", message: "You already clocked out at 18:31 MYT. Clock in again when your next shift starts." }, already: true, at: "18:31" }));
        return;
      }
      const data = req.method === "GET" ? fixture(p, url.toString()) : { ok: true, ...(p.endsWith("/responsibilities") ? { role_title: "x", responsibilities: [] } : {}) };
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(data));
    });
    return;
  }
  let file = join(dir, decodeURIComponent(url.pathname.replace(/\/+$/, "") || "/"));
  if (existsSync(file) && statSync(file).isDirectory()) file = existsSync(join(file, "index.html")) ? join(file, "index.html") : file + ".html";
  if (!existsSync(file)) { const alt = file + ".html"; if (existsSync(alt)) file = alt; else { const nf = join(dir, "404.html"); if (existsSync(nf)) { res.writeHead(404, { "content-type": "text/html" }); res.end(readFileSync(nf)); return; } res.writeHead(404); res.end("not found"); return; } }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`serving ${dir} + fixture api on http://127.0.0.1:${port}`));
