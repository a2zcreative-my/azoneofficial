/* v1.320.0 - SALES 2.0, STAGES 1 AND 2 (the CEO's "Proceed the recommend"
   on claude/SALES-2.0-STAGE-0-AUDIT.md, then "approve with recommend").
   SCREENS ONLY - this guard holds that it stayed so.

   The real module (lib/sales-status.ts) is bundled and RUN:
     - S2-4: a quotation's word is read from the records - an invoice made from
       it (all or part), the acceptance, a follow-up or a contact - and a
       voided invoice does not count; an invoice's word is its stored status
       with the CEO-verified part beside it; Overdue is a tag;
     - S2-5: the pipeline counts each record once, where it stands now, and a
       quotation already invoiced is counted as its invoice.
   And on the source:
     - the shared pieces (Panel, FlowStrip, KpiRow cols) are tokens and the
       house breakpoints only, and draw nothing they are not handed;
     - the Overview reads the pipeline from the one module, with the payment
       engine's parts only while verification is on; a pressed step narrows the
       ONE worklist; CEO Verified and Closed Sale open Closed Sales;
     - S2-1: nothing on the Overview says Mark paid; an invoice's action stays
       the payment engine's own;
     - Team Sales Performance only from the management-only weekly rows;
     - Sales 2.0 writes nothing and types no figure.
   Each rule is also proven to catch its own breakage (the mutation pass).

     node tests/sales2.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = {
  status: "lib/sales-status.ts", s2: "components/portal/sales2.tsx", s2css: "components/portal/sales2.module.css",
  panel: "components/ui/panel.tsx", panelCss: "components/ui/panel.module.css", flow: "components/ui/flow-strip.tsx", flowCss: "components/ui/flow-strip.module.css",
  kpi: "components/ui/kpi-tile.tsx", kpiCss: "components/ui/kpi-tile.module.css",
  sales: "components/portal/sales.tsx", views: "components/portal/sales-views.tsx", shell: "components/portal/sales-shell.tsx",
};

let n = 0;
async function load(src) {
  const dir = mkdtempSync(join(tmpdir(), "sales2-"));
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib/sales-status.ts"), src);
  const out = join(dir, `s-${n++}.mjs`);
  execSync(`npx esbuild "${join(dir, "lib/sales-status.ts")}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
}

async function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const S = await load(src.status);

  /* ---- S2-4: the words ---- */
  const Q = (id, o = {}) => ({ id, total_cents: 100000, acceptance: null, next: null, last_contact: null, ...o });
  const I = (id, o = {}) => ({ id, doc_type: "INV", total_cents: 100000, payment_status: "unpaid", converted_from: null, ...o });
  ok("a quotation nobody has touched is Open", S.quoteStatus(Q(1)) === "open");
  ok("a follow-up booked or a contact recorded makes it Follow-up", S.quoteStatus(Q(1, { next: { due_on: "2026-11-20" } })) === "follow_up" && S.quoteStatus(Q(1, { last_contact: { at: "2026-11-10" } })) === "follow_up");
  ok("the customer's current acceptance makes it Accepted", S.quoteStatus(Q(1, { acceptance: { current: true }, next: { due_on: "x" } })) === "accepted" && S.quoteStatus(Q(1, { acceptance: { current: false } })) === "open");
  ok("an invoice made from it for less than its total: Partially invoiced; the whole of it: Invoiced",
    S.quoteStatus(Q(1, { acceptance: { current: true } }), [I(9, { total_cents: 40000, converted_from: 1 })]) === "part_invoiced"
    && S.quoteStatus(Q(1), [I(9, { total_cents: 40000, converted_from: 1 }), I(10, { total_cents: 60000, converted_from: 1 })]) === "invoiced");
  const by = S.invoicesByQuote([I(9, { converted_from: 1 }), I(10, { converted_from: 1, payment_status: "void" }), I(11)]);
  ok("a voided invoice is not an invoice made from the quotation", (by.get(1) ?? []).length === 1 && !by.has(undefined) && by.size === 1);
  const u = S.invoiceStatus(I(1)), part = S.invoiceStatus(I(1), { verified_cents: 30000, pending_cents: 50000 }), paid = S.invoiceStatus(I(1, { payment_status: "paid" }), { verified_cents: 100000, pending_cents: 0 });
  ok("an invoice: Unpaid, Partially paid by the CEO-verified part only, Paid by its stored status", u.key === "unpaid" && part.key === "part_paid" && part.balance_cents === 70000 && paid.key === "paid" && paid.balance_cents === 0);
  ok("a reported payment never makes an invoice part paid (only a verified one does)", S.invoiceStatus(I(1), { verified_cents: 0, pending_cents: 100000 }).key === "unpaid");
  ok("Overdue is a tag on an unpaid invoice; a void invoice is Void", S.invoiceStatus(I(1, { payment_status: "overdue" })).overdue === true && S.invoiceStatus(I(1, { payment_status: "overdue" })).key === "unpaid" && S.invoiceStatus(I(1, { payment_status: "void" })).key === "void");

  /* ---- S2-5: the pipeline ---- */
  const c = S.pipelineCounts({
    enquiries: [{ status: "new" }, { status: "contacted" }, { status: "closed" }],
    quotes: [Q(1), Q(2, { next: { due_on: "x" } }), Q(3, { acceptance: { current: true } }), Q(4), Q(5)],
    invoices: [
      I(10, { converted_from: 4 }),                                                 // quotation 4 is invoiced: counted as its invoice
      I(11, { converted_from: 5, total_cents: 50000 }),                             // 5 part-invoiced: neither open nor followed up
      I(12), I(13, { payment_status: "paid", paid_confirmed_at: null }),
      I(14, { payment_status: "paid", paid_confirmed_at: "2026-11-03 02:00:00" }),
      I(15, { payment_status: "paid", paid_confirmed_at: "2026-10-30 02:00:00" }),  // closed last month
      I(16, { payment_status: "void" }),
      { id: 17, doc_type: "QT", total_cents: 1, payment_status: null },
    ],
    pay: { 12: { verified_cents: 0, pending_cents: 20000 } },
    month: "2026-11",
  });
  ok("the seven steps, in order", JSON.stringify(S.PIPELINE) === JSON.stringify(["enquiry", "quotation", "follow_up", "invoice", "reported", "verified", "closed"]));
  ok("an enquiry counts until it is closed", c.enquiry === 2, JSON.stringify(c));
  ok("Quotation = open ones nobody has followed up; Follow-Up = followed up or accepted; an invoiced one is not counted again", c.quotation === 1 && c.follow_up === 2, JSON.stringify(c));
  ok("an invoice with a payment waiting for the CEO is Payment Reported, not Invoice", c.reported === 1 && c.invoice === 2, JSON.stringify(c));
  ok("paid and not yet confirmed is CEO Verified; confirmed this month is Closed Sale; last month's and void ones are not counted", c.verified === 1 && c.closed === 1, JSON.stringify(c));
  const off = S.pipelineCounts({ enquiries: [], quotes: [], invoices: [I(12)], pay: null, month: "2026-11" });
  ok("with verification off nothing is Payment Reported", off.reported === 0 && off.invoice === 1);

  /* ---- the shared pieces ---- */
  for (const [name, css] of [["panel", src.panelCss], ["flow-strip", src.flowCss], ["sales2", src.s2css], ["kpi-tile", src.kpiCss]]) {
    const widths = [...css.matchAll(/@media \((min|max)-width: (\d+)px\)/g)].map((m) => `${m[1]}:${m[2]}`);
    ok(`${name}: the house breakpoints only`, widths.every((w) => ["min:640", "min:768", "min:1024", "min:1280", "max:639", "max:767", "max:1023", "max:1279"].includes(w)), widths.join(" "));
    ok(`${name}: tokens only - no literal colour`, !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(css));
  }
  ok("the flow strip shows a count only when it is handed one - never an invented zero", /\{compact && s\.count != null && /.test(src.flow) && /\{!compact && s\.count != null && /.test(src.flow));
  ok("the flow strip scrolls inside itself on a phone, never the page", /\.scroll \{[^}]*overflow-x: auto/.test(src.flowCss));
  /* v1.342.0 - the CEO's picture: the Sales Pipeline is one row of joined chevrons (FlowStrip arrows),
     only there; a step's word never breaks inside itself, and the ring for focus and the step in force is
     drawn inside the shape because the clip-path would cut an outline */
  ok("v1.342.0 the Sales Pipeline, and only it, is the chevron row",
    /testid="sales-pipeline" compact arrows \/>/.test(src.s2) && (src.s2.match(/ arrows /g) ?? []).length === 1
    && /className=\{`\$\{css\.strip\} \$\{arrows \? css\.arrows : compact \? css\.compact : css\.stacked\}`\}/.test(src.flow)
    && /\.arrows \.box \{[^}]*clip-path: polygon\(/.test(src.flowCss));
  ok("v1.342.0 a step's word never shreds, the row keeps its steps whole and scrolls inside itself on a phone",
    /\.arrows \.words strong \{[^}]*overflow-wrap: normal; word-break: normal;/.test(src.flowCss) && /\.arrows \{[^}]*min-width: min-content;/.test(src.flowCss)
    && /@media \(max-width: 767px\) \{\s*\.arrows \{ grid-auto-columns: minmax\(12\.5rem, 1fr\); \}/.test(src.flowCss));
  ok("v1.342.0 focus and the step in force are drawn inside the chevron, never cut away",
    /\.arrows button\.box:focus-visible::after \{ box-shadow: inset 0 0 0 2px var\(--ring\); \}/.test(src.flowCss) && /\.arrows button\.box\[aria-pressed="true"\]::after \{ box-shadow: inset 0 0 0 2px var\(--brand-primary\); \}/.test(src.flowCss));
  /* v1.323.0 - the one strip counts its own cells: every figure on one row only
     from 1280px, three below that, two below 1024px (D-5) */
  ok("KpiRow keeps every figure on one row only from 1280px", /data-cells=\{n\}/.test(src.kpi) && /@media \(max-width: 1279px\) \{\s*\.row\[data-cells="5"\][^}]*--cells: 3;/.test(src.kpiCss) && /@media \(max-width: 1023px\) \{\s*\.row, \.row\[data-cells\] \{ --cells: 2; \}/.test(src.kpiCss) && /cols\?: 4 \| 5 \| 6/.test(src.kpi));

  /* ---- the Overview ---- */
  const { sales, views, s2, shell } = src;
  ok("the pipeline is the one module's count, with the payment engine's parts only while verification is on",
    /const pipeline = pipelineCounts\(\{ enquiries, quotes: opps, invoices: sDocs\.filter\(\(d\) => d\.doc_type === "INV"\), pay: pv\?\.on \? pv\.inv : null, month: monthKey \}\);/.test(sales));
  ok("a pressed step narrows the ONE worklist; CEO Verified and Closed Sale open Closed Sales",
    /if \(k === "verified" \|\| k === "closed"\) \{ setPipe\(null\); setWsView\("closed"\); return; \}/.test(sales) && /\.filter\(\(r\) => !pipe \|\| r\.pipe === pipe\)/.test(shell)
    && /worklist=\{<SalesWorklist rows=\{workRows\} [^>]*pipe=\{pipe\}/.test(sales) && (sales.match(/<SalesWorklist /g) ?? []).length === 1);
  ok("every worklist row says its step", ['kind: "payment", pipe: "reported"', 'kind: "invoice", pipe: "invoice"', 'kind: "followup", pipe: "follow_up"', 'kind: "enquiry", pipe: "enquiry"'].every((x) => views.includes(x))
    && /kind: "quotation", pipe: quoteStatus\(o\) === "open" \? "quotation" : "follow_up",/.test(views));
  ok("S2-1: the Overview never says Mark paid; an invoice's action is the payment engine's own", !/\bMark paid\b|\bTanda dibayar\b/i.test(s2 + views) && /actionFor\(\{ total_cents: d\.total_cents/.test(views));
  ok("Team Sales Performance comes only from the weekly rows the server gives management, and only on Everyone",
    /team=\{scope === "all" && weekDash\?\.all \? \{/.test(sales) && /\{team && \(/.test(s2));
  ok("Sales 2.0 writes nothing", !/\bapi\s*[(<]|csrfFetch|method:\s*"(POST|PATCH|PUT|DELETE)"/.test(s2 + src.panel + src.flow + src.status));
  const code2 = s2.replace(/\/\*[\s\S]*?\*\//g, "");
  ok("no figure is typed in", !/fmtRM\(\s*\d|_cents: \d|\+\d+%/.test(code2));
  ok("a step with nothing to compare shows no change (no vs last week drawn)", !/delta=/.test(s2));
  return res;
}

const src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = await checks(src);
const failed = res.filter((r) => !r[1]);
for (const [name, , detail] of failed) console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
if (failed.length) { console.log(`sales2: ${failed.length} of ${res.length} FAILED`); process.exit(1); }

const MUT = [
  ["a voided invoice counted as made from the quotation", "status", 'if (i.converted_from == null || i.payment_status === "void") continue;', "if (i.converted_from == null) continue;"],
  ["a part invoice called Invoiced", "status", "if (made.length && invoiced >= q.total_cents) return \"invoiced\";", "if (made.length) return \"invoiced\";"],
  ["a reported payment counted as paid", "status", "const verified = Math.max(0, pay?.verified_cents ?? 0);", "const verified = Math.max(0, (pay?.verified_cents ?? 0) + (pay?.pending_cents ?? 0));"],
  ["an accepted quotation counted as untouched", "status", 'else if (s === "follow_up" || s === "accepted") out.follow_up += 1;', 'else if (s === "follow_up") out.follow_up += 1;\n    else if (s === "accepted") out.quotation += 1;'],
  ["closed sales of every month counted", "status", 'if ((i.paid_confirmed_at ?? "").slice(0, 7) === p.month) out.closed += 1;', "out.closed += 1;"],
  ["a closed enquiry still counted", "status", 'out.enquiry = p.enquiries.filter((e) => e.status !== "closed").length;', "out.enquiry = p.enquiries.length;"],
  ["reported counted with verification off", "sales", "pay: pv?.on ? pv.inv : null, month: monthKey", "pay: pv?.inv ?? null, month: monthKey"],
  ["a pressed step ignored by the worklist", "shell", ".filter((r) => !pipe || r.pipe === pipe)", ""],
  ["Mark paid on the Overview", "s2", 'L("Recent Payment Activity", "Aktiviti Bayaran Terkini")', 'L("Recent Payment Activity · Mark paid", "Aktiviti Bayaran Terkini")'],
  ["the team panel for everyone", "sales", 'team={scope === "all" && weekDash?.all ? {', "team={weekDash?.all ? {"],
  ["an invented change", "s2", '<KpiTile icon="money" tone="green"', '<KpiTile delta={{ pct: 22, text: "+22%" }} icon="money" tone="green"'],
  ["a literal colour in the panel", "panelCss", ".navy { background: var(--muted); color: var(--foreground); }", ".navy { background: #eef1f6; color: var(--foreground); }"],
  ["a breakpoint of its own", "flowCss", "@media (max-width: 767px)", "@media (max-width: 700px)"],
  ["a zero drawn when no count is handed", "flow", "{compact && s.count != null && ", "{compact && "],
  ["the pipeline back to the pill row", "s2", 'testid="sales-pipeline" compact arrows />', 'testid="sales-pipeline" compact />'],
  ["a word shredded inside its chevron", "flowCss", "overflow-wrap: normal; word-break: normal;", "overflow-wrap: anywhere;"],
  ["no focus ring inside the chevron", "flowCss", ".arrows button.box:focus-visible::after { box-shadow: inset 0 0 0 2px var(--ring); }", ".arrows button.box:focus-visible::after { }"],
];
let caught = 0;
if (process.env.NOMUT !== "1") {
  for (const [name, file, from, to] of MUT) {
    if (!src[file].includes(from)) { console.log(`  ✗ mutation "${name}": its anchor is gone from ${FILES[file]}`); process.exit(1); }
    let r; try { r = await checks({ ...src, [file]: src[file].replace(from, to) }); } catch { caught++; continue; }
    if (r.every((x) => x[1])) { console.log(`  ✗ mutation NOT caught: ${name}`); process.exit(1); }
    caught++;
  }
}
console.log(`sales2: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
