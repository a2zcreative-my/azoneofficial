/* v1.288.0 - FINANCIAL ADVISORY: BANKER MATCHING, ALLOCATION, ENQUIRY AND
   DISCLOSURE (banker blueprint v1.1 stage 2, unlocked by the CEO's decision
   D5 of DSR blueprint v1.2, 12-11-2026: "proceed without lawyers").

   Every step needs the one before it, and nothing happens by itself:
     1 match      only after Management decided PROCEED on a submitted
                  assessment; the shortlist comes from that assessment's
                  VERIFIED, current (not stale) bank criteria, then the
                  registry: an active banker of that bank, contact identity
                  AND referral permission verified and in date, who handles
                  the product, covers the client's state (branch, districts,
                  states or national), is not unavailable and is under any
                  case limit. Tiers and reasons - never a score, never
                  distance, never an approval chance. Stored (fa_matches).
     2 allocate   Sales proposes one banker from that shortlist; the CEO or
                  COO (fa_allocate) approves - never their own proposal, the
                  verified owner apart. One active primary per case and
                  product (unique index).
     3 enquiry    recorded only for an approved allocation and only while the
                  client's DISCLOSURE consent naming that bank is live; the
                  case moves to enquiry and the banker status to enquiry sent.
     4 disclose   a document goes to that banker only if the consent covers
                  its kind; each document once per enquiry; the recipient is
                  the banker's verified work contact from the registry. The
                  staff member sends it on that work channel; this records
                  what was sent, to whom, under which consent - append only.
   No banker gets a login. Agents see none of this. The agreement, the fee
   and commission stay switched off (FA_LEGAL). */
import type { Env } from "./index";
import type { StaffUser } from "./staff";
import { json, err, audit, str } from "./shared";
import { can } from "./permissions";
import { isExecutiveOwner } from "./decision-policy";
import { MY_STATE_NAMES } from "./my-state";
import { todayMyt, bankerStatus, availabilityNow, bankKey, contactChangedAt } from "./fa-registry";

import type { Case as CaseRow } from "./fa";
interface Ctx {
  caseOf: (env: Env, id: number) => Promise<CaseRow | null>;
  mayOpen: (env: Env, u: StaffUser, c: CaseRow) => Promise<boolean>;
  mayEdit: (u: StaffUser, c: CaseRow) => boolean;
  event: (env: Env, caseId: number, ev: string, actor: number | null, detail?: Record<string, unknown> | null, key?: string | null) => Promise<void>;
  touch: (env: Env, id: number) => Promise<void>;
  reviewState: (env: Env, caseId: number) => Promise<{ decision: string | null; assessment_id: number | null }>;
  [k: string]: unknown;
}
const ACTIVE = ["draft", "pending_review", "assigned", "awaiting_consent", "ready"];
const CHANNELS = ["work_email", "work_phone", "whatsapp_work", "in_person"];

interface Shortlisted { banker_id: number; banker: string; bank_id: number; bank: string; branch_id: number | null; branch: string | null; tier: "ready" | "check"; reasons: string[] }
interface Excluded { banker_id: number; banker: string; bank: string; why: string }

/** the client's disclosure consents that are live today, with the bank they name and the documents they cover */
async function disclosureConsents(env: Env, caseId: number): Promise<Array<{ id: number; key: string; docs: string[] }>> {
  const today = todayMyt();
  const { results } = await env.DB.prepare(
    `SELECT id, institution, documents FROM fa_consents WHERE case_id = ?1 AND kind = 'disclosure' AND withdrawn_at IS NULL AND (expires_at IS NULL OR expires_at >= ?2) ORDER BY id DESC`,
  ).bind(caseId, today).all<{ id: number; institution: string | null; documents: string | null }>();
  return (results ?? []).map((r) => {
    let docs: string[] = [];
    try { const v = JSON.parse(r.documents ?? "[]"); docs = Array.isArray(v) ? v.map(String) : []; } catch { docs = []; }
    return { id: r.id, key: bankKey(r.institution ?? ""), docs };
  });
}

