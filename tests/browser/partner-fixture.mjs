/* v1.351.0 - the Partner Interest Application in the browser fixture
   (serve.mjs). Invented people only. The worker's own rules (one record, no
   account, the claim lock, the authority split, agents refused) are proven by
   tests/partner-applications.mjs; this mirrors them so the screens can be
   driven end to end, per ROLE.
   v1.354.0 - staff only; New -> Assigned -> Screening -> Shortlisted ->
   Pre-Approved (COO / CCO) -> Approved (CEO) -> Activated (CEO), or Rejected. */
const ROLE = process.env.ROLE ?? "ceo";
const NEVER = ["agent", "customer"].includes(ROLE);
const VIEW = !NEVER && ["super_admin", "ceo", "coo", "cco", "sales_marketing"].includes(ROLE);
const MANAGE = !NEVER && ["super_admin", "ceo", "coo", "cco"].includes(ROLE);
const PRE = !NEVER && ["coo", "cco"].includes(ROLE);
const APPR = !NEVER && ROLE === "ceo";
const ME = 9001;
/* the server keeps UTC; these land as "Today", "Yesterday" and dated days in Malaysia */
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString().slice(0, 19).replace("T", " ");
const base = (id, over) => ({
  id, ref: `AGT-APP-${1000 + id}`, full_name: "Aina Rahman", gender: "female", age_range: "25-34", phone: "+60123456789", email: `applicant${id}@example.test`,
  location: "johor", contact_method: "whatsapp", best_time: "evening", source: "facebook", source_detail: null, utm_source: "facebook", utm_medium: "paid_social", utm_campaign: "partner_nov", utm_term: null, utm_content: null,
  referred_before: 1, intro_per_week: "3-5", customer_groups: ["sme", "corporate"], groups_other: null, lead_channels: ["personal", "business"], channels_other: null,
  approach: "I meet SME owners at my business association every week and introduce them with their permission.", time_available: "2-5", screening_window: "7d", marketing_opt_in: 0, lang: "en",
  status: "new", preapproved_at: null, preapproved_by: null, owner_id: null, owner_name: null, picked_at: null, first_response_at: null, next_follow_up_on: null, recommended_by: null, approved_by: null, approved_at: null,
  agreement_signed_on: null, agreement_note: null, agent_user_id: null, activated_by: null, activated_at: null, version: 1, created_at: ago(1), updated_at: null, ...over,
});
const init = () => ({
  apps: [
    base(8, { full_name: "Danial Hakim", gender: "male", age_range: "25-34", source: "facebook", location: "selangor", created_at: ago(0.5) }),
    base(7, { full_name: "Mira Yusof", age_range: "35-44", source: "instagram", utm_campaign: "ig_partner", status: "assigned", owner_id: ME, owner_name: "Fixture Person", picked_at: ago(0.6), created_at: ago(1.2), version: 2 }),
    base(6, { full_name: "Kelvin Ong", gender: "male", age_range: "35-44", source: "google", utm_campaign: null, location: "kuala_lumpur", status: "screening", owner_id: 9002, owner_name: "Hafiz Rahman", picked_at: ago(20), first_response_at: ago(19), created_at: ago(26), version: 3 }),
    base(5, { full_name: "Nadia Salleh", age_range: "25-34", source: "referral", source_detail: "Introduced by a client", utm_campaign: null, location: "pulau_pinang", status: "shortlisted", owner_id: ME, owner_name: "Fixture Person", picked_at: ago(30), first_response_at: ago(29), recommended_by: ME, created_at: ago(32), version: 5 }),
    base(4, { full_name: "Faizal Karim", gender: "male", age_range: "45-54", source: "tiktok", location: "perak", status: "shortlisted", preapproved_at: ago(10), preapproved_by: 9003, owner_id: 9002, owner_name: "Hafiz Rahman", picked_at: ago(60), first_response_at: ago(58), recommended_by: 9002, created_at: ago(170), version: 6 }),
    base(3, { full_name: "Suraya Idris", age_range: "35-44", source: "website", utm_campaign: null, location: "melaka", status: "approved", preapproved_at: ago(40), preapproved_by: 9003, owner_id: ME, owner_name: "Fixture Person", picked_at: ago(200), first_response_at: ago(199), recommended_by: ME, approved_by: 9004, approved_at: ago(30), created_at: ago(200), version: 7 }),
    base(2, { full_name: "Tan Mei Ling", age_range: "25-34", source: "linkedin", utm_campaign: "linkedin_smes", location: "kuala_lumpur", status: "rejected", owner_id: 9002, owner_name: "Hafiz Rahman", picked_at: ago(230), first_response_at: ago(229), created_at: ago(240), version: 6 }),
    base(1, { full_name: "Razak Osman", gender: "male", age_range: "55+", source: "threads", location: "johor", status: "activated", preapproved_at: ago(300), owner_id: ME, owner_name: "Fixture Person", picked_at: ago(330), first_response_at: ago(329), recommended_by: ME, approved_by: 9004, approved_at: ago(290), activated_by: 9004, activated_at: ago(280), agent_user_id: 9105, created_at: ago(340), version: 9 }),
  ],
  events: {},
  posts: [],
  next: 9,
});
let st = init();
export const resetPartners = () => { st = init(); };
export const partnerState = () => st;
const stageOf = (a) => (a.status === "shortlisted" && a.preapproved_at ? "pre_approved" : a.status);
const view = (a) => ({ ...a, stored_status: a.status, status: stageOf(a) });
const count = () => { const c = {}; for (const a of st.apps) c[stageOf(a)] = (c[stageOf(a)] ?? 0) + 1; return c; };
const ev = (id, kind, body, from = null, to = null, channel = null) => { (st.events[id] ??= []).push({ id: Date.now() + Math.random(), kind, body, channel, status_from: from, status_to: to, created_at: ago(0), actor: kind === "submitted" ? null : "Fixture Person" }); };
/* worker/src/partners.ts actionsFor, for this fixture's ROLE */
const can = (a) => {
  const any = VIEW || MANAGE || PRE || APPR;
  const mine = a.owner_id === ME;
  const works = (mine || MANAGE) && any;
  const screening = ["assigned", "screening", "on_hold"].includes(a.status);
  return {
    pickup: any && a.status === "new" && !a.owner_id, release: works && screening, contact: works && screening,
    note: any && (mine || MANAGE || PRE || APPR || a.status !== "new"),
    shortlist: works && screening && !!a.first_response_at, shortlist_needs_contact: works && screening && !a.first_response_at,
    preapprove: PRE && stageOf(a) === "shortlisted", approve: APPR && stageOf(a) === "pre_approved", activate: APPR && a.status === "approved",
  };
};
const deny = (msg) => ({ status: 403, data: { error: { code: "forbidden", message: msg } } });

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
    const myt = new Date(Date.now() + 8 * 3600_000).toISOString(); /* v1.371.0 - A2Z-DDMM + the day's running number */
    const a = base(id, { ref: `A2Z-${myt.slice(8, 10)}${myt.slice(5, 7)}${String(id).padStart(2, "0")}`, client_key: body.client_key, full_name: body.full_name, gender: body.gender, age_range: body.age_range, phone: `${body.dial}${String(body.phone).replace(/\D/g, "").replace(/^0+/, "")}`, email: body.email, location: body.location, source: body.source,
      utm_campaign: body.utm?.campaign ?? null, utm_source: body.utm?.source ?? null, referred_before: body.referred_before ? 1 : 0, intro_per_week: body.intro_per_week, customer_groups: body.customer_groups, lead_channels: body.lead_channels, approach: body.approach, time_available: body.time_available, screening_window: body.screening_window, created_at: ago(0) });
    st.apps.unshift(a);
    ev(id, "submitted", "Submitted from /apply/partner", null, "new");
    return { status: 201, data: { ok: true, ref: a.ref } };
  }
  /* the bell: what partners.ts tells each role (never an agent or a customer) */
  if (p === "/staff/notifications" && method === "GET" && !NEVER) {
    const n = [];
    if (VIEW) n.push({ id: 801, kind: "agent", message: "New partner application AGT-APP-1008: Danial Hakim (facebook) - pick it up in Agents › Requests", is_read: 0, created_at: ago(0.5), ref: "partner:8:new" });
    if (PRE) n.push({ id: 802, kind: "agent", message: "Partner application AGT-APP-1005 (Nadia Salleh) is shortlisted by Sales - your pre-approval is needed", is_read: 0, created_at: ago(0.4), ref: "partner:5:shortlisted:4" });
    if (APPR) n.push({ id: 803, kind: "agent", message: "Partner application AGT-APP-1004 (Faizal Karim) is pre-approved - your final decision is needed", is_read: 0, created_at: ago(0.3), ref: "partner:4:pre_approved:5" });
    return n.length ? { status: 200, data: { notifications: n } } : null;
  }
  if (!p.startsWith("/staff/partner-applications")) return null;
  /* EXTERNAL AGENTS ARE NOT STAFF - refused by role, as the worker does */
  if (NEVER) return deny("Partner applications are for A2Z staff only");
  if (!VIEW && !MANAGE && !PRE && !APPR) return deny("Partner applications are for the Sales and agent team and management");
  if (p === "/staff/partner-applications" && method === "GET") {
    return { status: 200, data: { applications: st.apps.map(({ approach, ...a }) => ({ ...view(a), overdue: a.status === "new" && a.id === 8 && false })), counts: count(), me: ME, can_manage: MANAGE, can_preapprove: PRE, can_approve: APPR, settings: { unclaimed_hours: 4, remind_hours: 24, escalate_hours: 48 } } };
  }
  if (p === "/staff/partner-applications/settings") return { status: 200, data: method === "GET" ? { settings: { unclaimed_hours: 4, remind_hours: 24, escalate_hours: 48 }, can_edit: MANAGE } : { ok: true, settings: { unclaimed_hours: Number(body?.unclaimed_hours), remind_hours: Number(body?.remind_hours), escalate_hours: Number(body?.escalate_hours) } } };
  const m = /^\/staff\/partner-applications\/(\d+)(?:\/([a-z]+))?$/.exec(p);
  const a = m ? st.apps.find((x) => x.id === Number(m[1])) : null;
  if (!a) return { status: 404, data: { error: { code: "not_found", message: "Application not found" } } };
  if (!m[2] && method === "GET") {
    if (!st.events[a.id]) ev(a.id, "submitted", "Submitted from /apply/partner", null, "new");
    const n = (v) => (v === ME ? "Fixture Person" : v === 9002 ? "Hafiz Rahman" : v === 9003 ? "Zul Ahmad (COO)" : v === 9004 ? "Alif Farhan (CEO)" : null);
    return { status: 200, data: { application: { ...view(a), recommended_by_name: n(a.recommended_by), preapproved_by_name: n(a.preapproved_by), approved_by_name: n(a.approved_by), activated_by_name: n(a.activated_by) },
      events: st.events[a.id], agent_accounts: [{ id: 9105, name: "Rashid Danial", email: "rashid.danial@example.test", is_active: 1, salesperson_name: "Hafiz Rahman" }], can: can(a) } };
  }
  st.posts.push({ path: p, body });
  const c = can(a);
  const reason = String(body?.reason ?? "").trim();
  if (Number(body?.version) !== a.version && m[2] !== "pickup") return { status: 409, data: { error: { code: "stale", message: "Somebody else changed this application first - it has been reloaded." } } };
  const bump = (to, set = {}) => { const from = stageOf(a); Object.assign(a, set, { status: to, version: a.version + 1 }); return from; };
  const needReason = () => (reason.length < 5 ? { status: 400, data: { error: { code: "reason_required", message: "Give the reason (at least 5 characters)." } } } : null);
  switch (m[2]) {
    case "pickup": if (!c.pickup) return a.owner_id ? { status: 409, data: { error: { code: "already_claimed", message: "Somebody else already picked this application up." } } } : deny("Not yours to pick up"); bump("assigned", { owner_id: ME, owner_name: "Fixture Person", picked_at: ago(0) }); ev(a.id, "picked_up", "Picked up for screening", "new", "assigned"); break;
    case "contact": { if (!c.contact) return deny("Pick the application up first"); const from = bump(["assigned", "on_hold"].includes(a.status) ? "screening" : a.status, { first_response_at: a.first_response_at ?? ago(0), next_follow_up_on: body.next_follow_up_on || null }); ev(a.id, "contacted", body.note, from, a.status, body.channel); break; }
    case "note": if (!c.note) return deny("Not yours to review"); ev(a.id, "note", body.note); a.version++; break;
    case "shortlist": { if (!c.shortlist) return deny("Contact the applicant and record it before submitting for review"); const r = needReason(); if (r) return r; const from = bump("shortlisted", { recommended_by: ME, preapproved_at: null }); ev(a.id, "recommended", reason, from, "shortlisted"); break; }
    case "preapprove": {
      if (!PRE) return deny("Only the COO or the CCO pre-approves a partner application");
      if (!c.preapprove) return { status: 409, data: { error: { code: "not_shortlisted", message: "Only a shortlisted application is pre-approved." } } };
      const r = needReason(); if (r) return r;
      if (body.decision === "preapprove") { bump("shortlisted", { preapproved_at: ago(0), preapproved_by: ME }); ev(a.id, "pre_approved", reason, "shortlisted", "pre_approved"); }
      else if (body.decision === "return") { bump("screening"); ev(a.id, "returned", reason, "shortlisted", "screening"); }
      else { bump("rejected"); ev(a.id, "rejected", reason, "shortlisted", "rejected"); }
      break;
    }
    case "approve": {
      if (!APPR) return deny("The final approval is the CEO's");
      if (!c.approve) return { status: 409, data: { error: { code: "not_pre_approved", message: "The CEO decides after the COO or CCO pre-approves." } } };
      const r = needReason(); if (r) return r;
      if (body.decision === "approve") { bump("approved", { approved_by: ME, approved_at: ago(0) }); ev(a.id, "approved", reason, "pre_approved", "approved"); }
      else if (body.decision === "return") { bump("screening", { preapproved_at: null }); ev(a.id, "returned", reason, "pre_approved", "screening"); }
      else { bump("rejected"); ev(a.id, "rejected", reason, "pre_approved", "rejected"); }
      break;
    }
    case "release": { if (!c.release) return deny("Only the owner or management hands an application back"); const from = bump("new", { owner_id: null, owner_name: null }); ev(a.id, "released", body.reason, from, "new"); break; }
    case "activate": if (!c.activate) return deny("Activation is the CEO's"); bump("activated", { agent_user_id: body.agent_user_id, agreement_signed_on: body.agreement_signed_on, agreement_note: body.agreement_note, activated_by: ME, activated_at: ago(0) }); ev(a.id, "activated", `Agreement signed ${body.agreement_signed_on} · ${body.agreement_note}`, "approved", "activated"); break;
    default: return { status: 404, data: { error: { code: "not_found", message: "Unknown route" } } };
  }
  return { status: 200, data: { ok: true } };
}
