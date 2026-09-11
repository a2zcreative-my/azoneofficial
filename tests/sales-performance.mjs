/**
 * SALES PERFORMANCE - evidence, not claims. Guard #76, v1.155.0.
 *
 * The CEO, 11-09-2026: *"I need a system where I can confidently answer:
 * 'Did this staff member actually work on sales today?' without relying only
 * on what they claim."* One sidebar tab, one page, and these properties:
 *
 *   1. THE RULES ARE ONE SET OF RULES. worker/src/sp-rules.ts and its browser
 *      copy lib/sales-performance.ts are bundled and RUN over the same URLs
 *      and the same figures; a single disagreement fails. Two spellings of
 *      one post give one key; a tracking parameter changes nothing; http://
 *      is refused; an Instagram link is not a TikTok post.
 *   2. THE SCORE IS THE CEO'S WEIGHTS: 40/15/15/10/10/5/5, banded 90/75/50,
 *      clamped, and never accepted from a form.
 *   3. THE WORKER DECIDES. Evidence required, platform mismatch refused,
 *      duplicate 409, old post flagged, unapproved account = manual review,
 *      nobody verifies their own record, a verified record is locked to its
 *      author and corrected by management with a reason and a kept diff,
 *      revenue never arrives in a request body, a conversion links a real
 *      invoice, shipped without tracking is refused HERE AND on the postage
 *      routes, a present person with zero verified activity cannot close the
 *      day without an explanation, and every write is audited.
 *   4. THE TAB IS REGISTERED EVERYWHERE a tab must be, the panel reads ONE
 *      endpoint, computes no score, and shows Verify only to management on
 *      someone else's record.
 *   5. THE MIGRATION IS TRIPLE-BUMPED and the daily re-check is on the tick.
 *   6. CRISCIKEE IS GONE (the CEO, same day: "completely drop Criscikee since
 *      this project not going further") - no file, no tab, no door, no
 *      permission, and PUSH.bat removes the files on his machine.
 *
 * Negative-tested by: changing one weight (2); removing the self-verify
 * check (3); dropping `isSpEvidence` from the body exclusion (3); removing
 * the tab from side-nav SECTIONS (4); pointing LATEST_MIGRATION back at
 * 0126 (5); putting "Criscikee" back into ALL_TABS (6).
 *
 * Run: node tests/sales-performance.mjs
 */
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const has = (p) => existsSync(join(root, p));

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const dir = mkdtempSync(join(tmpdir(), "sp-"));
const bundle = async (src, name) => {
  const out = join(dir, name);
  execSync(`npx esbuild "${join(root, src)}" --bundle --format=esm --platform=neutral --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
};
const W = await bundle("worker/src/sp-rules.ts", "worker-rules.mjs");
const B = await bundle("lib/sales-performance.ts", "browser-rules.mjs");

/* ---- 1. one set of rules, run on both sides ---- */
{
  const wBody = read("worker/src/sp-rules.ts"); const bBody = read("lib/sales-performance.ts");
  const from = (s) => s.slice(s.indexOf("export const SP_PLATFORMS"));
  ok("the browser copy is the worker's rules, line for line", from(wBody) === from(bBody));
  ok("the rules file imports nothing", !/^import /m.test(wBody) && !/^import /m.test(bBody));

  const urls = [
    "https://www.tiktok.com/@a2zcreative/video/7350000000000000001",
    "https://tiktok.com/@A2ZCreative/video/7350000000000000001/?is_from_webapp=1&sender_device=pc&utm_source=x",
    "https://m.tiktok.com/@a2zcreative/video/7350000000000000001#top",
    "https://vm.tiktok.com/ZSabc123/",
    "https://www.tiktok.com/@a2zcreative",
    "https://www.instagram.com/p/C1abcDEfgh/?igsh=abc123",
    "https://instagram.com/a2zcreative/p/C1abcDEfgh",
    "https://www.instagram.com/reel/C1abcDEfgh/",
    "https://www.instagram.com/a2zcreative/",
    "https://www.facebook.com/a2zcreative/posts/pfbid0abcXYZ",
    "https://www.facebook.com/A2ZCreative/posts/pfbid0abcXYZ?mibextid=zz&__cft__[0]=q",
    "https://fb.watch/abc-DEF_1/",
    "https://www.facebook.com/photo.php?fbid=123456&set=a.1&type=3",
    "https://www.facebook.com/share/p/1AbCdEf/",
    "https://www.facebook.com/",
    "https://wa.me/60123456789",
    "https://example.com/blog/post?b=2&a=1&utm_campaign=x",
    "https://EXAMPLE.com/blog/post/?a=1&b=2",
    "http://www.tiktok.com/@a2zcreative/video/7350000000000000001",
    "javascript:alert(1)",
    "https://user:pw@www.tiktok.com/@a/video/1",
    "",
    "not a url",
  ];
  let same = true;
  for (const u of urls) if (JSON.stringify(W.readSocialUrl(u)) !== JSON.stringify(B.readSocialUrl(u))) { same = false; console.log(`    disagree on ${u}`); }
  ok("worker and browser read every URL the same way", same);

  const r = (u) => W.readSocialUrl(u);
  ok("a TikTok video is read: platform, key, handle", r(urls[0]).ok && r(urls[0]).platform === "tiktok" && r(urls[0]).key === "tiktok:7350000000000000001" && r(urls[0]).handle === "a2zcreative");
  ok("tracking parameters, case, www/m., a trailing slash and a fragment do not change the post's identity", r(urls[0]).key === r(urls[1]).key && r(urls[1]).key === r(urls[2]).key && r(urls[1]).handle === "a2zcreative");
  ok("a vm. short link is a post (short identity), a bare profile is not", r(urls[3]).ok && r(urls[3]).key === "tiktok:short:zsabc123" && !r(urls[4]).ok);
  ok("Instagram /p/ and /user/p/ are one post; igsh is stripped", r(urls[5]).ok && r(urls[5]).key === "instagram:C1abcDEfgh" && r(urls[6]).key === r(urls[5]).key && r(urls[6]).handle === "a2zcreative");
  ok("an Instagram reel is a post, a profile is not", r(urls[7]).ok && r(urls[7]).platform === "instagram" && !r(urls[8]).ok);
  ok("a Facebook page post names its account and survives mibextid/__cft__", r(urls[9]).ok && r(urls[9]).handle === "a2zcreative" && r(urls[9]).key === r(urls[10]).key);
  ok("fb.watch, photo.php?fbid and /share/p/ are posts; the home page is not", r(urls[11]).ok && r(urls[12]).ok && r(urls[12]).key === "facebook:123456" && r(urls[13]).ok && !r(urls[14]).ok);
  ok("WhatsApp and unknown hosts are kept as 'whatsapp' / 'other' with a stable key", r(urls[15]).platform === "whatsapp" && r(urls[16]).platform === "other" && r(urls[16]).key === r(urls[17]).key);
  ok("http://, javascript:, credentials, empty and garbage are refused", !r(urls[18]).ok && !r(urls[19]).ok && !r(urls[20]).ok && !r(urls[21]).ok && !r(urls[22]).ok);
  ok("an Instagram link is not a TikTok post (the mismatch the worker refuses)", r(urls[5]).platform !== "tiktok");
  ok("the stored URL is https, lower-case host, no tracking, no fragment", r(urls[1]).clean === "https://tiktok.com/@A2ZCreative/video/7350000000000000001" && !r(urls[2]).clean.includes("#"));

  ok("handles normalise: @, case, profile links", W.normalizeHandle("@A2ZCreative") === "a2zcreative" && W.normalizeHandle("https://www.tiktok.com/@A2ZCreative/") === "a2zcreative" && B.normalizeHandle("  a2z  ") === "a2z");
  ok("the same customer by phone, whichever prefix; by name, whichever case", W.customerKey(null, "Ali", "+60 12-345 6789") === W.customerKey(null, "ali bin abu", "0123456789") && W.customerKey(null, " Ali  Abu", null) === B.customerKey(null, "ali abu", ""));
  ok("a customer id wins over everything", W.customerKey(7, "x", "0123456789") === "c:7");
}

/* ---- 2. the score ---- */
{
  const w = W.SP_WEIGHTS;
  ok("the CEO's weights: 40 / 15 / 15 / 10 / 10 / 5 / 5", w.sales === 40 && w.engagement === 15 && w.social === 15 && w.follow_up === 10 && w.orders === 10 && w.shipment === 5 && w.promotion === 5);
  ok("they sum to 100", Object.values(w).reduce((a, b) => a + b, 0) === 100);
  const all = (v) => Object.fromEntries(Object.keys(w).map((k) => [k, v]));
  ok("all components met = 100, none = 0, sales alone = 40", W.spScore(all(1)) === 100 && W.spScore(all(0)) === 0 && W.spScore({ ...all(0), sales: 1 }) === 40);
  ok("a component over 100% is clamped - busy cannot buy points", W.spScore({ ...all(0), social: 5 }) === 15 && W.spScore({ ...all(0), sales: -1 }) === 0);
  ok("the browser scores identically", [all(1), all(0), { ...all(0.5), sales: 0.2 }].every((c) => W.spScore(c) === B.spScore(c)));
  const band = (s) => W.spBand(s).code;
  ok("bands: 90 excellent, 75 good, 50 needs improvement, below poor", band(100) === "excellent" && band(90) === "excellent" && band(89) === "good" && band(75) === "good" && band(74) === "needs_improvement" && band(50) === "needs_improvement" && band(49) === "poor" && band(0) === "poor");
  ok("busy but not selling reads LOW SALES PERFORMANCE", W.spBusyVsProductive({ activity: 1, engagement: 0.8, conversion: 0.05, revenue: 0.1 }).verdict === "low_sales");
  ok("selling well reads strong; the rest balanced", W.spBusyVsProductive({ activity: 0.5, engagement: 0.5, conversion: 0.3, revenue: 0.9 }).verdict === "strong" && W.spBusyVsProductive({ activity: 0.2, engagement: 0.2, conversion: 0.1, revenue: 0.4 }).verdict === "balanced");
  ok("a zero denominator is a zero ratio, not NaN", W.ratio(3, 0) === 0 && W.ratio(3, 4) === 0.75 && W.ratio(9, 4) === 1);
}

/* ---- 3. the worker decides ---- */
{
  const sp = read("worker/src/sales-performance.ts");
  const staff = read("worker/src/staff.ts");
  const perms = read("worker/src/permissions.ts");
  ok("the module is gated by sales_perf_view before any route", /if \(!can\(user\.role, "sales_perf_view"\)\) return err\("forbidden"/.test(sp) && sp.indexOf('can(user.role, "sales_perf_view")') < sp.indexOf('path === "/overview"'));
  ok("a staff member's scope is their own id; only a manager picks a staff filter", /if \(!manager\) \{[\s\S]*?return \{ ids: \[me\]/.test(sp));
  ok("a post needs a screenshot the worker can find in R2", /const evidence = await evidenceOk\(body\?\.evidence_key\);\s*if \(!evidence\) return err\("evidence_required"/.test(sp) && /env\.MEDIA\.head\(key\)/.test(sp));
  ok("a platform mismatch is refused with the CEO's sentence", /err\("platform_mismatch", "Platform mismatch\. Please submit the correct social media post URL\."/.test(sp));
  ok("a duplicate post is refused (409) by its normalised identity, and the UNIQUE index backs it", /WHERE url_key = \?1 AND deleted_at IS NULL/.test(sp) && /err\("duplicate", "Duplicate Post - This post has already been submitted\.", 409\)/.test(sp) && /idx_sp_posts_key ON sp_social_posts\(url_key\)/.test(read("worker/migrations/0127_sales_performance.sql")));
  ok("a post older than yesterday is flagged old_post; an unapproved account is manual_review", /if \(postedDay < addDays\(today, -1\)\) flags\.push\("old_post"\)/.test(sp) && /flags\.includes\("old_post"\) \? "old_post" : accountMatch \? "pending" : "manual_review"/.test(sp));
  ok("the account is matched against sp_social_accounts, not the typist's word", /FROM sp_social_accounts WHERE platform = \?1 AND handle = \?2 AND is_active = 1/.test(sp));
  ok("nobody verifies their own record - posts, engagements, promotions, other", (sp.match(/if \(Number\(row\.user_id\) === me\) return err\("forbidden", "You cannot verify your own/g) ?? []).length === 4);
  ok("verifying is management's alone", (sp.match(/if \(!manager\) return err\("forbidden", "Only management verif/g) ?? []).length === 4);
  ok("a verified post is locked to its author; the URL, evidence and date never move by the author", /if \(verified && !manager\) return err\("locked", "A verified post cannot be changed/.test(sp) && /"url" in body \|\| "evidence_key" in body \|\| "posted_at" in body/.test(sp) && /if \(verified\) return err\("locked", "A verified post is a permanent record/.test(sp));
  ok("management corrects with a reason and the diff is audited", /if \(verified && manager && !reason\) return err\("invalid_input", "A reason is required to correct a verified record"/.test(sp) && /"sp\.post_correct" : "sp\.post_edit", "sp_social_posts", id, \{ diff, reason \}/.test(sp));
  ok("an order-linked engagement is as locked as a verified one", /const locked = row\.status === "verified" \|\| row\.order_doc_id != null;/.test(sp));
  ok("revenue never arrives in a request body", !/body\??\.\!?\.?(revenue|sales_cents|total_cents|amount|score|paid)/.test(sp) && !/body\[?"?(revenue|sales_cents|total_cents|amount|score)/.test(sp));
  ok("revenue is the invoice's total, by salesperson, from sales_documents", /SUM\(d\.total_cents\)[\s\S]*?FROM sales_documents d\s+WHERE d\.doc_type = 'INV' AND d\.salesperson_id IN/.test(sp));
  ok("a conversion links a real INVOICE, and a staff member only their own", /FROM sales_documents WHERE id = \?1 AND doc_type = 'INV'/.test(sp) && /if \(!manager && d\.salesperson_id !== me\) return \{ error: "That invoice is not yours/.test(sp));
  ok("a conversion is COUNT(DISTINCT order_doc_id), not a checkbox", /COUNT\(DISTINCT order_doc_id\) AS conv/.test(sp));
  ok("only verified posts with verified metrics reach the funnel's reach", /status = 'verified' AND metrics_status = 'verified' THEN COALESCE\(views, 0\)/.test(sp));
  ok("only verified things count as verified activity", /SUM\(CASE WHEN status = 'verified' OR order_doc_id IS NOT NULL THEN 1 ELSE 0 END\) AS verified/.test(sp) && /f\.verified_activities \+= r\.verified/.test(sp) && /f\.verified_activities \+= f\.orders/.test(sp));
  ok("the score is computed in the worker from the figures, never read from a form", /export function scoreOf\(f: Figures, settings: SpSettings, days: number\)/.test(sp) && /const score = spScore\(components\);/.test(sp) && !/body\??\.score/.test(sp));
  ok("shipped without a tracking number is refused on the Sales Performance route", (sp.match(/if \(SP_TRACKING_REQUIRED\.includes\(status\) && !tracking\) return err\("tracking_required"/g) ?? []).length === 2);
  ok("...and on the postage routes it shares (create and update)", /SP_TRACKING_REQUIRED\.includes\(body\.status as string\) && !str\(body\.tracking_no, 120\)\) \{\s*return err\("tracking_required"/.test(staff) && /if \(!str\(have\.tracking_no, 120\)\) return err\("tracking_required"/.test(staff));
  ok("a shipment names an invoice, one per order", /if \("error" in ol \|\| ol\.id === null\) return err\("invalid_input"/.test(sp) && /already has a shipment record/.test(sp));
  ok("a present person with no verified activity cannot close the day silently", /const noActivity = f\.present && f\.verified_activities === 0;/.test(sp) && /if \(noActivity && !reason\) return err\("explanation_required", "NO VERIFIED SALES ACTIVITY/.test(sp));
  ok("the closing snapshots the system's figures and upserts one row per day", /ON CONFLICT\(user_id, day\) DO UPDATE SET snapshot = \?3/.test(sp) && /JSON\.stringify\(snapshot\)/.test(sp));
  ok("a day that has not happened cannot be closed", /if \(day > mytToday\(\)\) return err\("invalid_input", "You cannot close a day that has not happened"/.test(sp));
  ok("every write is audited", (sp.match(/await audit\(env, /g) ?? []).length >= 24);
  ok("the audit history is management's, over a whitelist of entities", /if \(!manager\) return err\("forbidden", "Only management reads the audit history"/.test(sp) && /\^\(sp_social_posts\|sp_engagements\|sp_promotions\|sp_other_activities\|sp_daily_closings\|postage_records\|sp_social_accounts\|system_meta\)\$/.test(sp));
  ok("evidence is served only to its owner or a manager", /if \(!manager\) \{[\s\S]*?WHERE evidence_key = \?1 AND user_id = \?2 LIMIT 1/.test(sp) && /return err\("forbidden", "Not your evidence", 403\)/.test(sp));
  ok("evidence uploads are typed and capped", /EVIDENCE_TYPES = \["image\/jpeg", "image\/png", "image\/webp"\]/.test(sp) && /EVIDENCE_MAX = 8 \* 1024 \* 1024/.test(sp));
  ok("the verified-post re-check marks a gone post unavailable and keeps it", /export async function spRecheckPosts/.test(sp) && /const gone = http === 404 \|\| http === 410;/.test(sp) && /gone \? "unavailable" : "verified"/.test(sp));
  ok("every mutation leaves a soft-deleted row, never a hard delete", !/DELETE FROM sp_/.test(sp));

  ok("permissions: sales_perf_view and sales_perf_manage exist, manage within view", /sales_perf_view: \[/.test(perms) && /sales_perf_manage: \["super_admin", "admin", "ceo", "coo", "cco"\]/.test(perms));
  const list = (src, key) => [...(src.match(new RegExp(`${key}: \\[([^\\]]*)\\]`))?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const manage = list(perms, "sales_perf_manage"), view = list(perms, "sales_perf_view");
  ok("...literally: every manager can view", manage.every((r) => view.includes(r)));
  ok("hr_admin is not a sales role and is not on the tab", !view.includes("hr_admin"));

  ok("staff.ts: the door hands /sales-performance/* to the module", /if \(path === "\/sales-performance" \|\| path\.startsWith\("\/sales-performance\/"\)\) \{\s*return handleSalesPerformance\(env, request, path\.slice\("\/sales-performance"\.length\), method, body, user, new URL\(request\.url\)\.searchParams\);/.test(staff));
  ok("staff.ts: the evidence upload is a raw body, excluded from JSON parsing by name", /const isSpEvidence = path === "\/sales-performance\/evidence";/.test(staff) && /&& !isSpEvidence &&/.test(staff));
  ok("staff.ts: the tab can be granted and revoked", /TAB_ACCESS_TABS = \[[^\]]*"Sales Performance"/.test(staff));
}

/* ---- 4. one tab, one page ---- */
{
  const tabs = read("lib/portal-tabs.ts");
  const perms = read("worker/src/permissions.ts");
  const nav = read("components/layout/side-nav.tsx");
  const i18n = read("lib/i18n.ts");
  const icons = read("components/layout/nav-icons.tsx");
  const lazy = read("components/portal/lazy-panels.tsx");
  const page = read("app/portal/page.tsx");
  const panel = read("components/portal/sales-performance-panel.tsx");
  const allTabs = [...(tabs.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  ok("ALL_TABS carries Sales Performance, behind the Sales pair, sixth (the phone thumb row is untouched)", allTabs.indexOf("Sales Performance") === 5 && allTabs[3] === "Sales" && allTabs[4] === "Enquiries");
  const roles = [...(tabs.match(/"Sales Performance": \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  const view = [...(perms.match(/sales_perf_view: \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  ok("TAB_ROLES mirrors sales_perf_view exactly", JSON.stringify(roles) === JSON.stringify(view), `${roles} vs ${view}`);
  ok("the tab has a hint, a section, a translation, an icon, a lazy wrapper and a render", /"Sales Performance": \{ en: "evidence, not claims"/.test(tabs) && /"Sales", "Enquiries", "Sales Performance"/.test(nav) && /"Sales Performance": \{ en: "Sales Performance", ms: "Prestasi Jualan" \}/.test(i18n) && /"Sales Performance": Target/.test(icons) && /export const SalesPerformancePanel = lazy\(\(\) => import\("@\/components\/portal\/sales-performance-panel"\)/.test(lazy) && /\{activeTab === "Sales Performance" && <SalesPerformancePanel go=/.test(page));
  ok("the panel is ONE page: no SectionTabs, no sub-routes - collapsible sections and drawers", !/SectionTabs/.test(panel) && (panel.match(/<Section id="sp-/g) ?? []).length === 9 && /function Drawer\(/.test(panel));
  ok("the sections run in the CEO's order", ["sp-feed", "sp-posts", "sp-engagements", "sp-promotions", "sp-orders", "sp-shipments", "sp-funnel", "sp-trend", "sp-closing"].every((id, i, a) => i === 0 || panel.indexOf(`id="${a[i - 1]}"`) < panel.indexOf(`id="${id}"`)));
  ok("the whole page is ONE read, remembered and live", /useCachedApi<Overview>\(`\/staff\/sales-performance\/overview\?\$\{qs\}`, true, TOPICS\)/.test(panel) && /const TOPICS = \["sales-performance", "docs", "postage"\]/.test(panel));
  ok("the browser computes no score and no figure - it only labels the weights", !/spScore\(|spBand\(|spBusyVsProductive\(/.test(panel) && /SP_WEIGHTS\[k\]/.test(panel));
  ok("the URL pre-check uses the worker's own rules", /readSocialUrl\(url\)/.test(panel) && /from "@\/lib\/sales-performance"/.test(panel));
  ok("Verify is drawn only for management on someone else's record", (panel.match(/manager && !own && [^\n]*L\("Verify", "Sahkan"\)/g) ?? []).length >= 3 && /manager && !mine\(o\.user_id\)[^\n]*\{L\("Verify", "Sahkan"\)\}/.test(panel));
  ok("re-deciding a verified post is a correction: reason required on both sides", /if \(verified && decision !== "verified" && !str\(body\?\.note, 300\)\) return err\("invalid_input", "A reason is required to change a verified decision"/.test(read("worker/src/sales-performance.ts")) && /if \(wasVerified && !note\.trim\(\)\)/.test(panel));
  ok("the screenshot is mandatory on the post form and uploaded raw with the CSRF token", /<EvidenceUpload value=\{evidence\} onChange=\{setEvidence\} required toast=\{toast\} \/>/.test(panel) && /csrfFetch\(EVIDENCE_URL, \{ method: "POST", headers: \{ "Content-Type": ct \}, body: blob \}\)/.test(panel));
  ok("NO VERIFIED SALES ACTIVITY is shown and explained before a closing", /NO VERIFIED SALES ACTIVITY/.test(panel) && /noActivity && !text\.no_activity_reason\.trim\(\)/.test(panel));
  ok("TRACKING UPDATE REQUIRED is flagged on the row and refused on the form", /TRACKING UPDATE REQUIRED/.test(panel) && /const needsTracking = SP_TRACKING_REQUIRED\.includes\(status\) && !tracking\.trim\(\);/.test(panel));
  ok("an order is an invoice - the page sends you to Sales to raise one, it does not invent one", /go\("Sales"\)/.test(panel) && !/api<[^>]*>\(`\/orders`/.test(panel));
  ok("the dialog nodes sit at the panel's top level", /\{toastNode\}\s*\{confirmNode\}\s*<\/div>\s*\);\s*\}/.test(panel));
  ok("every string is bilingual - no bare English button labels", !/<button[^>]*>\s*[A-Z][a-z]+\s*<\/button>/.test(panel));
}

/* ---- 5. the migration, triple-bumped; the tick ---- */
{
  const index = read("worker/src/index.ts");
  const mig = read("worker/migrations/0127_sales_performance.sql");
  const latest = index.match(/const LATEST_MIGRATION = "(\d+)_/)?.[1] ?? "0";
  ok("LATEST_MIGRATION is at or past 0127", Number(latest) >= 127, latest);
  ok("EXPECTED_MIGRATIONS lists 0127 and the health probe reads sp_social_posts", /"0127_sales_performance",/.test(index) && /\["0127 \(Sales Performance register\)", `SELECT url_key FROM sp_social_posts LIMIT 1`\]/.test(index));
  ok("the migration makes the six tables, no FOREIGN KEY, one closing per person per day", ["sp_social_accounts", "sp_social_posts", "sp_engagements", "sp_promotions", "sp_other_activities", "sp_daily_closings"].every((t) => mig.includes(`CREATE TABLE IF NOT EXISTS ${t} (`)) && !/FOREIGN KEY/.test(mig.replace(/^--.*$/gm, "")) && /idx_sp_closing_day ON sp_daily_closings\(user_id, day\)/.test(mig));
  ok("the daily re-check runs on the 09:00 MYT tick, in its own try/catch", /if \(event\.cron === "0 1 \* \* \*"\) \{[\s\S]*?try \{ await spRecheckPosts\(env\); \}\s*catch/.test(index));
}

/* ---- 6. Criscikee is gone ---- */
{
  ok("no Criscikee file remains", !has("components/portal/criscikee-panel.tsx") && !has("lib/criscikee.ts") && !has("worker/src/criscikee.ts") && !has("tests/criscikee.mjs"));
  const tabs = read("lib/portal-tabs.ts"), staff = read("worker/src/staff.ts"), perms = read("worker/src/permissions.ts"), nav = read("components/layout/side-nav.tsx"), page = read("app/portal/page.tsx"), lazy = read("components/portal/lazy-panels.tsx"), guards = read("scripts/run-guards.mjs");
  ok("no tab, no door, no permission, no section, no render, no lazy wrapper, no guard entry", ![tabs, staff, perms, nav, page, lazy].some((s) => /riscikee/.test(s)) && !/\["criscikee",/.test(guards));
  ok("PUSH.bat removes the retired files on the CEO's machine before anything is checked", /Removing the files of retired features/.test(read("PUSH.bat")) && /"components\\portal\\criscikee-panel\.tsx" "lib\\criscikee\.ts" "worker\\src\\criscikee\.ts" "tests\\criscikee\.mjs"/.test(read("PUSH.bat")));
  ok("migration 0125 stays - history is not rewritten", has("worker/migrations/0125_criscikee.sql") && /"0125_criscikee",/.test(read("worker/src/index.ts")));
}

console.log(failed === 0
  ? `sales-performance: ${passed} checks passed.`
  : `\n${failed} sales-performance check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
