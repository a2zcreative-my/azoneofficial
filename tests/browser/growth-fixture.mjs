/* v1.369.0 - the Business Growth Check in the browser fixture (serve.mjs).
   Invented people and businesses only. The worker's own rules (one enquiry, no
   account / customer / sale, the claim lock, the same WhatsApp added to the
   open enquiry, agents refused, Qualified is not a sale) are proven by
   tests/business-growth.mjs; this mirrors them so the screens can be driven
   end to end, per ROLE. GROWTH=1 adds the bell notices. */
const ROLE = process.env.ROLE ?? "ceo";
const NEVER = ["agent", "customer"].includes(ROLE);
const VIEW = !NEVER && ["super_admin", "admin", "ceo", "coo", "cco", "sales_marketing", "marketing", "hr_admin"].includes(ROLE);
const MANAGE = VIEW && ["super_admin", "admin", "ceo", "coo", "cco"].includes(ROLE);
const ME = 9001;
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString().slice(0, 19).replace("T", " ");
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const base = (id, over) => ({
  id, ref: `A2Z-1811${String(id).padStart(2, "0")}`, full_name: "Aina Rahman", whatsapp: "+60123456789", email: null, business_name: "Aina Bakes", industry: "food_beverage", industry_other: null, city: "Johor Bahru", state: "johor",
  social_url: "instagram.com/ainabakes", source: "facebook", source_detail: null, utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "growth_nov", utm_term: null, utm_content: null, referrer: null, landing_path: "/apply/business",
  challenges: ["low_sales", "content"], challenge_other: null, urgent_problem: "Sales dropped since last month and we do not know why.", goal_90d: "Thirty new customers a month from Instagram.",
  platforms: ["instagram", "whatsapp"], interests: ["creative_content"], contact_method: "whatsapp", contact_time: "evening",
  consent_contact: 1, consent_privacy: 1, consent_marketing: 0, privacy_version: "2026-07-24", consent_at: ago(1), lang: "ms",
  status: "new", owner_id: null, owner_name: null, picked_at: null, first_response_at: null, contact_attempts: 0, next_follow_up_on: null, problem_summary: null, advice_summary: null, advice_at: null, advice_by: null, advice_by_name: null,
  outcome_reason: null, closed_at: null, closed_by: null, closed_by_name: null, quotation_id: null, resubmissions: 0, last_submitted_at: null, version: 1, created_at: ago(1), updated_at: null,
  overdue: false, accepted: false, verified: false, ...over,
});
const init = () => ({
  rows: [
    base(6, { full_name: "Hafiz Ismail", business_name: "Kopi Hafiz", industry: "food_beverage", city: "Shah Alam", state: "selangor", whatsapp: "+60173334444", source: "tiktok", utm_campaign: "tt_growth", challenges: ["few_customers", "social_reach", "ads_results"], created_at: ago(0.4) }),
    base(5, { full_name: "Nurul Aina", business_name: "Butik Nurul", industry: "fashion_beauty", city: "Kota Bharu", state: "kelantan", whatsapp: "+60198887777", source: "instagram", utm_campaign: null, challenges: ["weak_brand"], status: "assigned", owner_id: ME, owner_name: "Fixture Person", picked_at: ago(2), created_at: ago(3), version: 2 }),
    base(4, { full_name: "Lim Wei Jie", business_name: "LWJ Auto Care", industry: "automotive", city: "Ipoh", state: "perak", whatsapp: "+60124445555", source: "google", challenges: ["online_store", "competition"], status: "contacted", owner_id: 9002, owner_name: "Hafiz Rahman", picked_at: ago(26), first_response_at: ago(25), contact_attempts: 2, next_follow_up_on: today(), created_at: ago(27), version: 4 }),
    base(3, { full_name: "Siti Zubaidah", business_name: "Zubaidah Catering", city: "Melaka", state: "melaka", whatsapp: "+60136667777", source: "referral", source_detail: "A client of A2Z", challenges: ["no_strategy", "no_time"], status: "advice_delivered", owner_id: ME, owner_name: "Fixture Person", picked_at: ago(50), first_response_at: ago(49), contact_attempts: 1, problem_summary: "No plan and no time to post.", advice_summary: "Batch-film four short videos every Sunday.", advice_at: ago(30), advice_by: ME, advice_by_name: "Fixture Person", created_at: ago(52), version: 6 }),
    base(2, { full_name: "Ravi Kumar", business_name: "RK Tuition Centre", industry: "education", city: "George Town", state: "pulau_pinang", whatsapp: "+60145556666", source: "website", challenges: ["few_customers"], status: "qualified", owner_id: ME, owner_name: "Fixture Person", picked_at: ago(100), first_response_at: ago(99), contact_attempts: 3, advice_at: ago(80), advice_summary: "Run a parents' open day.", outcome_reason: "Wants an ads package quoted", created_at: ago(110), version: 8 }),
    base(1, { full_name: "Ahmad Zaki", business_name: "Zaki Agro", industry: "agriculture", city: "Kuantan", state: "pahang", whatsapp: "+60112223333", source: "event", challenges: ["low_sales"], status: "not_interested", owner_id: 9002, owner_name: "Hafiz Rahman", picked_at: ago(300), first_response_at: ago(299), contact_attempts: 1, outcome_reason: "Closing the farm stall this year", closed_at: ago(200), created_at: ago(320), version: 5 }),
  ],
  events: {},
  posts: [],
  next: 7,
});
let st = init();
export const resetGrowth = () => { st = init(); };
export const growthState = () => st;
const ev = (id, kind, body, from = null, to = null, channel = null) => { (st.events[id] ??= []).push({ id: Date.now() + Math.random(), kind, body, channel, status_from: from, status_to: to, created_at: ago(0), actor: kind === "submitted" ? null : "Fixture Person" }); };
/* worker/src/growth.ts actionsFor, for this fixture's ROLE */
const can = (a) => {
  const works = a.owner_id === ME || MANAGE;
  const open = a.status !== "not_interested";
  const reached = ["contacted", "problem_identified", "advice_delivered", "qualified", "follow_up"].includes(a.status);
  return {
    pickup: a.status === "new" && !a.owner_id, release: works && !!a.owner_id && ["assigned", "contacted", "problem_identified", "advice_delivered", "follow_up"].includes(a.status), assign: MANAGE && open,
    contact: works && !!a.owner_id && open, note: open, problem: works && reached && a.status !== "qualified", advice: works && ["problem_identified", "advice_delivered", "follow_up"].includes(a.status),
    outcome: works && reached, quotation: works && a.status === "qualified" && !a.quotation_id, whatsapp: works && !!a.owner_id,
  };
};
const deny = (msg) => ({ status: 403, data: { error: { code: "forbidden", message: msg } } });
const analytics = () => {
  const by = (k) => { const o = {}; for (const r of st.rows) o[r[k]] = (o[r[k]] ?? 0) + 1; return o; };
  const ch = {}; for (const r of st.rows) for (const c of r.challenges) ch[c] = (ch[c] ?? 0) + 1;
  return { total: st.rows.length, sources: by("source"), challenges: ch, responded: st.rows.filter((r) => r.first_response_at).length, response_median_hours: 1, response_avg_hours: 1, assessments: st.rows.filter((r) => r.advice_at).length,
    qualified: st.rows.filter((r) => r.status === "qualified").length, quotations: st.rows.filter((r) => r.quotation_id).length, accepted: st.rows.filter((r) => r.accepted).length, verified: st.rows.filter((r) => r.verified).length, verified_cents: 0 };
};

