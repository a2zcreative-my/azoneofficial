#!/usr/bin/env node
/* 20-11-2026 - SHARE PORTFOLIO on the public staff portfolio (the CEO: "A2Z Creative - Add
 * Portfolio Sharing to Existing Web & PWA"). Static checks over the page, the share component
 * and the render library, plus the vCard and the card words run for real:
 *   - one component for every portfolio, in the hero (popover) and in the phone dock (sheet)
 *   - it shares only the PUBLISHED address the API gives (p.url) - never the browser's address
 *   - navigator.share is called straight from the tap; a cancel says nothing
 *   - the QR is the studio's own (qrSvg / qrPng over lib/qr.ts) for that same address
 *   - the PDF is the studio's own pdfOf from the published copy; the card drawing is untouched
 *   - the vCard holds only the public contact; the API adds only the photo's position
 *
 *   node tests/portfolio-share.mjs
 */
import { readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? `  [${String(detail).slice(0, 300)}]` : ""}`); } };

const page = read("app/portfolio/staff/page.tsx");
const share = read("app/portfolio/staff/share-portfolio.tsx");
const code = strip(share);
const render = read("lib/portfolio-render.ts");
const pf = read("worker/src/portfolios.ts");

/* one component, two places */
ok("the hero carries Share Portfolio beside Work with me", /data-testid="portfolio-enquire">[^\n]*\n\s*<SharePortfolio p=\{p\} name=\{name\} contact=\{shareContact\} L=\{L\} place="hero" \/>/.test(page));
ok("the phone dock carries it too (bottom sheet)", /<SharePortfolio p=\{p\} name=\{name\} contact=\{shareContact\} L=\{L\} place="dock" \/>/.test(page) && /<dialog ref=\{sheet\} id=\{`\$\{idp\}-share`\}/.test(share));
ok("nothing in it is one person's: no name, slug or address typed in", !/nurfarah|fasehah|nursyazwani|noraleeya|farah/i.test(code));
ok("it shares only the published address the API gives", !/location\.href|window\.location/.test(code) && /url: p\.url/.test(code) && /copyText\(p\.url\)/.test(code));
ok("it is only drawn for a published portfolio (the page's published branch)", page.indexOf("<SharePortfolio") > page.indexOf("if (p === null)"));
/* the device's own share sheet */
const dev = code.slice(code.indexOf("const shareDevice = () =>"), code.indexOf("const copy = async"));
ok("navigator.share is called straight from the tap (nothing awaited before it)", /navigator\.share\(\{ title, text: [\s\S]*?url: p\.url \}\)/.test(dev) && !/await/.test(dev.slice(0, dev.indexOf("navigator.share("))));
ok("a cancelled share says nothing", /\(e as \{ name\?: string \}\)\?\.name === "AbortError"\) return;/.test(dev));
ok("with no share sheet, the other ways are offered", /if \(!native\) \{ setStatus\(\{ tone: "info"/.test(dev));
ok("no pretend AirDrop or Quick Share call", !/airdrop:|quickshare|intent:\/\/|sharesheet:/i.test(code));
/* QR, PDF, vCard, WhatsApp */
ok("the QR is the studio's own, for the same address", /qrSvg\(p\.url\)/.test(code) && /png\(p\.url\)/.test(code) && !/qrMatrix|from "@\/lib\/qr"/.test(code));
ok("the PDF is the studio's own pdfOf of the published copy", /r\.pdfOf\("story", r\.cardDataOfPublic\(p\)/.test(code) && /qrUrl: p\.url,/.test(render) && /export function pdfOf\(size: CardSize, data: CardData, assets: CardAssets\): Blob/.test(render));
ok("WhatsApp shares the address to anyone (no number)", /https:\/\/wa\.me\/\?text=\$\{encodeURIComponent\(/.test(code));
ok("the card code loads only when asked", !/^import [^\n]*from "@\/lib\/portfolio-render";/m.test(share.replace(/^import type [^\n]*\n/gm, "")) && /await import\("@\/lib\/portfolio-render"\)/.test(code));
/* access and keyboard */
ok("Escape and a click outside close the popover; focus returns to the button", /e\.key === "Escape"/.test(code) && /pointerdown/.test(code) && /btn\.current\?\.focus\(\)/.test(code));
ok("the popover is drawn on the body (the hero clips and stacks what is inside it)", /createPortal\(/.test(code) && /document\.body,/.test(code));
ok("the button says what it opens; the popover is a native dialog (no hand-made role)", /aria-haspopup="dialog" aria-expanded=\{open\}/.test(code) && /<dialog open ref=\{pop\}/.test(code) && !/role="dialog"/.test(code) && /role="status"/.test(code));
ok("every way is a real button or link", (code.match(/data-testid="share-(device|copy|qr-open|whatsapp|pdf|vcard)"/g) ?? []).length === 6);
/* the API adds only the photo's position */
const pv = pf.slice(pf.indexOf("export function publicView"), pf.indexOf("export async function publicMediaKey"));
ok("the public read adds only the photo's zoom / x / y", /photo_crop: \(\(\) => \{/.test(pv) && /\{ zoom: c\.zoom as number, x: c\.x as number, y: c\.y as number \}/.test(pv));
ok("the public read still sends no staff id, IC, salary or address", !/user_id|employee_id|ic_number|salary|bank|address:/.test(pv));

/* run the vCard and the card words */
const out = join(tmpdir(), `portfolio-share-${process.pid}.mjs`);
execSync(`npx esbuild "${join(root, "lib/portfolio-render.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
const r = await import(pathToFileURL(out).href);
rmSync(out, { force: true });
const v = r.vcardOf({ name: "Siti Noraleeya, Eliana", position: "Designer; Video", url: "https://a2zcreative.my/portfolio/test-person", email: "hello@a2zcreative.my", phone: "+60123834821" });
ok("the vCard is a vCard 3.0 with CRLF lines", v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n") && v.endsWith("END:VCARD\r\n"));
ok("…with the name, position, company, contact and address", /FN:Siti Noraleeya\\, Eliana\r\n/.test(v) && /TITLE:Designer\\; Video\r\n/.test(v) && /ORG:A2Z Creative Marketing\r\n/.test(v) && /EMAIL;TYPE=INTERNET,WORK:hello@a2zcreative\.my\r\n/.test(v) && /TEL;TYPE=WORK,VOICE:\+60123834821\r\n/.test(v) && /URL:https:\/\/a2zcreative\.my\/portfolio\/test-person\r\n/.test(v));
ok("…and nothing else", v.split("\r\n").filter(Boolean).length === 10, v);
const pub = { slug: "test-person", url: "https://a2zcreative.my/portfolio/test-person", name: "Farah", position: "Graphic Designer", department: "Sales", tagline: "Line", specialties: ["A", "B", "C"], expertise: [], experience: null, responsibilities: ["1", "2", "3", "4", "5", "6"], email: null, phone: null, socials: {}, template: "navy", has_photo: false };
const cd = r.cardDataOfPublic(pub);
ok("the card's QR is the published address", cd.qrUrl === pub.url);
ok("no approved contact: the card shows A2Z's own (the studio's rule)", cd.email === "hello@a2zcreative.my" && cd.phone === "+60 12-383 4821", JSON.stringify([cd.email, cd.phone]));
ok("an approved contact is used as approved", r.cardDataOfPublic({ ...pub, email: "farah@a2zcreative.my", phone: "0121111111" }).email === "farah@a2zcreative.my");
ok("at most five responsibilities, as the studio", cd.responsibilities.length === 5);

console.log(`\nportfolio-share: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
