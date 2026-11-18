/* v1.376.0 - Users -> Staff Accounts -> Move staff to @a2zcreative.my in the
   browser fixture (serve.mjs, EMAILMOVE=1). Invented people only. The worker's
   rules (old domain only, Gmail never, owner / super admin, 72-hour link,
   retry adds nothing) are proven by tests/staff-email-move.mjs; this mirrors
   the list, the preview and the send so the screens can be driven. */
const ON = !!process.env.EMAILMOVE;
const NEW = "a2zcreative.my";
const people = () => [
  { id: 9002, name: "Aina Sofea binti Kamal", email: "aina@azoneofficial.com", role: "sales_marketing", department: "Sales" },
  { id: 9003, name: "Danial Hakim bin Roslan", email: "danial@azoneofficial.com", role: "live_host", department: "Live" },
  { id: 9004, name: "Tan Mei Ling", email: "meiling@azoneofficial.com", role: "hr_admin", department: "HR" },
  { id: 9005, name: "Haziq Imran bin Salleh", email: "haziq.imran@azoneofficial.com", role: "editor", department: "Creative", google_only: true },
  { id: 9006, name: "Nur Iman binti Azlan", email: "nur.iman@azoneofficial.com", role: "marketing", department: "Marketing", state: "sent", pending_to: "iman@a2zcreative.my", expires_at: "2026-11-21 02:00:00" },
  { id: 9007, name: "Kavitha a/p Raman", email: "kavitha@azoneofficial.com", role: "sales_marketing", department: "Sales", state: "expired" },
  { id: 9010, name: "Lee Wei Han", email: "weihan@a2zcreative.my", role: "marketing", department: "Marketing", state: "moved", moved_at: "2026-11-18 03:10:00" },
  { id: 9001, name: "Fixture Person", email: "fixture@azoneofficial.com", role: "ceo", department: "Management", can: false },
].map((u) => ({ department: null, active: true, google: false, google_only: false, state: "not_started", pending_to: null, expires_at: null, moved_at: null, can: true, ...u, proposed: u.email.endsWith(`@${NEW}`) ? u.email : `${u.email.split("@")[0]}@${NEW}` }));
let rows = people();
export const resetEmailMove = () => { rows = people(); };
export function emailMoveRoute(method, p, body) {
  if (!ON || p !== "/staff/accounts/email-move") return null;
  if (method === "GET") return { status: 200, data: { rows, old_domain: "azoneofficial.com", new_domain: NEW, mail_ready: true, ttl_hours: 72, me: 9001 } };
  const items = Array.isArray(body?.items) ? body.items : [];
  const seen = new Set();
  const out = items.map((it) => {
    const r = rows.find((x) => x.id === it.user_id);
    const to = String(it.new_email ?? "").trim().toLowerCase();
    const base = { user_id: it.user_id, name: r?.name ?? null, from: r?.email ?? null, to, google_only: !!r?.google_only, reason: null };
    if (!r || !r.email.endsWith("@azoneofficial.com")) return { ...base, state: "refused", reason: "Only @azoneofficial.com addresses are moved." };
    if (!r.can) return { ...base, state: "refused", reason: "CEO and super admin accounts are moved by the super admin." };
    if (!to.endsWith(`@${NEW}`)) return { ...base, state: "refused", reason: `The new address must be a valid @${NEW} address.` };
    if (seen.has(to)) return { ...base, state: "refused", reason: "The same new address is given to two people." };
    seen.add(to);
    if (r.state === "sent" && r.pending_to === to && !it.resend) return { ...base, state: "already_sent", reason: `A link to ${to} is already waiting - Resend sends a fresh one.` };
    return { ...base, state: "send" };
  });
  const counts = { send: out.filter((r) => r.state === "send").length, already_sent: out.filter((r) => r.state === "already_sent").length, refused: out.filter((r) => r.state === "refused").length };
  if (body?.dry_run) return { status: 200, data: { ok: true, dry_run: true, rows: out, counts, ttl_hours: 72 } };
  if (String(body?.reason ?? "").trim().length < 10) return { status: 400, data: { error: { code: "reason_required", message: "Give the reason (at least 10 characters)." } } };
  if (!/^\d{6}$/.test(String(body?.totp ?? ""))) return { status: 401, data: { error: { code: "totp_required", message: "Enter your 6-digit authenticator code to move staff login emails" } } };
  for (const o of out) if (o.state === "send") { const r = rows.find((x) => x.id === o.user_id); Object.assign(r, { state: "sent", pending_to: o.to, expires_at: "2026-11-21 10:30:00" }); o.result = "sent"; }
  return { status: 200, data: { ok: true, rows: out, counts, sent: out.filter((o) => o.result === "sent").length } };
}