export async function handleFaMatch(env: Env, path: string, method: string, b: Record<string, unknown>, user: StaffUser, ctx: Ctx): Promise<Response | null> {
  const today = todayMyt();

  /* ---- one allocation: approve or cancel ---- */
  const mA = path.match(/^\/fa\/allocations\/(\d+)$/);
  if (mA) {
    if (method !== "POST") return null;
    const a = await env.DB.prepare(`SELECT * FROM fa_allocations WHERE id = ?1`).bind(Number(mA[1])).first<{ id: number; case_id: number; bank_id: number; banker_id: number; state: string; created_by: number; product: string }>();
    if (!a) return err("not_found", "Allocation not found", 404);
    const c = await ctx.caseOf(env, a.case_id);
    if (!c || !(await ctx.mayOpen(env, user, c))) return err("forbidden", "Not a case you can open", 403);
    const action = String(b.action ?? "");
    if (action === "approve") {
      if (!can(user.role, "fa_allocate")) return err("forbidden", "Only the CEO or COO approves an allocation", 403);
      if (a.created_by === user.id && !isExecutiveOwner(user)) {
        await audit(env, user.id, "auth.self_approval_refused", "fa_allocations", String(a.id), { action: "fa.allocation_approve" });
        return err("self_approval", "You proposed this banker - another manager approves it.", 403);
      }
      if (a.state !== "pending_review") return err("invalid_state", "Only a proposed allocation is approved.", 409);
      const bank = await env.DB.prepare(`SELECT name FROM fa_banks WHERE id = ?1`).bind(a.bank_id).first<{ name: string }>();
      const consented = (await disclosureConsents(env, c.id)).some((k) => k.key === bankKey(bank?.name ?? ""));
      const to = consented ? "ready" : "awaiting_consent";
      await env.DB.prepare(`UPDATE fa_allocations SET state = ?1, decided_by = ?2, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?3 AND state = 'pending_review'`).bind(to, user.id, a.id).run();
      await ctx.event(env, c.id, "allocation_approved", user.id, { allocation: a.id, state: to });
      await audit(env, user.id, "fa.allocation_approve", "fa_allocations", String(a.id), { case: c.case_ref, banker_id: a.banker_id, state: to });
      return json({ ok: true, state: to });
    }
    if (action === "cancel") {
      if (!(can(user.role, "fa_allocate") || a.created_by === user.id)) return err("forbidden", "The proposer or management cancels an allocation", 403);
      const reason = str(b.reason, 300) ? String(b.reason).trim() : "";
      if (reason.length < 5) return err("invalid_input", "Say why (at least 5 characters).", 400);
      if (!ACTIVE.includes(a.state)) return err("invalid_state", "This allocation is not active.", 409);
      await env.DB.prepare(`UPDATE fa_allocations SET state = 'cancelled', reason = COALESCE(reason || ' / ', '') || ?1, updated_at = datetime('now') WHERE id = ?2`).bind(`Cancelled: ${reason}`, a.id).run();
      await ctx.event(env, c.id, "allocation_cancelled", user.id, { allocation: a.id });
      await audit(env, user.id, "fa.allocation_cancel", "fa_allocations", String(a.id), { case: c.case_ref, reason });
      return json({ ok: true });
    }
    return err("invalid_input", "action is approve or cancel", 400);
  }

  const m = path.match(/^\/fa\/cases\/(\d+)\/(match|allocations|enquiries|disclosures)$/);
  if (!m || method !== "POST") return null;
  const c = await ctx.caseOf(env, Number(m[1]));
  if (!c) return err("not_found", "Case not found", 404);
  if (!(await ctx.mayOpen(env, user, c))) return err("forbidden", "Not a case you can open", 403);
  if (!ctx.mayEdit(user, c)) return err("forbidden", "Not a case you can change", 403);
  if (c.stage === "closed") return err("invalid_state", "This case is closed.", 409);
  const sub = m[2];
  const st = await ctx.reviewState(env, c.id);
  if (st.decision !== "proceed") return err("review_required", "Banker matching opens only after Management decides Proceed on a submitted assessment.", 409);

  /* ---- 1 match ---- */
  if (sub === "match") {
    const state = String(b.state ?? "").trim().toUpperCase();
    if (!(MY_STATE_NAMES as readonly string[]).includes(state)) return err("invalid_input", "Choose the client's state.", 400);
    const district = str(b.district, 60) ? String(b.district).trim().toLowerCase() : null;
    const ar = await env.DB.prepare(`SELECT id, result FROM fa_assessments WHERE id = ?1 AND case_id = ?2`).bind(st.assessment_id, c.id).first<{ id: number; result: string }>();
    if (!ar) return err("invalid_state", "The approved assessment is missing.", 409);
    let result: { matches?: Array<{ criterion_id: number; fit: string; stale: boolean; bank: string }> } = {};
    try { result = JSON.parse(ar.result); } catch { result = {}; }
    const usable = (result.matches ?? []).filter((x) => (x.fit === "fits" || x.fit === "near") && !x.stale);
    const crit = usable.length ? ((await env.DB.prepare(
      `SELECT c.id, c.state, t.bank_id FROM fa_criteria c LEFT JOIN fa_criteria_terms t ON t.criterion_id = c.id WHERE c.id IN (${usable.map(() => "?").join(",")})`,
    ).bind(...usable.map((x) => x.criterion_id)).all<{ id: number; state: string; bank_id: number | null }>()).results ?? []) : [];
    const banks = new Map<number, string>(); // bank id -> the fit it came with
    for (const u of usable) { const k = crit.find((x) => x.id === u.criterion_id); if (k?.bank_id != null && k.state === "verified") banks.set(k.bank_id, banks.get(k.bank_id) === "fits" ? "fits" : u.fit); }
    const shortlist: Shortlisted[] = [], excluded: Excluded[] = [];
    if (banks.size) {
      const ids = [...banks.keys()];
      const bankers = (await env.DB.prepare(
        `SELECT bk.*, k.name AS bank FROM fa_bankers bk JOIN fa_banks k ON k.id = bk.bank_id WHERE bk.bank_id IN (${ids.map(() => "?").join(",")}) AND k.status != 'retired' ORDER BY bk.full_name`,
      ).bind(...ids).all<Record<string, unknown> & { id: number; bank_id: number; full_name: string; bank: string; status: string; availability: string; availability_on: string | null; unavailable_until: string | null; case_limit: number | null }>()).results ?? [];
      for (const bk of bankers) {
        const facts = ((await env.DB.prepare(`SELECT fact, next_review_on, created_at FROM fa_banker_verifications WHERE banker_id = ?1 ORDER BY id DESC`).bind(bk.id).all<{ fact: string; next_review_on: string; created_at: string }>()).results ?? []);
        const identity = facts.find((f) => f.fact === "identity") ?? null, referral = facts.find((f) => f.fact === "referral") ?? null;
        /* v1.290.0 - a contact changed after its identity was confirmed: verify it again before matching */
        const status = bankerStatus(bk, identity as never, referral as never, today, await contactChangedAt(env, bk.id));
        const out = (why: string) => excluded.push({ banker_id: bk.id, banker: bk.full_name, bank: bk.bank, why });
        if (status !== "verified") { out(status === "pending_verification" ? "Contact identity not verified" : status === "requires_reverification" ? "Verification is due again" : "No longer active"); continue; }
        if (!referral || referral.next_review_on < today) { out("Referral permission not confirmed"); continue; }
        const handles = await env.DB.prepare(`SELECT 1 AS x FROM fa_banker_products WHERE banker_id = ?1 AND product = ?2`).bind(bk.id, c.product).first();
        if (!handles) { out("Does not handle this product"); continue; }
        const av = availabilityNow(bk, today);
        if (av === "unavailable") { out("Unavailable"); continue; }
        const open = Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM fa_allocations WHERE banker_id = ?1 AND state IN ('draft', 'pending_review', 'assigned', 'awaiting_consent', 'ready')`).bind(bk.id).first<{ n: number }>())?.n ?? 0);
        if (bk.case_limit != null && open >= bk.case_limit) { out("At the case limit"); continue; }
        const assigns = ((await env.DB.prepare(
          `SELECT a.branch_id, a.coverage, a.coverage_areas, br.name AS branch, l.state, l.district FROM fa_banker_branches a LEFT JOIN fa_branches br ON br.id = a.branch_id LEFT JOIN fa_localities l ON l.id = br.locality_id
            WHERE a.banker_id = ?1 AND a.ended_on IS NULL AND (br.id IS NULL OR br.status != 'closed') ORDER BY a.is_primary DESC`,
        ).bind(bk.id).all<{ branch_id: number | null; coverage: string; coverage_areas: string | null; branch: string | null; state: string | null; district: string | null }>()).results ?? []);
        const areas = (s: string | null) => { try { const v = JSON.parse(s ?? "[]"); return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []; } catch { return []; } };
        let hit: { branch_id: number | null; branch: string | null; exact: boolean } | null = null;
        for (const a of assigns) {
          if (a.coverage === "national") { hit = hit ?? { branch_id: a.branch_id, branch: a.branch, exact: false }; continue; }
          if (a.coverage === "states" && areas(a.coverage_areas).includes(state.toLowerCase())) { hit = hit ?? { branch_id: a.branch_id, branch: a.branch, exact: false }; continue; }
          if (a.coverage === "districts" && (a.state ?? "").toUpperCase() === state && (!district || areas(a.coverage_areas).includes(district))) { hit = { branch_id: a.branch_id, branch: a.branch, exact: !!district }; break; }
          if (a.coverage === "branch" && (a.state ?? "").toUpperCase() === state) { hit = { branch_id: a.branch_id, branch: a.branch, exact: !!district && (a.district ?? "").toLowerCase() === district }; if (hit.exact) break; }
        }
        if (!hit) { out(`Does not cover ${state}`); continue; }
        const reasons = [`${bk.bank}'s verified criterion: ${banks.get(bk.bank_id) === "fits" ? "within the guideline" : "near the guideline"}`,
          "Contact identity and referral permission verified", hit.branch ? `Covers ${state} from ${hit.branch}` : `Covers ${state}`];
        if (av !== "available") reasons.push(av === "limited" ? "Limited capacity" : "Availability not confirmed in 30 days");
        const ready = banks.get(bk.bank_id) === "fits" && av === "available";
        shortlist.push({ banker_id: bk.id, banker: bk.full_name, bank_id: bk.bank_id, bank: bk.bank, branch_id: hit.branch_id, branch: hit.branch, tier: ready ? "ready" : "check", reasons });
      }
    }
    shortlist.sort((a, z) => (a.tier === z.tier ? a.banker.localeCompare(z.banker) : a.tier === "ready" ? -1 : 1));
    const status = shortlist.length ? "shortlist" : banks.size ? "no_banker" : "no_criterion";
    const row = await env.DB.prepare(`INSERT INTO fa_matches (case_id, assessment_id, status, result, run_by) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`)
      .bind(c.id, st.assessment_id, status, JSON.stringify({ state, district, shortlist, excluded }), user.id).first<{ id: number }>();
    await ctx.event(env, c.id, "banker_match_run", user.id, { match: row?.id, shortlisted: shortlist.length });
    await audit(env, user.id, "fa.match", "fa_matches", String(row?.id), { case: c.case_ref, shortlisted: shortlist.length, status });
    return json({ ok: true, match_id: row?.id, status, shortlist, excluded }, 201);
  }

  /* ---- 2 propose an allocation from a shortlist ---- */
  if (sub === "allocations") {
    const mt = await env.DB.prepare(`SELECT id, result FROM fa_matches WHERE id = ?1 AND case_id = ?2`).bind(Number(b.match_id), c.id).first<{ id: number; result: string }>();
    if (!mt) return err("invalid_input", "Choose a banker from this case's shortlist.", 400);
    let list: Shortlisted[] = [];
    try { list = (JSON.parse(mt.result) as { shortlist: Shortlisted[] }).shortlist ?? []; } catch { list = []; }
    const pick = list.find((x) => x.banker_id === Number(b.banker_id));
    if (!pick) return err("invalid_input", "That banker is not on this shortlist.", 400);
    const reason = str(b.reason, 300) ? String(b.reason).trim() : null;
    if (pick.tier === "check" && (!reason || reason.length < 10)) return err("invalid_input", "This banker needs a check first - say why you propose them (at least 10 characters).", 400);
    let id: number;
    try {
      const row = await env.DB.prepare(`INSERT INTO fa_allocations (case_id, product, bank_id, banker_id, branch_id, match_id, role, state, reason, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'primary', 'pending_review', ?7, ?8) RETURNING id`)
        .bind(c.id, c.product, pick.bank_id, pick.banker_id, pick.branch_id, mt.id, reason, user.id).first<{ id: number }>();
      id = Number(row?.id);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return err("already_allocated", "This case already has an active banker for this product - cancel it first.", 409);
      throw e;
    }
    await ctx.event(env, c.id, "allocation_proposed", user.id, { allocation: id, banker_id: pick.banker_id });
    await audit(env, user.id, "fa.allocation_propose", "fa_allocations", String(id), { case: c.case_ref, banker_id: pick.banker_id, tier: pick.tier });
    return json({ ok: true, id, state: "pending_review" }, 201);
  }

  /* ---- 3 record the enquiry to the allocated banker ---- */
  if (sub === "enquiries") {
    const a = await env.DB.prepare(`SELECT a.*, k.name AS bank, bk.preferred_channel FROM fa_allocations a JOIN fa_banks k ON k.id = a.bank_id JOIN fa_bankers bk ON bk.id = a.banker_id WHERE a.id = ?1 AND a.case_id = ?2`)
      .bind(Number(b.allocation_id), c.id).first<{ id: number; banker_id: number; state: string; bank: string; preferred_channel: string }>();
    if (!a) return err("invalid_input", "Choose this case's allocation.", 400);
    if (!["assigned", "awaiting_consent", "ready"].includes(a.state)) return err("invalid_state", "Only an approved allocation is contacted.", 409);
    if (!(await disclosureConsents(env, c.id)).some((k) => k.key === bankKey(a.bank))) {
      return err("consent_required", `Record the client's disclosure consent naming ${a.bank} first.`, 409);
    }
    const channel = CHANNELS.includes(String(b.channel)) ? String(b.channel) : a.preferred_channel;
    const summary = str(b.summary, 600) ? String(b.summary).trim() : "";
    if (summary.length < 5) return err("invalid_input", "Write what was sent or asked (no figures beyond the consent).", 400);
    let id: number;
    try {
      const row = await env.DB.prepare(`INSERT INTO fa_enquiries (allocation_id, case_id, banker_id, state, sent_at, created_by) VALUES (?1, ?2, ?3, 'sent', datetime('now'), ?4) RETURNING id`)
        .bind(a.id, c.id, a.banker_id, user.id).first<{ id: number }>();
      id = Number(row?.id);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) return err("already_sent", "This allocation's enquiry is already recorded.", 409);
      throw e;
    }
    await env.DB.prepare(`UPDATE fa_allocations SET state = 'ready', updated_at = datetime('now') WHERE id = ?1`).bind(a.id).run();
    await env.DB.prepare(`UPDATE fa_cases SET stage = 'enquiry', banker_status = 'enquiry_sent', updated_at = datetime('now') WHERE id = ?1`).bind(c.id).run();
    await ctx.event(env, c.id, "enquiry_sent", user.id, { enquiry: id, channel });
    await audit(env, user.id, "fa.enquiry", "fa_enquiries", String(id), { case: c.case_ref, banker_id: a.banker_id, channel, summary });
    return json({ ok: true, id }, 201);
  }

  /* ---- 4 disclose documents under the consent ---- */
  const e = await env.DB.prepare(
    `SELECT e.id, e.banker_id, e.state, k.name AS bank, bk.work_email, bk.work_phone FROM fa_enquiries e JOIN fa_allocations a ON a.id = e.allocation_id JOIN fa_banks k ON k.id = a.bank_id JOIN fa_bankers bk ON bk.id = e.banker_id WHERE e.id = ?1 AND e.case_id = ?2`,
  ).bind(Number(b.enquiry_id), c.id).first<{ id: number; banker_id: number; state: string; bank: string; work_email: string | null; work_phone: string | null }>();
  if (!e) return err("invalid_input", "Choose this case's enquiry.", 400);
  if (e.state === "closed") return err("invalid_state", "This enquiry is closed.", 409);
  const docIds = Array.isArray(b.document_ids) ? [...new Set(b.document_ids.map(Number).filter(Number.isInteger))] : [];
  if (!docIds.length || docIds.length > 20) return err("invalid_input", "Choose the documents to send (at most 20).", 400);
  const channel = String(b.channel ?? "");
  if (!["work_email", "whatsapp_work", "in_person"].includes(channel)) return err("invalid_input", "channel is work_email, whatsapp_work or in_person", 400);
  const recipient = channel === "work_email" ? e.work_email : channel === "whatsapp_work" ? e.work_phone : "in person";
  if (!recipient) return err("invalid_input", "The banker has no verified contact on that channel in the registry.", 400);
  const purpose = str(b.purpose, 200) ? String(b.purpose).trim() : "";
  if (purpose.length < 5) return err("invalid_input", "Say what the documents are for.", 400);
  const consents = (await disclosureConsents(env, c.id)).filter((k) => k.key === bankKey(e.bank));
  if (!consents.length) return err("consent_required", `The client's disclosure consent naming ${e.bank} is missing, expired or withdrawn.`, 409);
  const docs = ((await env.DB.prepare(`SELECT id, kind FROM fa_documents WHERE case_id = ?1 AND removed_at IS NULL AND id IN (${docIds.map(() => "?").join(",")})`).bind(c.id, ...docIds).all<{ id: number; kind: string }>()).results ?? []);
  if (docs.length !== docIds.length) return err("invalid_input", "Every document must be on this case.", 400);
  const uncovered = docs.filter((d) => !consents.some((k) => k.docs.includes(d.kind)));
  if (uncovered.length) return err("consent_scope", `The consent does not cover: ${[...new Set(uncovered.map((d) => d.kind.replace(/_/g, " ")))].join(", ")}.`, 409);
  const sent = ((await env.DB.prepare(`SELECT document_id FROM fa_disclosures WHERE enquiry_id = ?1`).bind(e.id).all<{ document_id: number }>()).results ?? []).map((x) => x.document_id);
  const again = docs.filter((d) => sent.includes(d.id));
  if (again.length) return err("already_sent", "Some of these documents were already sent on this enquiry.", 409);
  const consentFor = (kind: string) => consents.find((k) => k.docs.includes(kind))!.id;
  await env.DB.batch(docs.map((d) => env.DB.prepare(`INSERT INTO fa_disclosures (enquiry_id, case_id, banker_id, document_id, consent_id, channel, recipient, purpose, sent_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
    .bind(e.id, c.id, e.banker_id, d.id, consentFor(d.kind), channel, recipient, purpose, user.id)));
  await ctx.event(env, c.id, "documents_disclosed", user.id, { enquiry: e.id, documents: docs.length, channel });
  await audit(env, user.id, "fa.disclose", "fa_disclosures", String(e.id), { case: c.case_ref, banker_id: e.banker_id, documents: docs.map((d) => d.kind), channel, recipient });
  await ctx.touch(env, c.id);
  return json({ ok: true, sent: docs.length, recipient }, 201);
}
