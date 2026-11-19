/* v1.389.0 - the staff-portfolio browser walk runs against the REAL worker, not a fixture:
   the static build (out/) is served as Cloudflare Pages would (with the /portfolio/<name> rewrite
   from public/_redirects), and /api/v1/* goes to the bundled worker on an in-memory database
   built from every migration (tests/browser/portfolio-runtime.mjs). The people are invented test records.
   ROLE_ID chooses who the portal is signed in as (1 = CEO, 2 = HR, 11 = a team member).

     node tests/browser/portfolio-server.mjs <out dir> <port>                                    */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { makeRuntime } from "./portfolio-runtime.mjs";

const [dir, portArg] = process.argv.slice(2);
const port = Number(portArg ?? 4340);
const origin = `http://127.0.0.1:${port}`;
const rt = await makeRuntime({ origin });
let who = Number(process.env.ROLE_ID ?? 1);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".wasm": "application/wasm", ".onnx": "application/octet-stream", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

function staticFile(p) {
  if (/^\/portfolio\/[a-z0-9-]{3,40}\/?$/i.test(p) && !/^\/portfolio\/staff\/?$/.test(p) && p !== "/portfolio/elfia") p = "/portfolio/staff"; // the _redirects rewrite (200)
  const tries = [p, `${p}.html`, join(p, "index.html")];
  for (const t of tries) { const f = join(dir, t); if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const p = url.pathname;
  if (p === "/__as") { who = Number(url.searchParams.get("id") ?? who); res.end(JSON.stringify({ who })); return; }
  if (p.startsWith("/api/v1/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const pub = p.startsWith("/api/v1/public/") || !req.headers.cookie && req.headers["sec-fetch-mode"] === "no-cors";
    /* a signed-in request carries the session the walk chose; the public page sends none */
    const headers = { ...Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection", "content-length"].includes(k))), ...(pub ? { origin } : rt.headersFor(who)) };
    const r = await rt.worker.fetch(new Request(`${origin}${p}${url.search}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }), rt.env);
    const h = {}; r.headers.forEach((v, k) => { if (k !== "set-cookie") h[k] = v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  const f = staticFile(p);
  if (!f) { const nf = join(dir, "404.html"); res.writeHead(404, { "content-type": "text/html" }); res.end(existsSync(nf) ? readFileSync(nf) : "404"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
}).listen(port, "127.0.0.1", () => console.log(`PORTFOLIO_SERVER_READY ${port}`));
