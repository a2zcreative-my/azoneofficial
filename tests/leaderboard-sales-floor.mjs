/* v1.25.5 — the CEO: "my Sales Marketing should include into this Sales
   leaderboard — this month". NUR NASUHA (sales_marketing) had no attributed
   sales, so the old `.filter(sales > 0 || target)` dropped her line entirely
   and the board read as if sales_marketing does not sell.

   This guard asserts two things at once:
     1) SERVER RULE — the sales floor (sales_marketing, live_host, cco,
        marketing) survives the leaderboard filter at zero sales, while a
        non-selling role (editor) still does not. The role list is read from
        worker/src/staff.ts so the test tracks the source, not a copy.
     2) RENDERED BOARD — with a zero-sales sales_marketing row in the payload,
        the portal actually paints her name, shows "—" instead of a rank, and
        carries no emoji anywhere in the card (house rule: SVG/lucide only).
   Run: node tests/leaderboard-sales-floor.mjs   (needs out/ served on :8931) */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

/* ---------- 1. the rule, read out of the worker source ---------- */
const src = readFileSync(new URL('../worker/src/staff.ts', import.meta.url), 'utf8');
const m = src.match(/const LEADERBOARD_ALWAYS_ROLES = \[([^\]]*)\]/);
if (!m) { console.error('FAIL — LEADERBOARD_ALWAYS_ROLES not found in worker/src/staff.ts'); process.exit(2); }
const ALWAYS = m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
const filterLine = src.includes('LEADERBOARD_ALWAYS_ROLES.includes(r.role)');
const ruleErrors = [];
for (const role of ['sales_marketing', 'live_host', 'cco']) {
  if (!ALWAYS.includes(role)) ruleErrors.push(`${role} missing from LEADERBOARD_ALWAYS_ROLES`);
}
// v1.25.6 (CEO): "Marketing doesnt make any sales on TikTok!" — marketing is
// OFF the board and never in the clock-in attribution.
if (ALWAYS.includes('marketing')) ruleErrors.push('marketing must NOT be always-listed (CEO removed it, v1.25.6)');
if (ALWAYS.includes('editor')) ruleErrors.push('editor should NOT be an always-listed sales-floor role');
if (!filterLine) ruleErrors.push('the /leaderboard filter no longer consults LEADERBOARD_ALWAYS_ROLES');
if (!/FROM manual_sales/.test(src)) ruleErrors.push('manual/walk-in sales are not attributed to the person who recorded them');
if (!/shiftSalesSplit\(punches, orders, nowUtc\)/.test(src)) ruleErrors.push('clock-in TikTok attribution (shiftSalesSplit) is not wired into attributedSalesByUser');
if (!/role = 'sales_marketing'/.test(src)) ruleErrors.push('clock-in attribution must be scoped to sales_marketing only');
console.log(`rule: always-listed = [${ALWAYS.join(', ')}] · filter wired = ${filterLine} · manual_sales credited = ${/FROM manual_sales/.test(src)} · clock-in attribution wired = ${/shiftSalesSplit\(punches, orders, nowUtc\)/.test(src)}`);

/* ---------- 2. the rendered board ---------- */
const LISTY = ['claims','leaves','tasks','announcements','users','entries','lines','cities','sessions','requests','hosts','records','items','banks','movements','invoices','orders','products','assets','prospects','notes','birthdays','punches','holidays','expenses','payslips','targets','user_targets','team_targets','rules','buckets','categories','accounts','suppliers','alerts','logs','events','comments','files','sales','days','rows','rates','staff','members','videos','contents','posts','stokis','codes','returns','stockouts','conflicts','free_today','unassigned','customers','docs','clients','credit_notes','packages','receipts','reconciliations','leave','enquiries','materials','outs'];
// Keys the Ecommerce cards read as objects, not arrays — a missing by_status
// crashes the fulfilment card and takes the whole tab down with it.
const OBJY = ['by_status', 'by_courier', 'summary', 'totals', 'stats', 'counts', 'connection', 'health', 'by_state', 'geo', 'pipeline', 'breakdown', 'settings', 'config'];
const BOARD = { month: '2026-08', has_rules: false, me_included: true, me: 1, rows: [
  { user_id: 7, name: 'NUR DINI FARHANA BINTI NAZARUDIN', role: 'live_host', photo_key: null, sales_cents: 3280, target_cents: null, pct: null, commission_cents: 0, rank: 1 },
  { user_id: 8, name: 'MOHAMAD IZZUDIN BIN AMDAN', role: 'cco', photo_key: null, sales_cents: 1000, target_cents: null, pct: null, commission_cents: 0, rank: 2 },
  { user_id: 9, name: 'NUR NASUHA BINTI ROSLI', role: 'sales_marketing', photo_key: null, sales_cents: 0, target_cents: null, pct: null, commission_cents: 0, rank: null },
]};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
await p.route('**/api/v1/**', async (route) => {
  const url = new URL(route.request().url()).pathname;
  let body = {}; for (const k of LISTY) body[k] = []; for (const k of OBJY) body[k] = {};
  body.has_rules = false; body.days = 7; body.total_cents = 0; body.month = '2026-08';
  if (url.includes('/auth/me')) body = { user: { id: 1, email: 'ceo@azoneofficial.com', name: 'Alif', role: 'ceo' } };
  else if (url.includes('/staff/leaderboard')) body = BOARD;
  else if (url.includes('/staff/revenue') && !url.includes('/lines')) body = { month: '2026-08', tiktok: { this_cents: 0, this_orders: 0, last_cents: 0, last_orders: 0 }, invoiced: { this_cents: 0, this_docs: 0, last_cents: 0, last_docs: 0 } };
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await p.goto('http://localhost:8931/portal.html', { waitUntil: 'domcontentloaded' });
// the board lives on the Ecommerce tab. On desktop the sidebar is an icon
// rail, so the label lives on aria-label, not in the text.
await p.waitForSelector('button[aria-label="Ecommerce"]', { timeout: 20_000 }).catch(() => {});
await p.locator('button[aria-label="Ecommerce"]').first().click().catch(() => {});
await p.waitForTimeout(2500);
const cardText = await p.evaluate(() => {
  const head = [...document.querySelectorAll('p')].find((n) => /Sales leaderboard/.test(n.textContent || ''));
  return head ? (head.closest('div')?.innerText ?? '') : '';
});
const errors = [...ruleErrors];
if (!cardText) errors.push('the Sales leaderboard card did not render at all (precondition failed — is out/ served on :8931?)');
else {
  if (!cardText.includes('NUR NASUHA')) errors.push('the zero-sales sales_marketing person is not on the rendered board');
  if (!/—/.test(cardText)) errors.push('the unranked row shows no dash in the rank column');
  const emoji = (cardText.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu) || []).filter((c) => c !== '️');
  if (emoji.length) errors.push(`emoji in the leaderboard card: ${[...new Set(emoji)].join(' ')}`);
}
await p.screenshot({ path: '/root/azone/shots/leaderboard-sales-floor.png', fullPage: false });
await b.close();
console.log(cardText ? `\ncard:\n${cardText}\n` : '\ncard: (not found)\n');
if (errors.length) { console.log('FAIL\n - ' + errors.join('\n - ')); process.exit(1); }
console.log('PASS — the sales floor is on the board, unranked lines read "—", no emoji');
