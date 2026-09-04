/**
 * Action-feedback guard (v1.77.0) — guard #25.
 *
 * CEO, 30-08-2026: *"on the Task, there is no popup box to show if there is
 * any task successfully deleted. I also want to make sure that all this being
 * done globally."*
 *
 * He is right that it is a class of bug rather than one button. A destructive
 * action that reports nothing leaves the person unable to tell the difference
 * between "it worked", "it failed" and "a filter moved the row" — and the
 * usual reaction is to press it again, which for a delete is the worst
 * possible response to uncertainty.
 *
 * An audit of every mutating call in the portal found seven such actions:
 * deleting a task, deciding somebody's leave (both the normal chain and the
 * CEO override), approving or rejecting overtime, removing a commission rule,
 * crediting a supplier return, recording a replacement, and deleting a file
 * from a staff member's document vault. Each was silent. Each is money, time
 * off, or a record somebody cannot get back.
 *
 * TWO RULES, chosen because they are the ones that matter and can be checked
 * without flagging every form in the codebase:
 *
 *   1. A DELETE must report. Nothing else in the interface tells you a thing
 *      is gone rather than merely hidden.
 *   2. Anything worth a CONFIRM DIALOG must report. If the code stopped to
 *      ask "are you sure?", the answer to "did it happen?" cannot be silence.
 *   3. A CONTROL that mutates must report — v1.79.0. The CEO: *"when I
 *      clicked closed it doesnt popup which is not correct!"* He had changed
 *      an enquiry's status to Closed on a `<select>`; the row saved and said
 *      nothing. Rules 1 and 2 walked BUTTONS, and a dropdown or a checkbox
 *      that writes to the database is as much a mutation as a button — more
 *      dangerous, if anything, because a stray scroll can change one. This
 *      rule resolves every `<select>` / checkbox / radio `onChange` to the
 *      handler it calls and fails if that handler mutates in silence. Four
 *      were found the day it was written: the enquiry status, the enquiry
 *      reply (which also CLEARED THE DRAFT on a failed send), the task tick
 *      and the onboarding checklist tick.
 *
 * A call that goes through a wrapper which itself reports counts as covered —
 * `act()` in role-panels.tsx is the pattern, and inlining a toast at every
 * call site would be worse code, not safer code.
 *
 *   node tests/action-feedback.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;

/* Anything the person actually sees: a toast, a banner, an inline message, or
   being taken somewhere else. */
