#!/usr/bin/env node
/* 19-11-2026 - THE ASSET QR LABEL (the CEO: "I want to have a QR code for the asset which is easier
 * for me to print and paste it to the physical. this QR must visible on the card details instead
 * of outside").
 *   1. lib/qr.ts encodes exactly: the matrices of four known texts match fingerprints that were
 *      checked by decoding them with OpenCV's QR reader when this guard was written (versions 1,
 *      4, 6 and 10 - the version-7+ information and several RS blocks included);
 *   2. the label sits INSIDE the asset drawer (data-record asset:<id>), not in the register row;
 *   3. the code holds only the link /portal?tab=Assets&asset=<id> - never a price, holder or serial;
 *   4. the portal opens that link on the asset's drawer, and drops the parameter afterwards;
 *   5. no QR package was added, no network call made, and the label carries no hex colour.
 *
 *   node tests/asset-qr.mjs
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? `  [${String(detail).slice(0, 300)}]` : ""}`); } };

const out = join(tmpdir(), `asset-qr-${process.pid}.mjs`);
execSync(`npx esbuild "${join(root, "lib/qr.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const { qrMatrix, qrPath } = await import(pathToFileURL(out).href);
rmSync(out, { force: true });
const fp = (t) => { const m = qrMatrix(t); return `${m.length}:${createHash("sha256").update(m.map((r) => r.map((b) => (b ? 1 : 0)).join("")).join("\n")).digest("hex").slice(0, 16)}`; };
const KNOWN = {
  "ET-0001/2026": "21:a753e2a053511d2d",
  "https://a2zcreative.my/portal?tab=Assets&asset=17": "33:1b6f4fbdb95e8d1a",
  "https://a2zcreative.my/portal?tab=Assets&asset=123456&check=abcdefghijklmnopqrstuvwxyz0123456789-x": "41:0a8bba4f92232682",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA": "57:dc92224f1bf1ce66"
};
for (const [t, want] of Object.entries(KNOWN)) ok(`the QR of a ${t.length}-character text is the verified one`, fp(t) === want, `${fp(t)} != ${want}`);
ok("the drawing is one path of unit squares inside a 4-module quiet zone", /^M4 4h1v1h-1z/.test(qrPath(qrMatrix("x"))));

const label = read("components/portal/asset-label.tsx");
const panel = read("components/portal/assets-panel.tsx");
const provider = read("components/portal/portal-provider.tsx");
const drawer = panel.slice(panel.indexOf("THE ASSET DRAWER"), panel.indexOf("</SideDrawer>", panel.indexOf("THE ASSET DRAWER")));
ok("the QR label is inside the asset drawer", /data-record=\{`asset:\$\{a\.id\}`\}>\n\s*<AssetLabel asset=\{a\}/.test(drawer));
ok("…and only there (not on a register row)", (panel.match(/<AssetLabel /g) ?? []).length === 1);
ok("the code holds only the asset's link", /return `\$\{origin\}\/portal\?tab=Assets&asset=\$\{id\}`;/.test(label) && /<QrSvg text=\{assetLink\(asset\.id\)\}/.test(label) && /qrMatrix\(assetLink\(a\.id\)\)/.test(label));
ok("…never a price, holder or serial", !/purchase_price|assigned|serial|holder_name/.test(label.replace(/\/\*[\s\S]*?\*\//g, "")));
ok("a Print label button prints the label page from a hidden frame", /data-testid="asset-label-print"/.test(label) && /frame\.srcdoc = html/.test(label) && /w\.print\(\)/.test(label));
ok("the portal opens /portal?tab=Assets&asset=<id> on the asset", /wanted === "Assets" && Number\.isInteger\(assetId\) && assetId > 0\) openRecord\("Assets", "asset", assetId\)/.test(provider) && /clean\.searchParams\.delete\("asset"\)/.test(provider));
const pkg = read("package.json");
ok("no QR package was added", !/qrcode|qr-code|qrious|"qr/.test(pkg));
ok("no network call in the encoder or the label", !/fetch\(|XMLHttpRequest|api\(/.test(read("lib/qr.ts") + label));
ok("no hex colour in the label", !/#[0-9a-fA-F]{3,6}\b/.test(label.replace(/\/\*[\s\S]*?\*\//g, "")));

console.log(`\nasset-qr: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
