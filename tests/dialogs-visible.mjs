/**
 * A DIALOG IS NEVER DRAWN INSIDE A HIDDEN TAB — guard #74, v1.152.2.
 *
 * The CEO, 11-09-2026, on the Sales tab, Documents view: *"when I pick paid,
 * then why it doesnt update?!"*.
 *
 * It did not update because nothing happened. Picking "paid" opens the
 * "Payment received" dialog (reference + the date the money landed) and
 * awaits the answer. v1.120.0 put the three work views behind pills, and
 * the toast, the confirm dialog and the prompt dialog were left rendered
 * INSIDE the "Create document" body - which is display:none on the
 * Documents view. The dialog was drawn into a hidden box; `await askText()`
 * never resolved; the dropdown snapped back. Delete (a confirm) and every
 * toast on Documents, Receipts and Clients were mute the same way, and
 * because a toast is how the portal says "not saved", the failure was
 * silent twice over.
 *
 * THE PROPERTY: a `{...Node}` from useSaveToast / useConfirm / usePrompt /
 * the step-up prompt is rendered where it can be SEEN whenever the action
 * that uses it can be pressed. Statically: never inside an element whose
 * class is `{x === "..." ? "..." : "hidden"}` or that carries `hidden={...}`
 * - the two shapes SectionTabs bodies take - when that same node is the one
 * the panel's other tabs use. A child component that owns its own toast and
 * lives entirely inside one tab is fine: its buttons are hidden with it.
 *
 * So the sweep is per COMPONENT: for each `function X(` in a file, the
 * bodies it opens with the two hidden shapes are matched to their closing
 * </div> by nesting, and a Node rendered between open and close is a
 * finding - unless that Node's hook was declared inside a different
 * function (then it belongs to a child that is hidden as a whole).
 *
 * Negative-tested by: moving {promptNode} back into the Create body (sales);
 * moving {toastNode} into the "attendance" body of the Dashboard card.
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

/** the index just past the </div> that closes the <div opened at `openAt` */
function closeOf(src, openAt) {
  let depth = 0;
  const re = /<div\b|<\/div>/g;
  re.lastIndex = openAt;
  let m;
  while ((m = re.exec(src))) {
    if (m[0] === "<div") depth += 1;
    else { depth -= 1; if (depth === 0) return m.index + m[0].length; }
  }
  return src.length;
}

/** [start, end) of each top-level function/component body in the file */
function functions(src) {
  const out = [];
  const re = /^(?:export )?(?:async )?function (\w+)/gm;
  let m;
  const starts = [];
  while ((m = re.exec(src))) starts.push([m.index, m[1]]);
  for (let i = 0; i < starts.length; i++) {
    out.push({ name: starts[i][1], start: starts[i][0], end: starts[i + 1]?.[0] ?? src.length });
  }
  return out;
}

const dir = join(root, "components/portal");
let bodies = 0, nodes = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
  const src = read(`components/portal/${f}`);
  for (const fn of functions(src)) {
    const body = src.slice(fn.start, fn.end);
    /* the node names THIS function declared */
    const declared = new Set();
    for (const m of body.matchAll(/node: (\w+Node)\b/g)) declared.add(m[1]);
    if (declared.size === 0) continue;
    /* the hidden tab bodies this function opens */
    const hiddenOpens = [];
    for (const m of body.matchAll(/<div[^>]*?(?:className=\{[^}]*?\? "[^"]*" : "hidden"\}|\bhidden=\{)/g)) hiddenOpens.push(m.index);
    for (const openAt of hiddenOpens) {
      bodies += 1;
      const end = closeOf(body, openAt);
      const inside = body.slice(openAt, end);
      for (const name of declared) {
        if (new RegExp(`\\{${name}\\}`).test(inside)) {
          nodes += 1;
          const line = src.slice(0, fn.start + openAt).split("\n").length;
          ok(`${f} ${fn.name}: {${name}} is not inside a hidden tab body`, false, `body opened at line ${line}`);
        }
      }
    }
  }
}
ok("the sweep saw hidden tab bodies", bodies >= 8, `${bodies} bodies`);
ok("and found no dialog inside one", nodes === 0, `${nodes} inside`);

/* the sales panel, by name: the three nodes sit at the panel's top level */
{
  const sales = read("components/portal/sales.tsx");
  const top = sales.indexOf('<div className="space-y-4 md:space-y-6">');
  const firstTabBody = sales.indexOf('? "mt-3" : "hidden"');
  const pos = (n) => sales.indexOf(`{${n}}`, top);
  ok("sales: toast, confirm and prompt render before the first tab body", ["toastNode", "confirmNode", "promptNode"].every((n) => pos(n) > top && pos(n) < firstTabBody));
  ok("sales: marking an invoice paid still asks for the date and reference first", /const got = await askText\(\{[\s\S]*?title: L\("Payment received", "Bayaran diterima"\)/.test(sales));
}

console.log(failed === 0
  ? `dialogs-visible: ${passed} checks passed.`
  : `\n${failed} dialogs-visible check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
