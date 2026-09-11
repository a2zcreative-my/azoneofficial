/**
 * WHAT WAS TYPED ON SEVERAL LINES IS SHOWN ON SEVERAL LINES — guard #73,
 * v1.152.2.
 *
 * The CEO, 11-09-2026, on a customer comment typed as "a. … b. … c. …":
 * *"the desc I unable to entry and the review seem like continuously
 * instead of able to enter"*. The lines were saved. HTML folded them into
 * spaces on display, so the form looked broken. Asked whether other tabs had
 * the same, the sweep found four: event details, leave reasons, content
 * scripts and captions - and one worse: a task's description was typed,
 * saved and shown nowhere at all; and an HR task report was cut at two
 * lines with no way to open it.
 *
 * THE PROPERTY: every multi-line box in the portal (a <textarea>) feeds a
 * field that, wherever it is shown as text, is shown with its lines. There
 * are three honest ways to do that - `whitespace-pre-line`/`pre-wrap` on the
 * element, a formatter that splits on "\n" (MemoBody), or a list built from
 * the lines (roster task lines, sales bullet points) - and one dishonest way,
 * which is a plain <p>{x.field}</p>.
 *
 * Checked two ways:
 *   1. THE SWEEP. For every textarea-bound field name in components/portal,
 *      every JSX text render `{something.field}` in the same file sits inside
 *      an element whose opening tag carries whitespace-pre, unless the file
 *      is on the formatter allow-list for that field.
 *   2. THE FIVE, BY NAME - so a rewrite that moves a render to another file
 *      cannot slip past the sweep: the task description is shown; the HR
 *      report opens to its full text; DetailGrid keeps lines for every value
 *      (leave reason, content script and caption ride on it); event details
 *      keep lines in both places. (The Criscikee comment was the sixth until
 *      that tab was retired in v1.155.0.)
 *
 * Negative-tested by: dropping whitespace-pre-line from the task description
 * (1, 2); from the DetailGrid dd (2); from one of the two event details
 * blocks (1); removing the task description render entirely (2); and
 * putting the HR report back to a clamped <p> (2).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

/* ---- 1. the sweep ---- */
{
  /* fields whose lines are honoured by a formatter or a list, not a class */
  const FORMATTED = {
    "announcements.tsx": ["body"],          // MemoBody splits on \n and draws bullets
    "roster-board.tsx": ["items"],          // one task line per row
    "sales.tsx": ["points", "sub", "address", "delivery_address"], // bullet lists; addresses print via split("\n") / pre-line
    "elfia-store-panel.tsx": ["elfia_description"], // shown by the store, not here
    "role-panels.tsx": ["remark"],          // shown through DetailGrid (checked below)
  };
  const dir = join(root, "components/portal");
  let boxes = 0, renders = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
    const src = read(`components/portal/${f}`);
    const fields = new Set();
    /* one textarea = the text from its "<textarea" to its own "/>" or
       "</textarea>" - never into the next element's attributes */
    for (const tag of src.matchAll(/<textarea[\s\S]*?(?:\/>|<\/textarea>)/g)) {
      const dotted = tag[0].match(/(?:value|defaultValue)=\{[^}]*?\.(\w+)\b[^}]*\}/);
      const bare = tag[0].match(/(?:value|defaultValue)=\{(\w+)\}/);
      if (dotted) fields.add(dotted[1]); else if (bare) fields.add(bare[1]);
    }
    for (const field of fields) {
      if ((FORMATTED[f] ?? []).includes(field)) continue;
      boxes += 1;
      /* a text render: `>{x.field}<` or `>{x.field}</` or `{x.field}` followed by other text inside an element */
      const re = new RegExp(`<(\\w+)([^>]*)>[^<{]*\\{[\\w.?!]*\\.${field}\\}[^<]*</`, "g");
      for (const m of src.matchAll(re)) {
        renders += 1;
        const open = m[2];
        ok(`${f}: <${m[1]}> showing .${field} keeps its lines`, /whitespace-pre/.test(open), `opening tag: ${open.trim().slice(0, 90)}`);
      }
    }
  }
  ok("the sweep found multi-line boxes to check", boxes >= 8, `${boxes} boxes`);
  ok("and text renders of their fields", renders >= 5, `${renders} renders`);
}

/* ---- 2. the five, by name ---- */
{
  const tasks = read("components/portal/tasks.tsx");
  ok("a task's description is SHOWN on its row", /\{t\.description && \([\s\S]*?<p[^>]*whitespace-pre-line[^>]*>\{t\.description\}<\/p>/.test(tasks));
  const hr = read("components/portal/role-panels.tsx");
  ok("an HR task report opens to its full text, lines kept", /setOpenReport\(\(o\) => \(o === r\.id \? null : r\.id\)\)/.test(hr) && /whitespace-pre-line \$\{openReport === r\.id \? "" : "line-clamp-2"\}`\}>\{r\.content\}/.test(hr));
  const grid = read("components/ui/record-row.tsx");
  ok("DetailGrid keeps lines for every value", /<dd className="[^"]*whitespace-pre-line[^"]*">\{i\.value\}<\/dd>/.test(grid));
  const leave = read("components/portal/leave.tsx");
  ok("the leave reason rides on DetailGrid (both detail views)", (leave.match(/label: L\("Reason", "Sebab"\), wide: true, value: l\.reason \?\? ""/g) ?? []).length >= 1 && /value: l\.reason \?\? "",/.test(leave));
  ok("and keeps lines on the list line", /<p className="[^"]*whitespace-pre-line[^"]*">\{l\.reason\}<\/p>/.test(leave));
  const content = read("components/portal/content-panel.tsx");
  ok("content script and caption ride on DetailGrid", /label: L\("Script", "Skrip"\), wide: true, value: c\.script/.test(content) && /label: L\("Caption", "Kapsyen"\), wide: true, value: c\.caption/.test(content));
  const events = read("components/portal/events.tsx");
  ok("event details keep lines in the list and in the day agenda", (events.match(/whitespace-pre-line">\s*\{ev\.details\}/g) ?? []).length === 2);
  /* v1.155.0 - the Criscikee tab that prompted this guard was retired (the
     CEO: "completely drop Criscikee since this project not going further");
     the rule it taught stays, and every other textarea above still obeys it. */
}

console.log(failed === 0
  ? `kept-lines: ${passed} checks passed.`
  : `\n${failed} kept-lines check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
