/* v1.351.0 - the Partner Interest Application in the browser fixture
   (serve.mjs). Invented people only. The worker's own rules (one record, no
   account, the claim lock, the approval) are proven by
   tests/partner-applications.mjs; this keeps what the browser sends and reads
   it back so the screens can be driven end to end. */
const ROLE = process.env.ROLE ?? "ceo";
const VIEW = ["super_admin", "ceo", "coo", "cco", "sales_marketing"].includes(ROLE);
const APPROVE = ["super_admin", "ceo", "coo", "cco"].includes(ROLE);
const ME = 9001;
const base = (id, over) => ({
  id, ref: `PIA-261117-${["7K3Q", "M8XD", "R2PA", "Z9WC", "H4NB"][id - 1]}`, full_name: "Aina Rahman", gender: "female", age_range: "25-34", phone: "+60123456789", email: `applicant${id}@example.test`,
  location: "johor", contact_method: "whatsapp", best_time: "evening", source: "facebook", source_detail: null, utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "partner_nov", utm_term: null, utm_content: null,
  referred_before: 1, intro_per_week: "3-5", customer_groups: ["sme", "corporate"], groups_other: null, lead_channels: ["personal", "business"], channels_other: null,
  approach: "I meet SME owners at my business association every week and introduce them with their permission.", time_available: "2-5", screening_window: "7d", marketing_opt_in: 0, lang: "en",
  status: "new", owner_id: null, owner_name: null, picked_at: null, first_response_at: null, next_follow_up_on: null, recommended_by: null, approved_by: null, approved_at: null,
  agreement_signed_on: null, agreement_note: null, agent_user_id: null, activated_by: null, activated_at: null, version: 1, created_at: "2026-11-17 01:10:00", updated_at: null, ...over,
});
const init = () => ({
  apps: [
    base(1, { full_name: "Aina Rahman", created_at: "2026-11-17 01:10:00" }),
    base(2, { full_name: "Hafiz Ismail", gender: "male", age_range: "35-44", source: "referral", source_detail: "Introduced by a client", utm_campaign: null, utm_source: null, utm_medium: null, location: "selangor", status: "screening", owner_id: 9002, owner_name: "Nur Aisyah", picked_at: "2026-11-16 03:00:00", first_response_at: "2026-11-16 05:00:00", next_follow_up_on: "2026-11-19", created_at: "2026-11-16 02:30:00", version: 3 }),
    base(3, { full_name: "Mei Ling Tan", age_range: "45-54", source: "linkedin", utm_campaign: "linkedin_smes", utm_source: "linkedin", location: "kuala_lumpur", status: "shortlisted", owner_id: ME, owner_name: "Fixture Person", picked_at: "2026-11-15 02:00:00", first_response_at: "2026-11-15 03:00:00", recommended_by: ME, created_at: "2026-11-15 01:00:00", version: 5 }),
    base(4, { full_name: "Ravi Kumar", gender: "male", age_range: "25-34", source: "tiktok", utm_campaign: "partner_nov", location: "penang", status: "on_hold", owner_id: 9002, owner_name: "Nur Aisyah", picked_at: "2026-11-14 02:00:00", first_response_at: "2026-11-14 06:00:00", created_at: "2026-11-14 01:00:00", version: 4 }),
  ],
  events: {},
  posts: [],
  next: 5,
});
let st = init();
export const resetPartners = () => { st = init(); };
export const partnerState = () => st;
const count = () => { const c = {}; for (const a of st.apps) c[a.status] = (c[a.status] ?? 0) + 1; return c; };
const ev = (id, kind, body, from = null, to = null, channel = null) => { (st.events[id] ??= []).push({ id: Date.now() + Math.random(), kind, body, channel, status_from: from, status_to: to, created_at: "2026-11-17 09:00:00", actor: kind === "submitted" ? null : "Fixture Person" }); };
const can = (a) => {
  const works = a.owner_id === ME || APPROVE;
  const status = [];
  if (works && ["assigned", "screening", "on_hold"].includes(a.status)) status.push("shortlisted");
  if (works && ["assigned", "screening", "shortlisted"].includes(a.status)) status.push("on_hold");
  if (works && ["assigned", "screening", "shortlisted", "on_hold"].includes(a.status)) status.push("rejected");
  if ((works && a.status === "on_hold") || (APPROVE && ["rejected", "shortlisted"].includes(a.status))) status.push("screening");
  return { pickup: VIEW && a.status === "new" && !a.owner_id, release: works && ["assigned", "screening", "on_hold"].includes(a.status), contact: works && ["assigned", "screening", "shortlisted", "on_hold"].includes(a.status), note: VIEW, status, approve: APPROVE && a.status === "shortlisted", activate: APPROVE && a.status === "approved" };
};

