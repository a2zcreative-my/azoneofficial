/* v1.318.0 - THE CLOCK-IN / CLOCK-OUT CONFIRMATION (the CEO's picture and
   words, 15-11-2026: "update for clock in and clock out when staff click the
   button. make sure it is fit with PWA", then "A2Z OS change to my own logo.
   make it standardize").

   What this holds, in the source (the browser half is tests/browser/punch-receipt.py):
     - one punch(): the sheet is drawn by On Shift's own punch flow, and only
       for a punch the server recorded clean - never for one that is waiting
       for the CEO, kept with no signal, or refused;
     - no new fact: the time and the place are read back from the server's
       own record; total hours are the day's sessions; tagging is the one
       rule (locFlagged); the shift is the server's answer;
     - the company's own logo, one component, on both cards;
     - a PWA modal (v1.328.0): centred in the viewport inside the safe
       areas, 90% up to 360px, its own height; 44px targets; one layout
       at every width; reduced motion respected; Escape and Done close it;
       the sheet is the shared one (components/ui/result-sheet.tsx), never hand-made;
     - it writes nothing.
   Each rule is also proven to catch its own breakage (the mutation pass).

     node tests/punch-receipt.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = { dash: "components/portal/dashboard.tsx", pr: "components/portal/punch-receipt.tsx", css: "components/portal/punch-receipt.module.css", logo: "components/ui/brand-logo.tsx", v3: "styles/erp-v3.css", sheet: "components/ui/result-sheet.tsx", sheetCss: "components/ui/result-sheet.module.css" };

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const d = src.dash, pr = src.pr, css = src.css, sh = src.sheet, shc = src.sheetCss;
  const clean = d.slice(d.indexOf("if (res.ok && res.data?.flag) {"), d.indexOf('code === "no_shift"'));
  ok("the sheet opens only on a punch the server recorded clean", /setReceipt\(\{/.test(clean) && (d.match(/setReceipt\(\{/g) ?? []).length === 1);
  ok("…never for one waiting for the CEO or kept with no signal (they return before it)", (() => { const q = d.indexOf("if (res.queued) {", d.indexOf("const res = await api<{ flag?: string")), w = d.indexOf("if (res.ok && res.data?.pending) {"), r = d.indexOf("setReceipt({"); return q > 0 && w > 0 && q < r && w < r && /if \(res\.ok && res\.data\?\.pending\) \{[\s\S]{0,900}?await load\(\);\s*return;/.test(d); })());
  ok("the recording card shows while a clock-in or clock-out is on its way", /\{\(busy === "clock_in" \|\| busy === "clock_out"\) && <PunchRecording \/>\}/.test(d));
  ok("the time and the place are read back from the server's own record of the punch", /const rec = \[\.\.\.today\]\.filter\(\(r\) => r\.type === receipt\.type && !r\.pending\)/.test(d) && /at: fresh\?\.created_at \?\? receipt\.answeredAt/.test(d) && /loc: fresh \? \(fresh\.loc \?\? null\) : undefined/.test(d));
  ok("total hours are the day's sessions, the figure the shift timer shows", /workedMinutes: receipt\.type === "clock_out" \? workedToday : null/.test(d) && /const workedToday = sessionMinutes\(sessionsNow\);/.test(d));
  ok("the shift is the server's answer (its hours, which shift of the day)", /shift: \{ start: res\.data\.shift\?\.start \?\? null, end: res\.data\.shift\?\.end \?\? null, n: Math\.max\(1, res\.data\.sessions_today \?\? 1\) \}/.test(d));
  ok("the server's verdict keeps its words when it is more than on time", /note: flag === "ok" \|\| flag === "completed" \? null : \(label\[flag\] \?\? flag\)/.test(d));
  ok("the overtime a clock-out measured is said on the sheet", /ot: type === "clock_out" && otM > 0/.test(d) && /overtime sent for approval/.test(d));
  ok("tagging for HR is the one rule (locFlagged) - never for the CEO, COO or CCO", /const tagged = locFlagged\(loc, exempt\);/.test(pr) && /exempt: GEOFENCE_EXEMPT_ROLES\.includes\(user\.role\)/.test(d));
  ok("the words of the picture", /L\("Clock-In Recorded!"/.test(pr) && /L\("Clock-Out Recorded!"/.test(pr) && /L\("You have clocked in for today\."/.test(pr) && /L\("Recording attendance…"/.test(pr) && /L\("Please wait a moment\."/.test(pr) && /L\("Recorded, not tagged"/.test(pr) && /L\(`Recorded by \$\{who\.name\}`/.test(pr) && /L\("Done", "Selesai"\)/.test(pr));
  ok("Malaysia time, from the instant (UTC+8)", /new Date\(\(Number\.isFinite\(ms\) \? ms : Date\.now\(\)\) \+ 8 \* 3600 \* 1000\)/.test(pr) && /\{t\.time\} MYT/.test(pr));
  ok("the company's own logo heads both cards, through one component", (pr.match(/<BrandLogo label=\{L\("Attendance", "Kehadiran"\)\} \/>/g) ?? []).length === 2 && /<img src="\/logo\.png" alt="A2Z Creative Marketing" className="erp-brand-logo"/.test(src.logo) && /\.erp-brand-logo \{/.test(src.v3) && !/A2Z OS<|>A2Z OS/.test(pr));
  ok("a dialog, and the shared one: labelled, modal, Escape and the backdrop close it, focus on Done", /<ResultSheet titleId="punch-receipt-title"[\s\S]{0,160}?onClose=\{onDone\}/.test(pr) && !/role="dialog"/.test(pr)
    && /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/.test(sh) && /if \(e\.key === "Escape"\) onClose\(\);/.test(sh) && /data-kind=\{kind\} onClick=\{onClose\}>/.test(sh) && /done\.current\?\.focus\(\);/.test(pr));
  /* v1.328.0 (the CEO, 16-11-2026: "This must be a centered modal, NOT a bottom sheet or full-screen page") */
  ok("PWA: a compact modal centred in the viewport, inside all four safe areas, 90% up to 360px, its own height, scrolling inside itself only when the screen is shorter",
    /\.layer \{[^}]*position: fixed; inset: 0;[^}]*align-items: center; justify-content: center;/.test(shc)
    && ["top", "right", "bottom", "left"].every((e) => shc.includes(`max(1rem, env(safe-area-inset-${e}, 0px))`))
    && /\.sheet\.sheet \{[^}]*width: 90%; max-width: 22\.5rem; height: auto; max-height: 100%;[^}]*overflow-x: hidden; overflow-y: auto;/.test(shc)
    && !/align-items: flex-end|translateY|0 0;\s*\n?\s*box-shadow: 0 -12px/.test(shc)
    && /className=\{`erp-modal \$\{css\.sheet\}`\} role="dialog"/.test(sh));
  ok("44px targets: Done is 2.75rem tall; the 2rem X carries a 44px tap ring", /\.close \{[^}]*width: 2rem; height: 2rem;/.test(shc) && /\.close::after \{ content: ""; position: absolute; inset: -0\.375rem;/.test(shc) && /\.done \{[^}]*min-height: 2\.75rem;/.test(css));
  ok("one layout at every width (no breakpoint), and reduced motion respected", ((css + shc).match(/@media \(([^)]+)\)/g) ?? []).every((m) => /prefers-reduced-motion: reduce/.test(m)) && /@media \(prefers-reduced-motion: reduce\)/.test(css) && /@media \(prefers-reduced-motion: reduce\)/.test(shc));
  ok("recorded is not verified: only a punch inside the geofence is green; outside is always the warning band, with Not GPS verified",
    /const sub = st === "verified" \? L\("Location verified", "Lokasi disahkan"\) : `\$\{L\("Not GPS verified", "Tidak disahkan GPS"\)\} · \$\{what\}`;/.test(pr)
    && /tone: st === "verified" \? "ok" : tagged \|\| st === "outside" \? "warn" : "plain"/.test(pr) && /\.place\[data-tone="warn"\] \{/.test(css));
  ok("clock-in green, clock-out the approved gold with navy ink", /\.body\[data-kind="out"\] \.tick, \.body\[data-kind="out"\] \.done \{ background: var\(--gold-solid\); \}/.test(css) && /\.body\[data-kind="out"\] \.done, \.body\[data-kind="out"\] \.tick \{ color: var\(--brand-primary\); \}/.test(css) && /\.tick \{[^}]*background: var\(--success\);/.test(css));
  ok("colours are tokens (no literal colour in either module)", !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css + shc));
  ok("it writes nothing", !/api<|fetch\(|method:/.test(pr + sh));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["the sheet shown for a punch still waiting for the CEO", "dash", "    if (res.ok && res.data?.pending) {\n      setPunchToast({", "    if (false) {\n      setPunchToast({"],
  ["the time taken from the phone's clock, not the record", "dash", "at: fresh?.created_at ?? receipt.answeredAt", "at: receipt.answeredAt"],
  ["the place guessed instead of read back", "dash", "loc: fresh ? (fresh.loc ?? null) : undefined", "loc: null"],
  ["total hours invented", "dash", 'workedMinutes: receipt.type === "clock_out" ? workedToday : null', "workedMinutes: 480"],
  ["the CEO tagged for being outside", "pr", "const tagged = locFlagged(loc, exempt);", "const tagged = locFlagged(loc, false);"],
  ["a late clock-in loses its verdict", "dash", 'note: flag === "ok" || flag === "completed" ? null : (label[flag] ?? flag)', "note: null"],
  ["a drawn mark instead of the company's logo", "logo", '<img src="/logo.png" alt="A2Z Creative Marketing" className="erp-brand-logo"', '<img src="/icon-192.png" alt="A2Z OS" className="erp-brand-logo"'],
  ["the bottom safe area dropped", "sheetCss", "max(1rem, env(safe-area-inset-bottom, 0px))", "1rem"],
  ["a bottom sheet again", "sheetCss", "display: flex; align-items: center; justify-content: center;\n  padding:", "display: flex; align-items: flex-end; justify-content: center;\n  padding:"],
  ["wider than 360px", "sheetCss", "width: 90%; max-width: 22.5rem; height: auto;", "width: 100%; max-width: 27rem; height: auto;"],
  ["a breakpoint that changes the layout", "sheetCss", "@media (prefers-reduced-motion: reduce) {", "@media (max-width: 639px) { .sheet { width: 100%; } }\n@media (prefers-reduced-motion: reduce) {"],
  ["outside the geofence drawn as verified", "pr", 'tone: st === "verified" ? "ok" : tagged || st === "outside" ? "warn" : "plain"', 'tone: st === "verified" || st === "outside" ? "ok" : "plain"'],
  ["recorded worded as verified", "pr", 'const sub = st === "verified" ? L("Location verified", "Lokasi disahkan") : `${L("Not GPS verified", "Tidak disahkan GPS")} · ${what}`;', 'const sub = what;'],
  ["Escape no longer closes it", "sheet", 'if (e.key === "Escape") onClose();', ""],
  ["a hand-made dialog again", "pr", '<ResultSheet titleId="punch-receipt-title"', '<div role="dialog" data-x="punch-receipt-title"'],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\npunch-receipt: ${failed.length} failed`); process.exit(1); }
console.log(`punch-receipt: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
