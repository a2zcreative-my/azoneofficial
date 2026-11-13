/**
 * v1.295.0 - NEWS v2.0, RELEASE N1 (CEO directive "A2Z OS - NEWS v2.0",
 * 12-11-2026, with its photo; "approve continuously", 13-11-2026;
 * claude/NEWS-V2-AUDIT.md). Frontend only: the routes in worker/src/news.ts
 * are unchanged, and tests/news-acks.mjs keeps running them against SQLite.
 *
 * What must stay true:
 *   A  four tabs through the one shared tab row; the management tabs are
 *      drawn only for a publisher, and asked for by address they open the feed
 *   B  acknowledging stays the reader's one button: no other file sends it,
 *      and nothing acknowledges by being shown
 *   C  bodies are text, never HTML; no views, likes or comments are invented
 *   D  the feed's filters (category, important/pinned, my status, date, sort),
 *      ten a page; each tab its own figures, never the same strip twice
 *   E  My Acknowledgements is three sections from the server's own flags
 *   F  the composer asks before publishing, presses once, warns before
 *      unsaved words are lost, keeps a draft on this device only, previews on
 *      desktop and phone, and sends the fields the route already takes
 *   G  the report: its strip, filters, paging and CSV, and the recipients' CSV
 *
 * Every rule has a mutation that must turn it red.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const FILES = {
  page: "components/portal/announcements.tsx",
  parts: "components/portal/news-parts.tsx",
  manage: "components/portal/news-manage.tsx",
  portal: "app/portal/page.tsx",
};
const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ""; const j = s.indexOf(b, i + a.length); return s.slice(i, j < 0 ? s.length : j); };

function checks(f) {
  const out = [];
  const ok = (name, c, d = "") => out.push([name, Boolean(c), d]);
  const page = strip(f.page), parts = strip(f.parts), manage = strip(f.manage);
  const all = page + parts + manage;

  /* A */
  ok("A the four tabs, in order, through the one LineTabs", (page.match(/<LineTabs /g) ?? []).length === 1
    && /\["feed", L\("News Feed"/.test(page) && /\["mine", L\("My Acknowledgements"/.test(page) && /\["publish", L\("Publish & Manage"/.test(page) && /\["reports", L\("Reports & Archive"/.test(page));
  ok("A the management tabs exist only for a publisher", /\.\.\.\(canPost \? \(\[\["publish"/.test(page) && /\{canPost && \(\s*<TabZone label=\{L\("Publish"/.test(page) && /\{canPost && \(\s*<TabZone label=\{L\("Reports"/.test(page));
  ok("A a management view asked for without the right opens the feed", /\(canPost \|\| v === "feed" \|\| v === "mine"\)/.test(page) && /const view: View = allowed\(asked\) \? asked : "feed";/.test(page));
  ok("A the tab is in the address (Back / Forward)", /useTabViewAddress\("Announcements", view, setView, allowed\);/.test(page) && /startView=\{startOf\("Announcements"\)\}/.test(f.portal));
  ok("A the guard the address reads is stable (no history wiped on each render)", /const allowed = useCallback\(/.test(page));

  /* B */
  ok("B acknowledging is the reader's one button", (all.match(/\/ack`/g) ?? []).length === 1 && (page.match(/\back\(/g) ?? []).length === 1 && !/\back\(|\/ack`/.test(parts + manage));
  ok("B nothing acknowledges on open, on render or on a timer", !/useEffect\([^)]*ack|setTimeout\([^)]*ack/.test(page) && /Opening a post does not acknowledge it/.test(f.page));

  /* C */
  ok("C text only: no HTML injected anywhere in News", !/dangerouslySetInnerHTML|innerHTML/.test(all));
  ok("C no invented views, likes or comments", !/\bviews\b|\blikes?\b|\bcomments?\b/i.test((all.match(/L\("[^"]*"/g) ?? []).join(" ")));

  /* D */
  const feed = between(page, 'label={L("News feed"', "MY ACKNOWLEDGEMENTS");
  ok("D the feed's filters: category, important/pinned, my status, date and sort", ["category", "flag", "status", "date", "sort"].every((k) => feed.includes(`key: "${k}"`)));
  ok("D ten a page, with the pager", /const PER = 10;/.test(page) && /shown\.slice\(at \* PER, at \* PER \+ PER\)/.test(page) && /<NewsPager /.test(feed));
  ok("D pinned first sorts the pinned to the top on the page itself", /sort === "pinned" \? \(y\.pinned \?\? 0\) - \(x\.pinned \?\? 0\)/.test(page));
  const keysOf = (src) => [...src.matchAll(/\{ key: "([a-zA-Z]+)", icon:/g)].map((m) => m[1]);
  const feedKeys = keysOf(feed), repKeys = keysOf(between(manage, "export function Reports(", "\n}\n"));
  ok("D each tab its own figures: the feed's and the report's never repeat", feedKeys.length === 4 && repKeys.length === 5 && !feedKeys.some((k) => repKeys.includes(k)), `${feedKeys} / ${repKeys}`);
  ok("D the strip is the portal's shared KpiRow / KpiTile", /<KpiRow label=\{label\}>/.test(parts) && /<KpiTile key=\{s\.key\}/.test(parts));
  ok("D the phone folds the filters behind one button", /data-testid="news-filter-toggle"/.test(parts));

  /* E */
  ok("E three sections from the server's flags: waiting, acknowledged, the rest",
    /const toAck = anns\.filter\(needs\);/.test(page) && /const acked = anns\.filter\(\(a\) => a\.acked\);/.test(page) && /const history = anns\.filter\(\(a\) => !a\.acked && !needs\(a\)\);/.test(page)
    && /export const needs = \(a: Announcement\) => \(a\.required \?\? 1\) === 1 && !a\.acked;/.test(parts));
  ok("E history says why: your post, an earlier version, or not addressed", /return "own";/.test(parts) && /return "previous";/.test(parts) && /return "not_required";/.test(parts));

  /* F */
  const form = between(manage, "export function PostForm(", "\n}\n");
  ok("F publishing asks first, and says who will be notified", /const ok = await confirm\(edit/.test(form) && /It goes to \$\{who\} now/.test(form));
  ok("F one press per publish", /if \(busy \|\| pressed\.current\) return;\s*pressed\.current = true;/.test(form));
  ok("F unsaved words: the browser asks before they are lost, and the edit drawer asks too",
    /window\.addEventListener\("beforeunload", warn\)/.test(form) && /dirty=\{editDirty\}/.test(page));
  ok("F a draft lives on this device only and is cleared once published", /window\.localStorage\.setItem\(DRAFT_KEY/.test(manage) && /if \(!edit\) \{ setF\(blank\(\)\); writeDraft\(null\); \}/.test(form) && !/\/drafts|status: "draft"/.test(form));
  ok("F a failed publish keeps the words", /the words stay: a failed publish never clears the form/.test(f.manage) && between(form, "if (!r.ok) {", "return;\n").indexOf("setF(") < 0);
  ok("F the desktop and phone preview", /data-testid="news-preview"/.test(form) && /data-size=\{shownOn\}/.test(form));
  ok("F the payload is the route's own fields (nothing the server does not take)",
    /const payload = \{ category: f\.category, title: f\.title, body: f\.body, to: f\.to, memo_date: memo \? f\.memo_date : null,\s*important: f\.important, pinned: f\.pinned, audience: f\.audience\.length \? f\.audience : null, \.\.\.\(edit \? \{ version: edit\.version \?\? 1 \} : \{\}\) \};/.test(form));

  /* G */
  ok("G the report exports what its filters show", /const exportCsv = \(\) => downloadCsv\(`news-acknowledgement-report-/.test(manage) && /\.\.\.rows\.map\(\(p\) => \[p\.title/.test(manage));
  ok("G the recipients export, with the version", /downloadCsv\(`news-recipients-\$\{id\}-v\$\{d\.version\}\.csv`/.test(manage));
  ok("G report paging and completion filter", /key: "rstate"/.test(manage) && /<NewsPager page=\{at\} pages=\{pages\} total=\{rows\.length\} per=\{PER\}/.test(manage));
  return out;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["Reports shown to staff", "page", '...(canPost ? ([["publish"', '...(true ? ([["publish"'],
  ["a management view opened by address", "page", '(canPost || v === "feed" || v === "mine")', '(true || v === "feed" || v === "mine")'],
  ["the address forgotten", "page", 'useTabViewAddress("Announcements", view, setView, allowed);', ""],
  ["an unstable guard", "page", "const allowed = useCallback(", "const allowed = ((x) => x)("],
  ["a second acknowledge path", "parts", "export function NewsEmpty(", 'const quickAck = (id: number) => api(`/staff/announcements/${id}/ack`, { method: "POST" });\nexport function NewsEmpty('],
  ["acknowledged on open", "page", "const loadVersions = async () => {", "useEffect(() => { void ack(); }, []);\n  const loadVersions = async () => {"],
  ["HTML injected", "parts", '<div className={css.body}>{out}</div>', '<div className={css.body} dangerouslySetInnerHTML={{ __html: body }} />'],
  ["invented likes", "parts", '{(a.files?.length ?? 0) > 0 && <span><AppIcon name="attach" />', '<span>{L("24 likes", "24 suka")}</span>{(a.files?.length ?? 0) > 0 && <span><AppIcon name="attach" />'],
  ["the date filter dropped", "page", '{ key: "date", label:', '{ key: "when", label:'],
  ["no paging", "page", "const PER = 10;", "const PER = 1000;"],
  ["the same figure on two tabs", "manage", '{ key: "ackedAll", icon:', '{ key: "acked", icon:'],
  ["history taking the waiting posts", "page", "const history = anns.filter((a) => !a.acked && !needs(a));", "const history = anns.filter((a) => !a.acked);"],
  ["publish without asking", "manage", "const ok = await confirm(edit", "const ok = true || await confirm(edit"],
  ["a double press", "manage", "if (busy || pressed.current) return;\n    pressed.current = true;", "if (busy) return;"],
  ["unsaved words lost silently", "manage", 'window.addEventListener("beforeunload", warn)', 'void warn'],
  ["the draft kept after publishing", "manage", "if (!edit) { setF(blank()); writeDraft(null); }", "if (!edit) { setF(blank()); }"],
  ["an invented field sent", "manage", "audience: f.audience.length ? f.audience : null, ...(edit", "audience: f.audience.length ? f.audience : null, publish_at: null, ...(edit"],
  ["no preview", "manage", 'data-testid="news-preview"', 'data-testid="x-preview"'],
  ["no report export", "manage", "const exportCsv = () => downloadCsv(`news-acknowledgement-report-", "const exportCsv = () => downloadCsv(`report-"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\nnews2: ${failed.length} failed`); process.exit(1); }
console.log(`news2: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);
