// static out/ + /api/* (HTTP and WebSocket) forwarded to the local worker
import http from "node:http"; import net from "node:net"; import fs from "node:fs"; import path from "node:path";
const OUT = process.argv[2], PORT = Number(process.argv[3] ?? 4500), API = { host: "127.0.0.1", port: 8787 };
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".txt": "text/plain" };
const srv = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    const p = http.request({ ...API, path: req.url, method: req.method, headers: { ...req.headers, host: "127.0.0.1:8787" } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    p.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(p); return;
  }
  const u = decodeURIComponent(req.url.split("?")[0]);
  for (const c of [u, `${u}.html`, path.join(u, "index.html")]) {
    const f = path.join(OUT, c);
    if (f.startsWith(OUT) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { "Content-Type": types[path.extname(f)] ?? "application/octet-stream" }); fs.createReadStream(f).pipe(res); return; }
  }
  res.writeHead(404); res.end("nf");
});
srv.on("upgrade", (req, sock, head) => {
  const up = net.connect(API.port, API.host, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries({ ...req.headers, host: "127.0.0.1:8787" }).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
    if (head?.length) up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
  up.on("error", () => sock.destroy()); sock.on("error", () => up.destroy());
});
srv.listen(PORT, "127.0.0.1");
