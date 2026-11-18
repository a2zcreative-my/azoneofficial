"use client";

/* v1.376.0 - MOVE STAFF LOGIN EMAILS TO @a2zcreative.my (the CEO, 18-11-2026:
   "my staff they using old domain email for login the portal ... but some of
   the staff are using gmail which is I dont want to touch on it except the
   staff which is using old domain: azoneofficial.com").

   Users -> Staff Accounts. Only accounts that sign in with @azoneofficial.com
   are listed; Gmail and every other address never appear and the server
   refuses them. Each row proposes the same name @a2zcreative.my and the field
   is editable (the CEO: some addresses differ). Review asks the server first
   (dry run) and shows every person; Send links asks once for the reason and
   the authenticator code. Each person gets a single-use link in the NEW
   mailbox, valid 72 hours; the login changes only when they open it (the
   existing proof: same account, every session signed out). Until then the old
   address keeps working. The server decides everything again
   (worker/src/staff.ts /accounts/email-move). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { L, withStepUp } from "@/components/portal/page-shared";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { btnSm, btnSmAccent, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, td, th } from "@/lib/ui-styles";
import css from "./email-move.module.css";

type State = "not_started" | "sent" | "expired" | "cancelled" | "moved";
type Row = { id: number; name: string; email: string; role: string; department: string | null; active: boolean; proposed: string; state: State; pending_to: string | null; expires_at: string | null; moved_at: string | null; google_only: boolean; google: boolean; can: boolean };
type List = { rows: Row[]; old_domain: string; new_domain: string; mail_ready: boolean; ttl_hours: number };
type PRow = { user_id: number; name: string | null; from: string | null; to: string; state: "send" | "already_sent" | "refused"; reason: string | null; google_only: boolean; result?: "sent" | "mail_failed" };
type Preview = { rows: PRow[]; counts: { send: number; already_sent: number; refused: number }; sent?: number; dry_run?: boolean };

const STATE_CHIP: Record<State, [string, string, string]> = {
  not_started: [chipSmNeutral, "Not started", "Belum mula"],
  sent: [chipSmInfo, "Link sent", "Pautan dihantar"],
  expired: [chipSmWarn, "Link expired", "Pautan tamat"],
  cancelled: [chipSmWarn, "Not sent", "Tidak dihantar"],
  moved: [chipSmSuccess, "Moved", "Dipindahkan"],
};
/** the server stores UTC (datetime('now')); show Malaysia time */
const myt = (utc: string | null) => {
  if (!utc) return "";
  const d = new Date(utc.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return utc;
  return d.toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function EmailMoveCard() {
  const [list, setList] = useState<List | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [resend, setResend] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showMoved, setShowMoved] = useState(false);
  const { prompt, node: promptNode } = usePrompt();

  const load = useCallback(async () => {
    const r = await api<List & { error?: { message?: string } }>("/staff/accounts/email-move");
    if (!r.ok || !r.data) { setFailed(r.data?.error?.message ?? L("Could not load the list.", "Senarai tidak dapat dimuatkan.")); return; }
    setFailed(null); setList(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = list?.rows ?? [];
  const toMove = useMemo(() => rows.filter((r) => r.state !== "moved"), [rows]);
  const moved = useMemo(() => rows.filter((r) => r.state === "moved"), [rows]);
  const choosable = toMove.filter((r) => r.can);
  const addr = (r: Row) => (edits[r.id] ?? (r.pending_to ?? r.proposed)).trim().toLowerCase();
  const newDomain = list?.new_domain ?? "a2zcreative.my";
  const oldAt = list ? `@${list.old_domain}` : "@azoneofficial.com";
  const badAddr = (r: Row) => !addr(r).endsWith(`@${newDomain}`) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr(r));
  const allOn = choosable.length > 0 && choosable.every((r) => picked.has(r.id));
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(choosable.map((r) => r.id)));
  const items = () => toMove.filter((r) => picked.has(r.id)).map((r) => ({ user_id: r.id, new_email: addr(r), ...(resend.has(r.id) ? { resend: true } : {}) }));

  const review = async (only?: Row, again = false) => {
    setMsg(null); setDone(null);
    if (only) { setPicked(new Set([only.id])); if (again) setResend(new Set([only.id])); }
    const body = only ? [{ user_id: only.id, new_email: addr(only), ...(again ? { resend: true } : {}) }] : items();
    if (!body.length) return;
    setBusy(true);
    const r = await api<Preview & { error?: { message?: string } }>("/staff/accounts/email-move", { method: "POST", body: JSON.stringify({ items: body, dry_run: true }) });
    setBusy(false);
    if (!r.ok || !r.data) { setMsg(r.data?.error?.message ?? L("The check failed - nothing was sent.", "Semakan gagal - tiada apa dihantar.")); return; }
    setPreview(r.data); setOpen(true);
  };

  const confirm = async () => {
    if (!preview) return;
    const body = preview.rows.filter((p) => p.state === "send").map((p) => ({ user_id: p.user_id, new_email: p.to, ...(resend.has(p.user_id) ? { resend: true } : {}) }));
    setBusy(true); setMsg(null);
    const r = await withStepUp<Preview & { error?: { message?: string } }>(
      (totp) => api("/staff/accounts/email-move", { method: "POST", body: JSON.stringify({ items: body, reason: reason.trim(), ...(totp ? { totp } : {}) }) }),
      prompt,
      { title: L("Send the verification links", "Hantar pautan pengesahan"), label: L("Your 6-digit authenticator code", "Kod pengesah 6 digit anda") },
    );
    setBusy(false);
    if (!r.ok || !r.data) { setMsg(r.data?.error?.message ?? L("Nothing was sent.", "Tiada apa dihantar.")); return; }
    const failedMail = r.data.rows.filter((p) => p.result === "mail_failed").length;
    setDone(L(`${r.data.sent ?? 0} link${r.data.sent === 1 ? "" : "s"} sent - each person confirms from the new mailbox within ${list?.ttl_hours ?? 72} hours.`, `${r.data.sent ?? 0} pautan dihantar - setiap orang mengesahkan dari peti mel baharu dalam ${list?.ttl_hours ?? 72} jam.`)
      + (failedMail ? L(` ${failedMail} email${failedMail === 1 ? "" : "s"} could not be sent - nothing changed for them.`, ` ${failedMail} e-mel tidak dapat dihantar - tiada perubahan bagi mereka.`) : ""));
    setOpen(false); setPreview(null); setReason(""); setPicked(new Set()); setResend(new Set()); setEdits({});
    void load();
  };

  if (failed) return (
    <section className={`${card} ${css.card}`} data-testid="email-move">
      <p className={css.h3}>{L("Move staff to @a2zcreative.my", "Pindahkan kakitangan ke @a2zcreative.my")}</p>
      <p className={css.warn}>{failed}</p>
    </section>
  );

  const counts = { total: rows.length, moved: moved.length, sent: rows.filter((r) => r.state === "sent").length, waiting: rows.filter((r) => r.state !== "moved" && r.state !== "sent").length };

  return (
    <section className={`${card} ${css.card}`} data-testid="email-move">
      {promptNode}
      <div className={css.headRow}>
        <div>
          <p className={css.h3}>{L(`Move staff to @${newDomain}`, `Pindahkan kakitangan ke @${newDomain}`)}</p>
          <p className={css.hint}>{L(
            `Only staff who sign in with ${oldAt}. Gmail and other addresses are not touched. Each person confirms from the new mailbox (link valid ${list?.ttl_hours ?? 72} hours); until then the old address keeps working.`,
            `Hanya kakitangan yang log masuk dengan ${oldAt}. Gmail dan alamat lain tidak disentuh. Setiap orang mengesahkan dari peti mel baharu (pautan sah ${list?.ttl_hours ?? 72} jam); sehingga itu alamat lama masih berfungsi.`)}</p>
        </div>
        {list && (
          <p className={css.counts} data-testid="email-move-counts">
            <span><strong>{counts.waiting}</strong> {L("to move", "untuk dipindah")}</span>
            <span><strong>{counts.sent}</strong> {L("link sent", "pautan dihantar")}</span>
            <span><strong>{counts.moved}</strong> {L("moved", "dipindahkan")}</span>
          </p>
        )}
      </div>
      {list && !list.mail_ready && <p className={css.warn}><AppIcon name="warning" /> {L("Email sending is not set up - links cannot be sent yet.", "Penghantaran e-mel belum disediakan - pautan belum boleh dihantar.")}</p>}
      {done && <p className={css.done} data-testid="email-move-done"><AppIcon name="success" /> {done}</p>}
      {msg && !open && <p className={css.warn}>{msg}</p>}

      {!list ? <SkelRows rows={4} /> : toMove.length === 0 ? (
        <p className={css.empty}>{L(`Nobody signs in with ${oldAt} any more.`, `Tiada siapa lagi log masuk dengan ${oldAt}.`)}</p>
      ) : (
        <>
          <div className={css.bar}>
            <span className={css.selCount}><strong>{picked.size}</strong> {L("selected", "dipilih")}</span>
            {picked.size > 0 && <button type="button" className={btnSmQuiet} onClick={() => { setPicked(new Set()); setResend(new Set()); }}>{L("Clear", "Kosongkan")}</button>}
            <button type="button" className={`${btnSmAccent} ${css.go}`} data-testid="email-move-review" disabled={busy || picked.size === 0 || toMove.some((r) => picked.has(r.id) && badAddr(r))} onClick={() => void review()}>
              <AppIcon name="send" />{L("Review & send links", "Semak & hantar pautan")}
            </button>
          </div>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th className={`${th} ${css.cCheck}`}><label className={css.selAllWrap}><input type="checkbox" className={css.check} aria-label={L("Select all", "Pilih semua")} checked={allOn} disabled={!choosable.length} onChange={toggleAll} /><span className={css.selAll} aria-hidden="true">{L("Select all", "Pilih semua")}</span></label></th>
                  <th className={th}>{L("Staff", "Kakitangan")}</th>
                  <th className={`${th} ${css.cWide}`}>{L("Signs in with now", "Log masuk sekarang")}</th>
                  <th className={th}>{L("New login email", "E-mel log masuk baharu")}</th>
                  <th className={`${th} ${css.cState}`}>{L("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {toMove.map((r) => {
                  const [chip, en, ms] = STATE_CHIP[r.state];
                  const bad = picked.has(r.id) && badAddr(r);
                  return (
                    <tr key={r.id} className={picked.has(r.id) ? css.on : undefined} data-testid={`email-move-row-${r.id}`}>
                      <td className={`${td} ${css.cCheck}`}><input type="checkbox" className={css.check} aria-label={r.name} checked={picked.has(r.id)} disabled={!r.can} onChange={() => toggle(r.id)} /></td>
                      <td className={td}>
                        <span className={css.whoText}>
                          <strong>{r.name}</strong>
                          <span>{r.role.replace(/_/g, " ")}{r.department ? ` · ${r.department}` : ""}{!r.active ? L(" · inactive", " · tidak aktif") : ""}</span>
                          <span className={css.phoneOnly}>{r.email}</span>
                          {!r.can && <span>{L("CEO and super admin accounts, and your own, are moved by the super admin.", "Akaun CEO dan super admin, serta akaun anda sendiri, dipindahkan oleh super admin.")}</span>}
                          {r.google_only && <span className={css.warnLine}><AppIcon name="google" /> {L("Signs in with Google only - after the move, Google must be the new address.", "Log masuk dengan Google sahaja - selepas pindah, Google mesti alamat baharu.")}</span>}
                        </span>
                      </td>
                      <td className={`${td} ${css.cWide} ${css.mail}`}>{r.email}</td>
                      <td className={td}>
                        <input className={`${inputClassSm} ${css.addr}`} aria-label={L(`New login email for ${r.name}`, `E-mel log masuk baharu untuk ${r.name}`)} aria-invalid={bad || undefined} disabled={!r.can} value={edits[r.id] ?? (r.pending_to ?? r.proposed)} onChange={(e) => setEdits((d) => ({ ...d, [r.id]: e.target.value }))} />
                        {bad && <span className={css.bad}>{L(`Must end @${newDomain}`, `Mesti berakhir @${newDomain}`)}</span>}
                      </td>
                      <td className={`${td} ${css.cState}`}>
                        <span className={css.state}>
                          <span className={chip}>{L(en, ms)}</span>
                          {r.state === "sent" && r.expires_at && <span className={css.meta}>{L("until", "hingga")} {myt(r.expires_at)}</span>}
                          {r.can && (r.state === "sent" || r.state === "expired") && (
                            <button type="button" className={btnSmQuiet} data-testid={`email-move-resend-${r.id}`} disabled={busy} onClick={() => void review(r, true)}>
                              <AppIcon name="refresh" />{L("Resend", "Hantar semula")}
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {moved.length > 0 && (
        <div className={css.movedWrap}>
          <button type="button" className={btnSmQuiet} onClick={() => setShowMoved((v) => !v)} aria-expanded={showMoved}>
            <AppIcon name={showMoved ? "up" : "down"} />{L(`Already moved (${moved.length})`, `Sudah dipindahkan (${moved.length})`)}
          </button>
          {showMoved && (
            <ul className={css.movedList}>
              {moved.map((r) => <li key={r.id}><strong>{r.name}</strong><span>{r.email}{r.moved_at ? ` · ${myt(r.moved_at)}` : ""}</span></li>)}
            </ul>
          )}
        </div>
      )}

      <SideDrawer open={open} onClose={() => { if (!busy) { setOpen(false); setPreview(null); } }} title={L("Review the email move", "Semak pemindahan e-mel")} subtitle={L("Nothing is sent until you confirm.", "Tiada apa dihantar sehingga anda sahkan.")}
        footer={preview && (
          <div className={css.footer}>
            <button type="button" className={btnSm} disabled={busy} onClick={() => { setOpen(false); setPreview(null); }}>{L("Back", "Kembali")}</button>
            <button type="button" className={btnSmAccent} data-testid="email-move-confirm" disabled={busy || !preview.counts.send || reason.trim().length < 10} onClick={() => void confirm()}>
              <AppIcon name="send" />{busy ? L("Sending…", "Menghantar…") : L(`Send ${preview.counts.send} link${preview.counts.send === 1 ? "" : "s"}`, `Hantar ${preview.counts.send} pautan`)}
            </button>
          </div>
        )}>
        {preview && (
          <div className={css.review} data-testid="email-move-preview">
            <dl className={css.summary}>
              <div><dt>{L("Links to send", "Pautan untuk dihantar")}</dt><dd>{preview.counts.send}</dd></div>
              <div><dt>{L("Already waiting", "Sudah menunggu")}</dt><dd>{preview.counts.already_sent}</dd></div>
              <div><dt>{L("Refused", "Ditolak")}</dt><dd>{preview.counts.refused}</dd></div>
              <div><dt>{L("Link valid", "Pautan sah")}</dt><dd>{list?.ttl_hours ?? 72} {L("hours", "jam")}</dd></div>
            </dl>
            <ul className={css.affected}>
              {preview.rows.map((p) => (
                <li key={p.user_id} data-testid={`email-move-preview-${p.user_id}`}>
                  <span className={css.whoText}>
                    <strong>{p.name ?? `#${p.user_id}`}</strong>
                    <span>{p.from} → <strong>{p.to}</strong></span>
                    {p.reason && <span>{p.reason}</span>}
                  </span>
                  <span className={p.state === "send" ? chipSmSuccess : p.state === "already_sent" ? chipSmInfo : chipSmDanger}>
                    {p.state === "send" ? L("Send link", "Hantar pautan") : p.state === "already_sent" ? L("Waiting", "Menunggu") : L("Refused", "Ditolak")}
                  </span>
                </li>
              ))}
            </ul>
            <label className={css.field}>
              <span>{L("Reason (kept in the audit history)", "Sebab (disimpan dalam sejarah audit)")}</span>
              <input className={inputClassSm} data-testid="email-move-reason" maxLength={300} value={reason} placeholder={L("e.g. Company email moving to a2zcreative.my", "cth. E-mel syarikat berpindah ke a2zcreative.my")} onChange={(e) => setReason(e.target.value)} />
            </label>
            <p className={css.note}><AppIcon name="info" />{L(
              "Each person gets an email in the new mailbox. The login changes only when they open the link; they are then signed out everywhere and sign in with the new address. Their account, history, payslips and records stay the same. The old address is told too.",
              "Setiap orang menerima e-mel di peti mel baharu. Log masuk bertukar hanya apabila mereka membuka pautan; mereka kemudian dilog keluar di semua peranti dan log masuk dengan alamat baharu. Akaun, sejarah, slip gaji dan rekod mereka kekal sama. Alamat lama juga dimaklumkan.")}</p>
            {msg && <p className={css.warn}>{msg}</p>}
          </div>
        )}
      </SideDrawer>
    </section>
  );
}