/** null = not a partner route; else { status, data } */
export function partnerRoute(method, p, body) {
  if (p === "/public/partner-applications" && method === "POST") {
    st.posts.push(body);
    const need = ["full_name", "gender", "age_range", "phone", "email", "location", "source", "intro_per_week", "approach", "time_available", "screening_window"];
    const fields = Object.fromEntries(need.filter((k) => !body?.[k]).map((k) => [k, "required"]));
    if (!body?.privacy_ack || !body?.ack_independent || !body?.ack_terms) fields.privacy_ack = "required";
    if (Object.keys(fields).length) return { status: 400, data: { error: { code: "invalid_input", message: "Some answers are missing or not valid.", fields } } };
    const dup = st.apps.find((a) => a.client_key === body.client_key);
    if (dup) return { status: 200, data: { ok: true, ref: dup.ref, existing: true } };
    const id = st.next++;
    const a = base(Math.min(id, 5), { id, ref: `PIA-261117-N${String(id).padStart(3, "0")}`, client_key: body.client_key, full_name: body.full_name, gender: body.gender, age_range: body.age_range, phone: `${body.dial}${String(body.phone).replace(/\D/g, "").replace(/^0+/, "")}`, email: body.email, location: body.location, source: body.source,
      utm_campaign: body.utm?.campaign ?? null, utm_source: body.utm?.source ?? null, referred_before: body.referred_before ? 1 : 0, intro_per_week: body.intro_per_week, customer_groups: body.customer_groups, lead_channels: body.lead_channels, approach: body.approach, time_available: body.time_available, screening_window: body.screening_window, created_at: "2026-11-17 09:00:00" });
    st.apps.unshift(a);
    ev(id, "submitted", "Submitted from /apply/partner", null, "new");
    return { status: 201, data: { ok: true, ref: a.ref } };
  }
  if (!p.startsWith("/staff/partner-applications")) return null;
  if (!VIEW && !APPROVE) return { status: 403, data: { error: { code: "forbidden", message: "Partner applications are for the Sales and agent team and management" } } };
  if (p === "/staff/partner-applications" && method === "GET") {
    return { status: 200, data: { applications: st.apps.map(({ approach, ...a }) => ({ ...a, overdue: (a.status === "new" && a.id === 1) || (a.next_follow_up_on && a.next_follow_up_on < "2026-11-17") })), counts: count(), me: ME, can_manage: APPROVE, can_approve: APPROVE, settings: { unclaimed_hours: 4, remind_hours: 24, escalate_hours: 48 } } };
  }
  if (p === "/staff/partner-applications/summary") {
    const c = count();
    const bySrc = {}; for (const a of st.apps) bySrc[a.source] = (bySrc[a.source] ?? 0) + 1;
    const byCamp = {}; for (const a of st.apps) if (a.utm_campaign) byCamp[a.utm_campaign] = (byCamp[a.utm_campaign] ?? 0) + 1;
    const owners = {}; for (const a of st.apps) if (a.owner_id) { const o = owners[a.owner_id] ??= { id: a.owner_id, name: a.owner_name, total: 0, open: 0 }; o.total++; if (["assigned", "screening", "on_hold", "shortlisted"].includes(a.status)) o.open++; }
    return { status: 200, data: {
      applications: { total: st.apps.length, by_status: c, by_source: Object.entries(bySrc).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count), by_campaign: Object.entries(byCamp).map(([key, count]) => ({ key, count })),
        owners: Object.values(owners), unclaimed: c.new ?? 0, qualified: (c.shortlisted ?? 0) + (c.approved ?? 0) + (c.activated ?? 0), approved: (c.approved ?? 0) + (c.activated ?? 0), activated: c.activated ?? 0, avg_first_response_hours: 2.5, responded: 3 },
      agents: [{ id: 9105, name: "Rashid Danial", leads: 4, quotations: 2, paid_cents: 450000, paid_sales: 1, week_paid_cents: 150000 }],
      week: { from: "2026-11-17", to: "2026-11-23", company_target_cents: 800000, agent_paid_cents: 150000, verified_sales: 1 },
    } };
  }
  if (p === "/staff/partner-applications/settings") return { status: 200, data: method === "GET" ? { settings: { unclaimed_hours: 4, remind_hours: 24, escalate_hours: 48 }, can_edit: APPROVE } : { ok: true, settings: { unclaimed_hours: Number(body?.unclaimed_hours), remind_hours: Number(body?.remind_hours), escalate_hours: Number(body?.escalate_hours) } } };
  const m = /^\/staff\/partner-applications\/(\d+)(?:\/([a-z]+))?$/.exec(p);
  const a = m ? st.apps.find((x) => x.id === Number(m[1])) : null;
  if (!a) return { status: 404, data: { error: { code: "not_found", message: "Application not found" } } };
  if (!m[2] && method === "GET") {
    if (!st.events[a.id]) ev(a.id, "submitted", "Submitted from /apply/partner", null, "new");
    return { status: 200, data: { application: { ...a, recommended_by_name: a.recommended_by ? "Fixture Person" : null, approved_by_name: a.approved_by ? "Fixture Person" : null, activated_by_name: a.activated_by ? "Fixture Person" : null },
      events: st.events[a.id], agent_accounts: [{ id: 9105, name: "Rashid Danial", email: "rashid.danial@example.test", is_active: 1 }], can: can(a) } };
  }
  st.posts.push({ path: p, body });
  if (Number(body?.version) !== a.version && m[2] !== "pickup" && m[2] !== "note") return { status: 409, data: { error: { code: "stale", message: "Somebody else changed this application first - it has been reloaded." } } };
  const bump = (to, set = {}) => { const from = a.status; Object.assign(a, set, { status: to, version: a.version + 1 }); return from; };
  switch (m[2]) {
    case "pickup": if (a.owner_id) return { status: 409, data: { error: { code: "already_claimed", message: "Somebody else already picked this application up." } } }; bump("assigned", { owner_id: ME, owner_name: "Fixture Person", picked_at: "2026-11-17 09:00:00" }); ev(a.id, "picked_up", "Picked up for screening", "new", "assigned"); break;
    case "contact": { const from = bump(a.status === "assigned" ? "screening" : a.status, { first_response_at: a.first_response_at ?? "2026-11-17 09:05:00", next_follow_up_on: body.next_follow_up_on || null }); ev(a.id, "contacted", body.note, from, a.status, body.channel); break; }
    case "note": ev(a.id, "note", body.note); break;
    case "status": { if (String(body?.reason ?? "").trim().length < 5) return { status: 400, data: { error: { code: "reason_required", message: "Give the reason (at least 5 characters) - it is kept with the application." } } }; const from = bump(body.to, body.to === "shortlisted" ? { recommended_by: ME } : {}); ev(a.id, body.to === "shortlisted" ? "recommended" : "status", body.reason, from, body.to); break; }
    case "release": { const from = bump("new", { owner_id: null, owner_name: null }); ev(a.id, "released", body.reason, from, "new"); break; }
    case "approve": { const to = body.decision === "approve" ? "approved" : "rejected"; bump(to, to === "approved" ? { approved_by: ME, approved_at: "2026-11-17 09:10:00" } : {}); ev(a.id, to === "approved" ? "approved" : "status", body.reason, "shortlisted", to); break; }
    case "activate": bump("activated", { agent_user_id: body.agent_user_id, agreement_signed_on: body.agreement_signed_on, agreement_note: body.agreement_note, activated_by: ME, activated_at: "2026-11-17 09:20:00" }); ev(a.id, "activated", `Agreement signed ${body.agreement_signed_on} · ${body.agreement_note}`, "approved", "activated"); break;
    default: return { status: 404, data: { error: { code: "not_found", message: "Unknown route" } } };
  }
  return { status: 200, data: { ok: true } };
}