const FEEDBACK =
  /show\w*Toast|\w*[Tt]oast\(|set\w*Msg|set\w*Message|set\w*Status|set\w*Error|set\w*Notice|set\w*Banner|set\w*Result|set\w*Feedback|alert\(|window\.location|router\.(push|replace)/;
const MUTATION = /method:\s*"(POST|PATCH|PUT|DELETE)"/;
const CONFIRM = /await (confirm|ask\w+|\w*[Cc]onfirm)\(\{/;

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(path.join(root, dir))) {
    if (e === "node_modules" || e === ".next") continue;
    const rel = `${dir}/${e}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
    else if (/\.tsx$/.test(e)) files.push(rel);
  }
};
for (const d of ["app", "components"]) walk(d);
ok("there are client files to check", files.length > 10, `found ${files.length}`);

/**
 * THE FUNCTION THE CALL LIVES IN — not a window of lines around it.
 *
 * The first draft of this guard read forty lines either side of the request
 * and asked whether any of them showed the person something. It passed on a
 * deliberately silent delete dropped into stokis-panel, because a `load()`
 * defined underneath it happened to set a status message. A guard that reads
 * its neighbours' feedback and credits it to you is not checking anything.
 *
 * So: brace-match outwards from the call to the enclosing block, and keep
 * widening while that block is not a function body. What a handler does after
 * the request is its own business; what the function three lines down does is
 * not evidence about this one.
 */
const enclosingFn = (src, at) => {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i--) {
    const c = src[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) {
        const header = src.slice(Math.max(0, i - 200), i);
        if (/(=>|function\b|\)\s*)$/.test(header.trimEnd())) { start = i; break; }
        depth = 0; // a plain object or JSX brace: keep going outwards
      } else depth--;
    }
  }
  if (start < 0) return src.slice(Math.max(0, at - 1500), at + 1500);
  let d = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") d++;
    else if (src[i] === "}" && --d === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
};

const silentDeletes = [];
const silentConfirmed = [];

for (const rel of files) {
  const src = readFileSync(path.join(root, rel), "utf8");
  const lines = src.split(/\r?\n/);
  const offsetOf = (lineIdx) =>
    lines.slice(0, lineIdx).reduce((n, l) => n + l.length + 1, 0);

  /* Wrappers that report on their own behalf. A call site using one of these
     is covered — see `act()` in role-panels.tsx. */
  const wrappers = new Set();
  for (const m of src.matchAll(/const (\w+) = async \([^)]*\)[^=]*=>\s*\{([\s\S]{0,1200}?)\n  \};/g)) {
    if (FEEDBACK.test(m[2]) && /api[<(]/.test(m[2])) wrappers.add(m[1]);
  }
  const covered = (ctx) =>
    FEEDBACK.test(ctx) || [...wrappers].some((w) => new RegExp(`\\b${w}\\(`).test(ctx));

  lines.forEach((l, i) => {
    if (!MUTATION.test(l)) return;
    const ctx = enclosingFn(src, offsetOf(i));
    if (covered(ctx)) return;

    if (/method:\s*"DELETE"/.test(l)) {
      silentDeletes.push(`${rel}:${i + 1}`);
      return;
    }
    /* Was this action gated behind an "are you sure?" */
    if (CONFIRM.test(ctx)) silentConfirmed.push(`${rel}:${i + 1}`);
  });
}

ok("every DELETE tells the person it happened", silentDeletes.length === 0,
   `${silentDeletes.join(", ")} — a row disappearing is not a receipt, and the reaction to uncertainty is to press it again`);
ok("every action worth confirming reports its outcome", silentConfirmed.length === 0,
   `${silentConfirmed.join(", ")} — the code stopped to ask "are you sure?", so "did it happen?" cannot be answered with silence`);

/* ---- rule 3: a control that mutates must report (v1.79.0) ---- */
{
  /* A HANDLER MUST NOT COUNT ITS OWN NAME AS FEEDBACK. The first draft of
     this scan reported zero, because the shared FEEDBACK pattern contains
     `set\w*Status` and the very handler at issue is called `setStatus` — the
     mutation matched the evidence that it was reported. So rule 3 uses a
     pattern without the generic `set…` verbs, keeping only the things that
     actually put something on the screen. */
  const SHOWS = /show\w*Toast|\w*[Tt]oast\(|set\w*Msg|set\w*Message|set\w*Error|set\w*Notice|set\w*Banner|set\w*Feedback|alert\(|window\.location|router\.(push|replace)/;
  const IGNORE = new Set(["void", "Number", "String", "Boolean", "parseInt", "parseFloat", "console", "if", "return", "map", "filter"]);

  /* WHICH `setStatus`? page.tsx declares three, in three different panels.
     Taking the first would clear the other two for free; taking all three
     would blame every dropdown in the file for whichever one is silent —
     and it did, on the first run: two false reports alongside the two real
     ones. In a React component the handlers are declared above the JSX that
     uses them, so the right answer is the NEAREST DECLARATION ABOVE the
     control. (Falling back to the first if none is above covers a handler
     passed down as a prop from later in the file.) */
  const defsOf = (src, name) => {
    const out = [];
    const re = new RegExp(`const ${name} = (?:useCallback\\()?async[^{]*\\{`, "g");
    for (const m of src.matchAll(re)) {
      const start = m.index + m[0].length - 1;
      let d = 0;
      for (let j = start; j < src.length; j++) {
        if (src[j] === "{") d++;
        else if (src[j] === "}" && --d === 0) { out.push({ at: m.index, body: src.slice(start, j + 1) }); break; }
      }
    }
    return out;
  };
  const bodyFor = (src, name, useAt) => {
    const defs = defsOf(src, name);
    if (defs.length === 0) return null;
    const above = defs.filter((d) => d.at < useAt);
    return (above.length ? above[above.length - 1] : defs[0]).body;
  };

  const silentControls = [];
  for (const rel of files) {
    const src = readFileSync(path.join(root, rel), "utf8");
    const lineAt = (i) => src.slice(0, i).split("\n").length;
    for (const m of src.matchAll(/<select\b|type="(?:checkbox|radio)"/g)) {
      /* The onChange belongs to THIS tag: search only as far as the element
         plausibly runs. (An early draft used a tag regex that stopped at the
         `>` inside an arrow function and found nothing at all.) */
      const win = src.slice(m.index, m.index + 900);
      const oc = win.match(/onChange=\{([\s\S]{0,240}?)\}/);
      if (!oc) continue;
      for (const c of oc[1].matchAll(/\b([a-z]\w{2,})\(/g)) {
        const name = c[1];
        if (IGNORE.has(name)) continue;
        const body = bodyFor(src, name, m.index);
        if (!body || !MUTATION.test(body) || SHOWS.test(body)) continue;
        silentControls.push(`${rel}:${lineAt(m.index)} → ${name}()`);
      }
    }
  }
  ok("every dropdown and checkbox that saves says so", silentControls.length === 0,
     `${[...new Set(silentControls)].join(", ")} — a control that writes to the database and reports nothing ` +
     "leaves the person unable to tell a saved change from a lost one, and there is no row disappearing to hint at it");
}

/* ---- the seven the audit found, named so they cannot regress quietly ---- */
{
  const page = readFileSync(path.join(root, "app/portal/page.tsx"), "utf8");
  const panels = readFileSync(path.join(root, "components/portal/role-panels.tsx"), "utf8");
  const dir = readFileSync(path.join(root, "components/staff/staff-directory.tsx"), "utf8");
  const roster = readFileSync(path.join(root, "components/portal/roster-board.tsx"), "utf8");
  for (const [what, src, re] of [
    ["deleting a task", page, /showTaskToast\(L\("Task deleted"/],
    ["a task delete that failed", page, /showTaskToast\(L\("Not deleted"/],
    ["deciding leave", page, /showLeaveToast\(\s*\n?\s*action === "reject"/],
    /* v1.90.2 — the apply button used to `return` in silence on a blank end
       date; a staff member pressed Submit and nothing happened. */
    ["applying for leave", page, /showLeaveToast\(\s*\n?\s*L\("Leave requested"/],
    /* v1.92.0 — targets save from one button, and say how many. */
    ["saving the targets grid", page, /const saveTargets = async[\s\S]{0,1500}?showToast\(L\("Saved", "Disimpan"\), `\$\{list\.length\}/],
    ["a targets save that partly failed says which", page, /showToast\(L\("Partly saved", "Disimpan sebahagian"\)/],
    ["no field on the targets grid saves itself on blur any more", page, !/void saveTarget\("user"|void saveTarget\("team"/.test(page) ? /./ : /(?!)/],
    /* v1.91.0 — the unscheduled-work card's editor on the roster. */
    ["updating a task from the roster rail", roster, /showToast\(status \? L\("Task completed", "Tugasan selesai"\) : L\("Task updated"/],
    ["a task update the server refused", roster, /const saveUnsched = async[\s\S]{0,1200}?if \(!r\.ok\) \{\s*\n?\s*showToast\(L\("Not saved"/],
    ["a leave request the server refused", page, /const apply = async[\s\S]{0,1200}?if \(!res\.ok\) \{\s*\n?\s*showLeaveToast\(L\("Not sent"/],
    ["a leave request with no date says so instead of doing nothing", page, /const apply = async[\s\S]{0,400}?if \(!start\) \{\s*\n?\s*showLeaveToast\(/],
    ["the CEO leave override", page, /showLeaveToast\(\s*\n?\s*action === "approve" \? L\("Approved by you"/],
    ["an overtime decision", page, /showOtToast\(\s*\n?\s*decision === "approved"/],
    ["removing a commission rule", page, /L\("Rule removed", "Peraturan dibuang"\)/],
    ["crediting a supplier return", panels, /invToast\(res\.ok \? L\("Credit recorded"/],
    ["recording a replacement", panels, /invToast\(res\.ok \? L\("Replacement recorded"/],
    ["deleting a staff document", dir, /L\("Document deleted", "Dokumen dipadam"\)/],
  ]) {
    ok(`${what} reports the outcome`, re.test(src));
  }
  /* Both outcomes, not just the happy one: a refusal that looks identical to
     a success is worse than no message at all. */
  ok("the task delete reports failure differently from success",
     /res\.ok[\s\S]{0,400}?showTaskToast\(L\("Not deleted"[\s\S]{0,200}?"notice"/.test(page) ||
     /if \(!res\.ok\) \{[\s\S]{0,300}?showTaskToast\(L\("Not deleted"/.test(page));
}

console.log(
  fails.length === 0
    ? `PASS — nothing destructive happens in silence (${pass} checks, ${files.length} files)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
