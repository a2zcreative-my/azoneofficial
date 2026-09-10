/**
 * CRISCIKEE — guard #69, v1.149.0.
 *
 * The CEO, 10-09-2026: a tab to learn WHO is trying the crispy chicken skin,
 * WHAT flavour they prefer, HOW MUCH they like it and WHY.
 *
 * THE PROPERTIES, not the implementation:
 *   1. ONE VOCABULARY. The closed lists (gender, age group, impression,
 *      sentiment) are the same keys, in the same order, in lib/criscikee.ts,
 *      worker/src/criscikee.ts and the 0125 CHECK constraints. A form that
 *      offers a value the API refuses is a form that loses a customer's
 *      feedback at the moment of saving it.
 *   2. AGE GROUP IS DERIVED, NEVER ACCEPTED. The worker files an age; the
 *      browser only previews. The two ageGroupOf functions are RUN over
 *      every age from 3 to 110 and must agree on all of them, and the POST
 *      route must write ageGroupOf(age), never body.age_group.
 *   3. ONLY AN ACTIVE FLAVOUR TAKES A NEW REVIEW. A retired flavour keeps its
 *      history and takes nothing new.
 *   4. SENTIMENT CARRIES ITS REASONS AND ITS SOURCE. A verdict nobody can
 *      check is not trusted; a human override is not silently undone by an
 *      edit to the wording.
 *   5. THE COMMENT IS STORED AS THE CUSTOMER SAID IT. Trimmed and capped -
 *      nothing else touches it.
 *   6. NOTHING IS ADDED UP IN THE BROWSER. Every COUNT, AVG and percentage is
 *      a SQL aggregate in /analytics. The one browser arithmetic allowed is
 *      the segment picker's weighted mean over cells the API already
 *      aggregated.
 *   7. AN INSIGHT NEEDS A SAMPLE. "Best" is withheld below MIN_SAMPLE, in
 *      the worker and on the screen, and the two agree on the number.
 *   8. DELETE IS SOFT AND AUDITED, and needs the management tier. Adding a
 *      review is the wider tier. The client's TAB_ROLES mirrors the
 *      worker's criscikee_view.
 *   9. NO FOREIGN KEYS (house policy since v1.4.69), and the triple bump.
 *  10. THE TAB IS WIRED THE HOUSE WAY: lazy panel, a door in staff.ts, and
 *      the module is reachable only through that door.
 *
 * Negative-tested by: reordering a gender in lib (1); moving the 25/34
 * boundary in the worker only (2); writing body.age_group (2); dropping the
 * is_active check on POST (3); dropping sentiment_reasons from the INSERT
 * (4); rewriting the comment on the way in (5); reducing in the panel (6);
 * lowering the worker's MIN_SAMPLE alone (7); making DELETE a hard delete
 * (8); adding a FOREIGN KEY (9); and removing the door (10).
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

/* v1.139.1 - fileURLToPath, NOT .pathname (Windows: "C:\\C:\\Users\\..."). */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const lib = read("lib/criscikee.ts");
const worker = read("worker/src/criscikee.ts");
const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const perms = read("worker/src/permissions.ts");
const tabs = read("lib/portal-tabs.ts");
const panel = read("components/portal/criscikee-panel.tsx");
const lazy = read("components/portal/lazy-panels.tsx");
const migration = read("worker/migrations/0125_criscikee.sql");