/** null = not a growth route; else { status, data } */
export function growthRoute(method, p, body) {
  if (p === "/public/business-growth" && method === "POST") {
    st.posts.push(body);
    const need = ["full_name", "phone", "business_name", "industry", "city", "state", "source", "urgent_problem", "goal_90d", "contact_method", "contact_time"];
    const fields = Object.fromEntries(need.filter((k) => !body?.[k]).map((k) => [k, "required"]));
    if (!body?.challenges?.length || body.challenges.length > 3) fields.challenges = "required";
    if (!body?.platforms?.length) fields.platforms = "required";
    if (body?.consent_contact !== true) fields.consent_contact = "required";
    if (body?.consent_privacy !== true) fields.consent_privacy = "required";
    if (Object.keys(fields).length) return { status: 400, data: { error: { code: "invalid_input", message: "Some answers are missing or not valid.", fields } } };
    const wa = `${body.dial}${String(body.phone).replace(/\D/g, "").replace(/^0+/, "")}`;
    const dup = st.rows.find((a) => a.client_key === body.client_key) ?? st.rows.find((a) => a.whatsapp === wa && a.status !== "not_interested");
    if (dup) { if (dup.client_key !== body.client_key) { dup.resubmissions++; ev(dup.id, "resubmitted", "Submitted again from /apply/business"); } return { status: 200, data: { ok: true, ref: dup.ref, existing: true } }; }
    const id = st.next++;
    const myt = new Date(Date.now() + 8 * 3600_000).toISOString(); /* v1.371.0 - A2Z-DDMM + the day's running number */
    const a = base(id, { ref: `A2Z-${myt.slice(8, 10)}${myt.slice(5, 7)}${String(id).padStart(2, "0")}`, client_key: body.client_key, full_name: body.full_name, whatsapp: wa, email: body.email || null, business_name: body.business_name, industry: body.industry, city: body.city, state: body.state,
      source: body.source, utm_campaign: body.utm?.campaign ?? null, utm_source: body.utm?.source ?? null, challenges: body.challenges, urgent_problem: body.urgent_problem, goal_90d: body.goal_90d,
      platforms: body.platforms, interests: body.interests ?? [], contact_method: body.contact_method, contact_time: body.contact_time, consent_marketing: body.consent_marketing ? 1 : 0, created_at: ago(0) });
    st.rows.unshift(a);
    ev(id, "submitted", "Submitted from /apply/business", null, "new");
    return { status: 201, data: { ok: true, ref: a.ref } };
  }
  if (process.env.GROWTH && p === "/staff/notifications" && method === "GET" && VIEW) {
    return { status: 200, data: { notifications: [{ id: 901, kind: "enquiry", message: "New Business Growth Check A2Z-181106: Hafiz Ismail, Kopi Hafiz - pick it up in Sales › Customers & Follow-ups", is_read: 0, created_at: ago(0.4), ref: "growth:6:new" }] } };
  }
  if (!p.startsWith("/staff/business-growth")) return null;
  if (NEVER) return deny("Business Growth enquiries are for A2Z staff only");
  if (!VIEW) return deny("Business Growth enquiries are for the people who answer website enquiries");
  if (p === "/staff/business-growth" && method === "GET") {
    const counts = {}; for (const r of st.rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { status: 200, data: { enquiries: st.rows, counts, analytics: analytics(), me: ME, can_manage: MANAGE, settings: { unclaimed_hours: 4, remind_hours: 24, escalate_hours: 48 } } };
  }
  if (p === "/staff/business-growth/settings") return { status: 200, data: { settings: { unclaimed_hours: 4, remind_hours: 24, escalate_hours: 48 }, can_edit: MANAGE } };
  const m = /^\/staff\/business-growth\/(\d+)(?:\/([a-z]+))?$/.exec(p);
  const a = m ? st.rows.find((x) => x.id === Number(m[1])) : null;
  if (!a) return { status: 404, data: { error: { code: "not_found", message: "Enquiry not found" } } };
  if (!m[2] && method === "GET") {
    if (!st.events[a.id]) ev(a.id, "submitted", `Submitted from /apply/business · source ${a.source}\nConsent: contact yes · privacy notice 2026-07-24 yes · marketing no`, null, "new");
    return { status: 200, data: { enquiry: a, events: st.events[a.id], quotation: null, candidates: a.status === "qualified" ? [{ id: 520, doc_number: "QT-A2Z181126-4", total_cents: 250000, created_at: ago(1) }] : [],
      people: MANAGE ? [{ id: ME, name: "Fixture Person" }, { id: 9002, name: "Hafiz Rahman" }] : [], staff_name: "Fixture Person", can: can(a) } };
  }
  st.posts.push({ path: p, body });
  const c = can(a);
  if (Number(body?.version) !== a.version && m[2] !== "pickup") return { status: 409, data: { error: { code: "stale", message: "Somebody else changed this enquiry first - it has been reloaded." } } };
  const bump = (to, set = {}) => { const from = a.status; Object.assign(a, set, { status: to, version: a.version + 1 }); return from; };
  switch (m[2]) {
    case "pickup": if (!c.pickup) return { status: 409, data: { error: { code: "already_claimed", message: "Somebody else already picked this enquiry up." } } }; bump("assigned", { owner_id: ME, owner_name: "Fixture Person", picked_at: ago(0) }); ev(a.id, "picked_up", "Picked up", "new", "assigned"); break;
    case "contact": { if (!c.contact) return deny("Pick the enquiry up first"); const to = body.reached && a.status === "assigned" ? "contacted" : a.status; const from = bump(to, { first_response_at: a.first_response_at ?? ago(0), contact_attempts: a.contact_attempts + 1, next_follow_up_on: body.next_follow_up_on || a.next_follow_up_on }); ev(a.id, body.reached ? "contacted" : "attempt", `${body.reached ? "Reached" : "Not reached"} - ${body.note}`, from, to, body.channel); break; }
    case "note": ev(a.id, "note", body.note); if (body.next_follow_up_on) a.next_follow_up_on = body.next_follow_up_on; a.version++; break;
    case "problem": { if (!c.problem) return deny("Contact the entrepreneur first"); const from = bump(a.status === "contacted" ? "problem_identified" : a.status, { problem_summary: body.summary }); ev(a.id, "problem", body.summary, from, a.status); break; }
    case "advice": { if (!c.advice) return deny("Record the problem first"); const from = bump(a.status === "follow_up" ? "follow_up" : "advice_delivered", { advice_summary: body.summary, advice_at: a.advice_at ?? ago(0), advice_by_name: "Fixture Person" }); ev(a.id, "advice", body.summary, from, a.status); break; }
    case "outcome": { if (!c.outcome) return deny("Not yours"); if (String(body.reason ?? "").trim().length < 5) return { status: 400, data: { error: { code: "reason_required", message: "Give the reason (at least 5 characters)." } } }; const from = bump(body.outcome, { outcome_reason: body.reason, next_follow_up_on: body.outcome === "follow_up" ? body.next_follow_up_on : null }); ev(a.id, body.outcome, body.reason, from, body.outcome); break; }
    case "quotation": if (!c.quotation) return deny("Only a qualified enquiry"); a.quotation_id = body.quotation_id; a.version++; ev(a.id, "quotation", "Quotation QT-A2Z181126-4 linked"); break;
    case "assign": if (!c.assign) return deny("Management gives an enquiry to someone"); bump(a.status === "new" ? "assigned" : a.status, { owner_id: body.owner_id, owner_name: body.owner_id === ME ? "Fixture Person" : "Hafiz Rahman" }); ev(a.id, "assigned", body.reason); break;
    case "release": if (!c.release) return deny("Only the owner or management"); bump("new", { owner_id: null, owner_name: null }); ev(a.id, "released", body.reason); break;
    default: return { status: 404, data: { error: { code: "not_found", message: "Unknown route" } } };
  }
  return { status: 200, data: { ok: true } };
}
