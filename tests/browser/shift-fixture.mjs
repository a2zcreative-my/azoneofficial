/* v1.373.0 - Shift Templates bulk assignment in the browser fixture
   (serve.mjs, SHIFTS=1). Invented people only. The worker's own rules
   (tomorrow or later, hr_manage, one conditional insert each, conflicts,
   released months, audit) are proven by tests/shift-bulk.mjs; this mirrors
   the preview and the save so the screens can be driven end to end. */
const ON = !!process.env.SHIFTS;
const ROLE = process.env.ROLE ?? "ceo";
const HR = ["ceo", "super_admin", "admin", "hr_admin"].includes(ROLE);
const myt = (off = 0) => new Date(Date.now() + 8 * 3600_000 + off * 86400_000).toISOString().slice(0, 10);
const wk = (s, e, fri = e) => ({ mon_start: s, mon_end: e, tue_start: s, tue_end: e, wed_start: s, wed_end: e, thu_start: s, thu_end: e, fri_start: s, fri_end: fri, sat_start: null, sat_end: null, sun_start: null, sun_end: null });
const PATTERNS = [
  { id: 1, name: "Office", category: "normal", is_default: 1, half_day_minutes: 720, break_minutes: 60, ...wk(540, 1020, 990) },
  { id: 2, name: "Morning", category: "normal", is_default: 0, half_day_minutes: 720, break_minutes: 60, ...wk(510, 990) },
  { id: 3, name: "Afternoon", category: "afternoon", is_default: 0, half_day_minutes: 900, break_minutes: 60, ...wk(660, 1140) },
  { id: 4, name: "Evening", category: "evening", is_default: 0, half_day_minutes: 1080, break_minutes: 60, ...wk(840, 1320) },
  { id: 5, name: "Live Weekend", category: "custom", is_default: 0, half_day_minutes: 900, break_minutes: 60, ...wk(null, null), sat_start: 600, sat_end: 1080, sun_start: 600, sun_end: 1080 },
];
const STAFF = [
  [9001, "Fixture Person", "ceo", "Management"], [9002, "Aina Sofea binti Kamal", "sales_marketing", "Sales"], [9003, "Danial Hakim bin Roslan", "live_host", "Live"],
  [9004, "Tan Mei Ling", "hr_admin", "HR"], [9005, "Haziq Imran bin Salleh", "editor", "Creative"], [9006, "Nur Iman binti Azlan", "marketing", "Marketing"],
  [9007, "Kavitha a/p Raman", "sales_marketing", "Sales"], [9008, "Amirul Hafiz bin Zainal", "live_host", "Live"], [9009, "Siti Hajar binti Musa", "editor", "Creative"],
  [9010, "Lee Wei Han", "marketing", "Marketing"], [9011, "Farah Nadia binti Yusof", "sales_marketing", "Sales"], [9012, "Iskandar bin Ahmad", "live_host", "Live"],
].map(([id, name, role, department]) => ({ id, name, role, department, position: null, employment_status: "confirmed" }));
const init = () => ({
  assignments: [
    { id: 1, user_id: 9002, pattern_id: 1, effective_from: "2026-09-01" }, { id: 2, user_id: 9003, pattern_id: 3, effective_from: "2026-09-14" },
    { id: 3, user_id: 9004, pattern_id: 1, effective_from: "2026-09-01" }, { id: 4, user_id: 9007, pattern_id: 2, effective_from: "2026-10-12" },
    { id: 5, user_id: 9008, pattern_id: 4, effective_from: "2026-10-01" }, { id: 6, user_id: 9011, pattern_id: 1, effective_from: myt(10) },
  ],
  next: 7, posts: [],
});
let st = init();
export const resetShifts = () => { st = init(); };
export const shiftState = () => st;
const named = (a) => ({ ...a, pattern_name: PATTERNS.find((p) => p.id === a.pattern_id)?.name ?? "?", name: STAFF.find((s) => s.id === a.user_id)?.name ?? "?" });

/** null = not a shift route; else { status, data } */
export function shiftRoute(method, p, body) {
  if (!ON) return null;
  if (p === "/staff/shift-patterns" && method === "GET") return { status: 200, data: { patterns: PATTERNS, assignments: st.assignments.map(named) } };
  if ((p === "/staff/staff-list" || p === "/staff-list") && method === "GET") return { status: 200, data: { staff: STAFF } };
  if (p === "/staff/attendance/pending" && method === "GET") return { status: 200, data: { pending: [] } };
  if (p !== "/staff/staff-shifts/bulk") return null;
  if (!HR) return { status: 403, data: { error: { code: "forbidden", message: "Only scheduling management assigns working hours" } } };
  st.posts.push(body);
  const from = String(body?.effective_from ?? "");
  if (from < myt(1)) return { status: 400, data: { error: { code: "date_too_early", message: `A bulk assignment starts tomorrow (${myt(1)}) or later - days that have started keep their hours.` } } };
  const pat = PATTERNS.find((x) => x.id === Number(body?.pattern_id));
  if (!pat) return { status: 404, data: { error: { code: "not_found", message: "That working-hours pattern is no longer available - pick another." } } };
  const def = PATTERNS.find((x) => x.is_default);
  const rows = (body?.user_ids ?? []).map((uid) => {
    const s = STAFF.find((x) => x.id === uid);
    if (!s) return { user_id: uid, name: null, state: "refused", reason: "Not on staff - only current staff are assigned working hours.", previous: null, warnings: [] };
    const mine = st.assignments.filter((a) => a.user_id === uid).sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.id - a.id);
    const before = mine.find((a) => a.effective_from <= from);
    const previous = before ? { pattern_id: before.pattern_id, name: named(before).pattern_name, from: before.effective_from } : { pattern_id: def.id, name: def.name, from: null };
    const warnings = mine.filter((a) => a.effective_from > from).map((a) => `${named(a).pattern_name} is already planned from ${a.effective_from} and will still take over then.`);
    const same = mine.find((a) => a.effective_from === from);
    if (same && same.pattern_id === pat.id) return { user_id: uid, name: s.name, state: "no_change", reason: `Already assigned ${pat.name} from ${from}.`, previous, warnings };
    if (same) return { user_id: uid, name: s.name, state: "conflict", reason: `${named(same).pattern_name} already starts on ${from} - move or withdraw it first.`, previous, warnings };
    if (previous.pattern_id === pat.id) return { user_id: uid, name: s.name, state: "no_change", reason: `Already on ${pat.name} on ${from}.`, previous, warnings };
    return { user_id: uid, name: s.name, state: "change", reason: null, previous, warnings };
  });
  const counts = (r) => ({ change: r.filter((x) => x.state === "change").length, no_change: r.filter((x) => x.state === "no_change").length, conflict: r.filter((x) => x.state === "conflict").length, refused: r.filter((x) => x.state === "refused").length });
  if (body?.dry_run) return { status: 200, data: { ok: true, dry_run: true, pattern: { id: pat.id, name: pat.name }, effective_from: from, rows, counts: counts(rows) } };
  let saved = 0;
  for (const r of rows) if (r.state === "change" && !st.assignments.some((a) => a.user_id === r.user_id && a.effective_from === from)) { st.assignments.push({ id: st.next++, user_id: r.user_id, pattern_id: pat.id, effective_from: from }); saved++; }
  return { status: 200, data: { ok: true, pattern: { id: pat.id, name: pat.name }, effective_from: from, saved, rows, counts: { ...counts(rows), change: saved } } };
}
