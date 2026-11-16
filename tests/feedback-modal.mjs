#!/usr/bin/env node
/* v1.329.0 - THE ONE FEEDBACK MODAL (the CEO, 16-11-2026: F-1 ... F-5 of
   claude/FEEDBACK-MODAL-STAGE-0-AUDIT.md, approved as recommended).

   What this holds, in the source:
     F-1  one component (components/ui/feedback-modal.tsx) and one service,
          mounted ONCE in the portal layout; useSaveToast is a door onto it
          (same name, same arguments, the caller's words unchanged); the
          private PunchToast copy is gone
     F-2  a routine success / warning is passive (closes itself, never blocks
          a click: the layer and the card take no pointer events, only the X);
          an error, an acknowledged result and processing wait for OK
     F-3  the pilots: Attendance's decisions say WHICH decision with the day,
          the hours and the duration (the CEO's reference); Leave's decisions
          say final vs pending and the dates; Tasks' refusals wait for OK
     F-4  nothing retries by itself
     -    a centred card at every width (never a bottom sheet), inside the
          safe areas, tokens and --type-* only, reduced motion respected
     -    a routine success never replaces an error that was not read
   Each rule is proven to catch its own breakage (the mutation pass).

     node tests/feedback-modal.mjs     (NOMUT=1 skips the mutation pass) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = {
  fm: "components/ui/feedback-modal.tsx", fmc: "components/ui/feedback-modal.module.css", st: "components/ui/save-toast.tsx",
  layout: "app/portal/layout.tsx", dash: "components/portal/dashboard.tsx", exc: "components/portal/attendance-exceptions.tsx",
  leave: "components/portal/leave.tsx", leave4: "components/portal/leave4.tsx", tasks: "components/portal/tasks.tsx",
};
const walk = (dir, out = []) => {
  for (const e of readdirSync(join(root, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(root, rel)).isDirectory()) { if (e !== "node_modules") walk(rel, out); } else if (/\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
};

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const { fm, fmc, st, layout, dash, exc, leave, leave4, tasks } = src;
  /* F-1 */
  ok("F-1 one provider, mounted once in the portal layout, around the shell", /<FeedbackProvider>\s*<PortalShell>\{children\}<\/PortalShell>\s*<\/FeedbackProvider>/.test(layout));
  ok("F-1 useSaveToast keeps its name and arguments and goes through useFeedback, the caller's words unchanged",
    /export function useSaveToast\(\)/.test(st) && /const fb = useFeedback\(\);/.test(st) && /title, description: sub \|\| undefined/.test(st) && !/<style>|className="pointer-events-none/.test(st));
  ok("F-1 the private PunchToast copy is gone; the clock's words go through the provider", !/export function PunchToast\(/.test(dash) && !/<PunchToast/.test(dash) && /const \{ show: showFeedback \} = useFeedback\(\);/.test(dash)
    && /variant: t\.variant === "danger" \? "error" : t\.variant === "notice" \? "warning" : "success"/.test(dash));
  ok("F-1 under the provider the hook draws nothing itself (one card on the screen)", /return ctx \? \{ \.\.\.ctx, node: null \} : \{ \.\.\.local\.api, node: local\.node \};/.test(fm));
  /* F-2 */
  ok("F-2 an error, an acknowledged result and processing wait for OK; the rest is passive",
    /export const waitsForOk = \(o: FeedbackOptions\) => o\.variant === "error" \|\| o\.variant === "processing" \|\| o\.acknowledge === true;/.test(fm)
    && /if \(!waitsForOk\(o\)\) \{\s*const hold = /.test(fm));
  ok("F-2 a passive card never blocks a click: the layer and the card take no pointer events, only the X",
    /\.layer \{[^}]*pointer-events: none;/.test(fmc) && /\.card\.card \{[^}]*pointer-events: none;/.test(fmc) && /\.close \{[^}]*pointer-events: auto;/.test(fmc) && /\.layer\[data-blocking\] \{[^}]*pointer-events: auto;/.test(fmc));
  ok("F-2 a waiting card is a dialog (alertdialog for an error), focus on OK, Escape and X close it, focus goes back",
    /role=\{blocking \? \(o\.variant === "error" \? "alertdialog" : "dialog"\) : "status"\}/.test(fm) && /ok\.current\?\.focus\(\);/.test(fm) && /e\.key === "Escape" && o\.variant !== "processing"/.test(fm) && /back\.focus\(\)/.test(fm));
  ok("F-2 processing has no button and cannot be closed", /aria-busy=\{o\.variant === "processing" \? true : undefined\}/.test(fm) && /\{o\.variant !== "processing" && \(\s*<button type="button" className=\{css\.close\}/.test(fm));
  ok("a routine success never replaces an error that was not read", /if \(now && now\.variant === "error" && !waitsForOk\(o\)\) return;/.test(fm));
  /* F-3 pilots */
  ok("F-3 Attendance: an overtime decision says which (approved / replacement ½ or 1 day / rejected), the day, the hours and the duration, and waits for OK",
    /title: decision === "approved" \? L\("Overtime approved"/.test(exc) && /L\("Replacement leave · ½ day"/.test(exc) && /L\("Overtime rejected"/.test(exc)
    && /value: dmy\(o\.d\)/.test(exc) && /value: dur\(o\.minutes\)/.test(exc) && /feedback\(\{ variant: "success", acknowledge: true, testid: "decision-feedback",\s*title: decision/.test(exc) && !/L\("Decided", "Diputuskan"\)/.test(exc));
  ok("F-3 Attendance: a refusal is an error and waits for OK", /const notDecided = [^\n]*feedback\(\{ variant: "error"/.test(exc) && (exc.match(/if \(!r\.ok\) \{ notDecided\(r\); return; \}/g) ?? []).length === 2);
  ok("F-3 Leave: a decision says final or pending - pending is never approved - with the dates, and waits for OK",
    /const final = res\.data\?\.stage === "approved";/.test(leave) && /: final \? L\("Leave approved", "Cuti diluluskan"\) : L\("Approved at your step"/.test(leave) && /L\("Pending the next approval"/.test(leave)
    && /variant: action === "reject" \? "warning" : "success", acknowledge: true, testid: "leave-feedback"/.test(leave) && /leaveFeedback\(\{ variant: "error", title: L\("Not changed"/.test(leave));
  ok("F-3 Leave: a refused application waits for OK", /L\("The server refused the request", "Pelayan menolak permohonan"\), "error"\); return; \}/.test(leave4));
  ok("F-3 Tasks: a refused create, tick, change, delete or deliverable waits for OK", (tasks.match(/, "error"\); \/\/ v1\.329\.0|"error", \/\/ v1\.329\.0/g) ?? []).length === 5);
  /* look */
  ok("a centred card at every width inside the four safe areas, 90% up to 360px, on the house surfaces (a modal that waits, a toast that passes)",
    /\.layer \{[^}]*position: fixed; inset: 0; z-index: var\(--z-toast\);[^}]*align-items: center; justify-content: center;/.test(fmc) && ["top", "right", "bottom", "left"].every((e) => fmc.includes(`max(1rem, env(safe-area-inset-${e}, 0px))`))
    && /\.card\.card \{[^}]*width: 90%; max-width: 22\.5rem;/.test(fmc) && /className=\{`\$\{blocking \? modalCard : toastCard\} \$\{css\.card\}`\}/.test(fm) && !/align-items: flex-end/.test(fmc));
  ok("tokens and --type-* only, no breakpoint, reduced motion respected", !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(fmc) && ((fmc.match(/@media \(([^)]+)\)/g) ?? []).every((m) => /prefers-reduced-motion: reduce/.test(m))) && /@media \(prefers-reduced-motion: reduce\)/.test(fmc) && /font-size: var\(--type-section-size\)/.test(fmc));
  /* F-4 */
  ok("F-4 nothing retries by itself: the modal makes no request", !/\bapi\(|fetch\(|csrfFetch|setInterval/.test(fm));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);
/* no second copy: nothing else in the app hand-makes a save toast */
const strays = [...walk("app"), ...walk("components")].filter((f) => !/components\/ui\/(feedback-modal|save-toast)\.tsx$/.test(f) && /@keyframes (save|punch)-(pop|ring|check)/.test(read(f)));
if (strays.length) { console.log(`  ✗ a hand-made toast animation survives: ${strays.join(", ")}`); failed = [...failed, ["strays"]]; }

const MUT = [
  ["the provider not mounted", "layout", "<FeedbackProvider>", "<>"],
  ["a passive card blocks clicks", "fmc", "  pointer-events: none;\n}\n.layer[data-blocking]", "  pointer-events: auto;\n}\n.layer[data-blocking]"],
  ["an error closes itself", "fm", 'o.variant === "error" || o.variant === "processing" || o.acknowledge === true;', 'o.variant === "processing" || o.acknowledge === true;'],
  ["a success wipes an unread error", "fm", 'if (now && now.variant === "error" && !waitsForOk(o)) return;', ""],
  ["Escape closes processing", "fm", 'e.key === "Escape" && o.variant !== "processing"', 'e.key === "Escape"'],
  ["the OT decision back to 'Decided'", "exc", 'title: decision === "approved" ? L("Overtime approved", "OT diluluskan")', 'title: decision === "approved" ? L("Decided", "Diputuskan")'],
  ["the OT duration dropped", "exc", '{ icon: "pending", label: L("Duration", "Tempoh"), value: dur(o.minutes) },', ""],
  ["pending leave said as approved", "leave", ': final ? L("Leave approved", "Cuti diluluskan") : L("Approved at your step", "Diluluskan di peringkat anda")', ': L("Leave approved", "Cuti diluluskan")'],
  ["a refused task fades away", "tasks", '"error"); // v1.329.0 - a refusal waits for OK', '"notice");'],
  ["a bottom sheet again", "fmc", "align-items: center; justify-content: center;\n  padding:", "align-items: flex-end; justify-content: center;\n  padding:"],
  ["the private PunchToast back", "dash", "const { show: showFeedback } = useFeedback();", "const { show: showFeedback } = useFeedback();\nexport function PunchToast() { return null; }"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\nfeedback-modal: ${failed.length} failed`); process.exit(1); }
console.log(`feedback-modal: ${res.length} checks passed (${caught} mutations caught)`);
