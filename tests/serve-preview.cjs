// Local-only static export server with the production response headers.
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('out');
const headers = {};
let globalRule = false;
for (const line of fs.readFileSync('public/_headers', 'utf8').split(/\r?\n/)) {
  if (line === '/*') { globalRule = true; continue; }
  if (globalRule && line && !/^\s/.test(line)) break;
  const match = globalRule && line.match(/^\s+([^:]+):\s*(.*)$/);
  if (match) headers[match[1]] = match[2];
}
const mime = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.webp':'image/webp', '.woff2':'font/woff2', '.ico':'image/x-icon', '.txt':'text/plain' };
const handler = (req, res) => {
  let file;
  try {
    file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname));
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error('Outside export');
    if (fs.existsSync(file + '.html')) file += '.html';
    else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    else if (!path.extname(file)) file += '.html';
    const data = fs.readFileSync(file);
    res.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
};
const tls = process.env.PREVIEW_CERT && process.env.PREVIEW_KEY;
const server = tls ? https.createServer({ cert: fs.readFileSync(process.env.PREVIEW_CERT), key: fs.readFileSync(process.env.PREVIEW_KEY) }, handler) : http.createServer(handler);
server.listen(Number(process.env.PREVIEW_PORT || 3212), '127.0.0.1', () => console.log(`Production preview: ${tls ? 'https' : 'http'}://127.0.0.1:` + (process.env.PREVIEW_PORT || 3212)));