/* ---- 1. one vocabulary ---- */
{
  const libList = (name) => [...(lib.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`))?.[1] ?? "").matchAll(/\["([a-z0-9_]+)",/g)].map((m) => m[1]);
  const workerList = (name) => [...(worker.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`))?.[1] ?? "").matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  const checkList = (col) => [...(migration.match(new RegExp(`${col} TEXT NOT NULL[^\\n]*CHECK \\(${col} IN \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
  for (const [name, col] of [["GENDERS", "gender"], ["AGE_GROUPS", "age_group"], ["IMPRESSIONS", "impression"], ["SENTIMENTS", "sentiment"]]) {
    const a = libList(name), b = workerList(name), c = checkList(col);
    ok(`${name}: the browser and the worker carry the same keys in the same order`, a.length > 0 && JSON.stringify(a) === JSON.stringify(b), `lib=[${a}] worker=[${b}]`);
    ok(`${name}: the migration's CHECK holds the same keys`, c.length > 0 && JSON.stringify([...a].sort()) === JSON.stringify([...c].sort()), `check=[${c}]`);
  }
  ok("the constants agree", /AGE_MIN = 3/.test(lib) && /AGE_MAX = 110/.test(lib) && /AGE_MIN = 3, AGE_MAX = 110/.test(worker)
     && /COMMENT_MAX = 1000/.test(lib) && /COMMENT_MAX = 1000/.test(worker) && /CHECK \(age BETWEEN 3 AND 110\)/.test(migration));
}

/* ---- 2. age group is derived, never accepted - RUN both functions ---- */
{
  const dir = mkdtempSync(join(tmpdir(), "ck-"));
  const bundle = (src, out) => {
    const p = join(root, src);
    execSync(`npx esbuild "${p.replace(/\\/g, "/")}" --bundle --format=esm --platform=neutral --outfile="${out.replace(/\\/g, "/")}" --external:./shared --external:./permissions --external:./index --external:./staff`, { stdio: "pipe" });
  };
  let agree = false, boundary = false;
  try {
    bundle("lib/criscikee.ts", join(dir, "lib.mjs"));
    bundle("worker/src/criscikee.ts", join(dir, "worker.mjs"));
    writeFileSync(join(dir, "shared.js"), "export const json=()=>{};export const err=()=>{};export const audit=async()=>{};");
    writeFileSync(join(dir, "permissions.js"), "export const can=()=>true;");
    let w = readFileSync(join(dir, "worker.mjs"), "utf8").replace(/from "\.\/shared"/, 'from "./shared.js"').replace(/from "\.\/permissions"/, 'from "./permissions.js"');
    writeFileSync(join(dir, "worker.mjs"), w);
    const a = await import(pathToFileURL(join(dir, "lib.mjs")).href);
    const b = await import(pathToFileURL(join(dir, "worker.mjs")).href);
    agree = true;
    for (let age = 3; age <= 110; age++) if (a.ageGroupOf(age) !== b.ageGroupOf(age)) { agree = false; break; }
    boundary = a.ageGroupOf(17) === "under_18" && a.ageGroupOf(18) === "18_24" && a.ageGroupOf(24) === "18_24" && a.ageGroupOf(25) === "25_34"
      && a.ageGroupOf(27) === "25_34" && a.ageGroupOf(34) === "25_34" && a.ageGroupOf(35) === "35_44" && a.ageGroupOf(44) === "35_44"
      && a.ageGroupOf(45) === "45_54" && a.ageGroupOf(54) === "45_54" && a.ageGroupOf(55) === "55_plus";
    /* and the classifier answers the CEO's own examples the way a person would */
    const cls = b.classifySentiment;
    ok("the classifier reads Malay: 'BBQ memang sedap, rasa dia ngam dan crispy' is positive", cls("BBQ memang sedap, rasa dia ngam dan crispy.", 5).sentiment === "positive");
    ok("and negation: 'tak sedap langsung, lembik' is negative", cls("Tak sedap langsung, lembik dan berminyak.", 1).sentiment === "negative");
    ok("and a shrug: 'biasa je' is neutral", cls("Biasa je.", 3).sentiment === "neutral");
    ok("and it says why", /sedap|ngam|crispy/.test(cls("BBQ memang sedap, rasa dia ngam dan crispy.", 5).reasons));
  } catch (e) {
    ok("the two ageGroupOf functions could be bundled and run", false, String(e).slice(0, 200));
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
  ok("the browser's and the worker's ageGroupOf agree on every age from 3 to 110", agree, "the form would preview one band and the API file another");
  ok("the boundaries are the CEO's: 17|18, 24|25, 34|35, 44|45, 54|55", boundary);
  const post = worker.slice(worker.indexOf('if (path === "/reviews" && method === "POST")'), worker.indexOf("const rm = path.match"));
  ok("the POST writes ageGroupOf(age)", /ageGroupOf\(v\.age!\)/.test(post));
  ok("and never what the browser sent", !/body\??\.age_group/.test(worker), "a client-supplied band is a client that files itself wherever it likes");
  const patch = worker.slice(worker.indexOf('if (rm && method === "PATCH")'), worker.indexOf('if (rm && method === "DELETE")'));
  ok("an edit to the age re-derives the band", /put\("age", v\.age\); put\("age_group", ageGroupOf\(v\.age\)\)/.test(patch));
}

/* ---- 3. only an active flavour takes a new review ---- */
{
  const post = worker.slice(worker.indexOf('if (path === "/reviews" && method === "POST")'), worker.indexOf("const rm = path.match"));
  ok("a new review checks the flavour exists AND is active",
     /SELECT id, name, is_active FROM criscikee_flavors WHERE id = \?1/.test(post) && /if \(!fl\.is_active\) return err/.test(post),
     "a retired flavour keeps its history and takes nothing new");
  ok("the form only offers active flavours", /const activeFlavors = flavors\.filter\(\(f\) => f\.is_active\)/.test(panel) && /activeFlavors\.map/.test(panel));
  ok("a flavour is retired, never deleted", !/DELETE FROM criscikee_flavors/.test(worker) && /is_active/.test(worker) && /"Retire"/.test(panel));
}

/* ---- 4. sentiment carries its reasons and its source ---- */
{
  ok("the classifier returns its reasons", /export function classifySentiment[\s\S]{0,2000}?return \{ sentiment, reasons \}/.test(worker));
  ok("the INSERT stores sentiment, its source and its reasons", /sentiment, sentiment_source, sentiment_reasons, reviewed_on, created_by\)/.test(worker));
  ok("a hand-set sentiment is recorded as manual", /put\("sentiment_source", "manual"\)/.test(worker));
  ok("an edit to the wording does NOT overrule a human verdict",
     /before\.sentiment_source === "auto"/.test(worker),
     "reclassify only when the machine had the last word");
  ok("the screen shows why", /sentiment_reasons/.test(panel) && /\{r\.sentiment_reasons\}/.test(panel));
  ok("the migration knows both columns", /sentiment_source TEXT NOT NULL DEFAULT 'auto'/.test(migration) && /sentiment_reasons TEXT/.test(migration));
}

/* ---- 5. the comment is the customer's ---- */
{
  const rr = worker.slice(worker.indexOf("function readReview"), worker.indexOf("export async function handleCriscikee"));
  ok("the comment is trimmed and capped and nothing else",
     /const c = typeof body\?\.comment === "string" \? body\.comment\.trim\(\) : ""/.test(rr) && /v\.comment = c;/.test(rr) && !/comment\.replace|comment\.toLowerCase\(\)\s*;|\.toUpperCase/.test(rr),
     "a comment rewritten on the way in is no longer the customer speaking");
}

/* ---- 6. nothing is added up in the browser ---- */
{
  const analytics = worker.slice(worker.indexOf('if (path === "/analytics" && method === "GET")'), worker.indexOf("return null;", worker.indexOf('if (path === "/analytics"')));
  ok("every KPI is a SQL aggregate", /COUNT\(\*\) AS n, AVG\(r\.rating\)/.test(analytics) && /GROUP BY f\.id/.test(analytics) && /GROUP BY r\.gender/.test(analytics) && /GROUP BY r\.age_group/.test(analytics));
  ok("the cube is one GROUP BY over the three dimensions", /GROUP BY r\.flavor_id, r\.gender, r\.age_group/.test(analytics));
  ok("the sort column is a whitelist, never the URL", /const sortCol = \(\{ date: "r\.reviewed_on", age: "r\.age", rating: "r\.rating" \}/.test(worker));
  const reduces = (panel.match(/\.reduce\(/g) ?? []).length;
  const inSegment = (panel.slice(panel.indexOf("const segment = useMemo"), panel.indexOf("}, [a, segFlavor, segGender, segAge]);")).match(/\.reduce\(/g) ?? []).length;
  ok("the only arithmetic in the panel is the segment picker's weighted mean", reduces > 0 && reduces === inSegment,
     `${reduces} reduce() calls, ${inSegment} inside the picker - the rest must come from SQL`);
  ok("the picker weights by n, never averages averages", /c\.avg_rating \* c\.n/.test(panel));
}

/* ---- 7. an insight needs a sample ---- */
{
  const w = worker.match(/MIN_SAMPLE = (\d+)/)?.[1], l = lib.match(/MIN_SAMPLE = (\d+)/)?.[1];
  ok("MIN_SAMPLE is the same number in the worker and the browser", !!w && w === l, `worker ${w}, lib ${l}`);
  ok("best-rated, most-positive and most-negative are chosen among flavours with enough reviews",
     /const qualified = flavors\.filter\(\(f\) => f\.enough\)/.test(worker) && /top\(qualified/.test(worker));
  ok("best-by-gender and best-by-age apply the same floor", /x\.n >= MIN_SAMPLE/.test(worker));
  ok("opportunity needs the floor AND a strong rating", /c\.n >= MIN_SAMPLE && c\.avg_rating >= 4/.test(worker));
  ok("the too-few flavours are named, not hidden", /too_few: flavors\.filter\(\(f\) => f\.n > 0 && !f\.enough\)/.test(worker) && /too_few/.test(panel));
  ok("the screen says the rule out loud", /is only called best, most positive or most negative once it has at least/.test(panel));
  ok("a thin heat cell is faded and says so", /const thin = n < minSample/.test(panel));
  ok("the API tells the browser the number rather than the browser assuming it", /min_sample: MIN_SAMPLE/.test(worker) && /a\?\.min_sample \?\? MIN_SAMPLE/.test(panel));
}

/* ---- 8. delete is soft, audited, and management ---- */
{
  const del = worker.slice(worker.indexOf('if (rm && method === "DELETE")'), worker.indexOf('if (path === "/analytics"'));
  ok("delete needs criscikee_manage", /if \(!manage\) return err\("forbidden"/.test(del));
  ok("and is soft", /UPDATE criscikee_reviews SET is_deleted = 1/.test(del) && !/DELETE FROM criscikee_reviews/.test(worker));
  ok("and audited with what the row said", /"criscikee\.review_delete"[\s\S]{0,300}?snapshot: \{[\s\S]{0,200}?comment: before\.comment/.test(del));
  ok("adding a review is the wider tier", /if \(!canReview\) return err\("forbidden", "Your role cannot add reviews"/.test(worker));
  ok("every mutation is audited", (worker.match(/await audit\(env, user\.id, "criscikee\./g) ?? []).length >= 5);
  const view = perms.match(/criscikee_view: \[([^\]]*)\]/)?.[1] ?? "";
  const tabRoles = tabs.match(/Criscikee: \[([^\]]*)\]/)?.[1] ?? "";
  const norm = (s) => [...s.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort().join(",");
  ok("TAB_ROLES.Criscikee mirrors criscikee_view", view && norm(view) === norm(tabRoles), `view=${norm(view)} tab=${norm(tabRoles)}`);
  const manage = perms.match(/criscikee_manage: \[([^\]]*)\]/)?.[1] ?? "";
  ok("manage is narrower than view", norm(manage).split(",").length < norm(view).split(",").length && !/sales_marketing|marketing|hr_admin/.test(manage));
  ok("the delete button is drawn only for management", /\{canManage && <button type="button" className=\{rowBtnDanger\}/.test(panel));
}

/* ---- 9. no foreign keys, and the triple bump ---- */
{
  const sql = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  ok("no foreign keys here by policy", !/FOREIGN KEY|REFERENCES/.test(sql), "the comment may say the words; the DDL may not");
  ok("reviews reference the flavour by id", /flavor_id INTEGER NOT NULL/.test(migration) && /LEFT JOIN criscikee_flavors f ON f\.id = r\.flavor_id/.test(worker));
  const latest = index.match(/const LATEST_MIGRATION = "(\d{4})_/);
  ok("LATEST_MIGRATION is 0125 or newer", !!latest && Number(latest[1]) >= 125);
  ok("EXPECTED_MIGRATIONS lists it", /"0125_criscikee",/.test(index));
  ok("a health probe can name it", /sentiment_source FROM criscikee_reviews LIMIT 1/.test(index));
  ok("the launch flavours are seeded idempotently", /INSERT OR IGNORE INTO criscikee_flavors \(id, name/.test(migration));
  ok("and no demo reviews are seeded into production", !/INSERT[^;]*criscikee_reviews/i.test(migration),
     "the migration runs against the live database; fake feedback there is fake business data");
}

/* ---- 10. the tab is wired the house way ---- */
{
  ok("the panel is lazy", /export const CriscikeePanel = lazy\(\(\) => import\("@\/components\/portal\/criscikee-panel"\)\.then\(\(m\) => m\.CriscikeePanel\)\)/.test(lazy));
  ok("there is a door in staff.ts", /if \(path === "\/criscikee" \|\| path\.startsWith\("\/criscikee\/"\)\) \{\s*return handleCriscikee\(/.test(staff));
  ok("the module gates on view at the top", /if \(!can\(user\.role, "criscikee_view"\)\) return err\("forbidden"/.test(worker));
  ok("the panel uses the shared vocabulary, not its own copy", /from "@\/lib\/criscikee"/.test(panel) && !/const GENDERS = \[/.test(panel));
  ok("the panel talks to the API through the one client", /const api = makeApi\("\/staff\/criscikee"\)/.test(panel) && !/\bfetch\(/.test(panel));
  ok("the desk table and the phone list draw from ONE array", (panel.match(/\{reviews\.map\(\(r\) => \(/g) ?? []).length === 2 && /className="mt-3 space-y-2 md:hidden"/.test(panel) && /hidden max-h-\[32rem\] overflow-x-auto overflow-y-auto pr-1 md:block/.test(panel));
  ok("the rating is five real buttons, 44px on a phone", /role="radio" aria-checked=\{value === i\}/.test(panel) && /h-11 w-11/.test(panel));
  ok("a missing migration is said, not a blank screen", /pending_migration/.test(worker) && /migration 0125 applies/.test(panel));
}

console.log(failed === 0
  ? `criscikee: ${passed} checks passed.`
  : `\n${failed} criscikee check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
