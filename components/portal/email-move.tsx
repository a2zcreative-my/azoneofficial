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

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { L, withStepUp } from "@/components/portal/page-shared";
import { usePrompt } from "@/components/ui/prompt-dialog";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { btnSm, btnSmAccent, btnSmQuiet, card, chipSmDanger, chipSmInfo, chipSmNeutral, chipSmSuccess, chipSmWarn, inputClassSm, td, th } from "@/lib/ui-styles";
import { roleLabel } from "@/components/portal/users-shared";
import css from "./email-move.module.css";

type State = "not_started" | "sent" | "expired" | "cancelled" | "moved";
type Row = { id: number; name: string; email: string; role: string; department: string | null; active: boolean; proposed: string; state: State; pending_to: string | null; expires_at: string | null; moved_at: string | null; google_only: boolean; google: boolean; can: boolean; source?: "old_domain" | "personal" };
type List = { rows: Row[]; old_domain: string; new_domain: string; mail_ready: boolean; ttl_hours: number };
type PRow = { user_id: number; name: string | null; from: string | null; to: string; state: "send" | "already_sent" | "refused"; reason: string | null; google_only: boolean; personal?: boolean; result?: "sent" | "mail_failed" };
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
  /* 18-11-2026 (the CEO's Users & Security reference): the personal-email staff are an option you
     switch on - the count says they are there; ticking lists them; turning it off un-ticks them */
  const [withPersonal, setWithPersonal] = useState(false);
  const [help, setHelp] = useState(false);
  const { prompt, node: promptNode } = usePrompt();

  const load = useCallback(async () => {
    const r = await api<List & { error?: { message?: string } }>("/staff/accounts/email-move");
    if (!r.ok || !r.data || !Array.isArray(r.data.rows)) { setFailed(r.data?.error?.message ?? L("Could not load the list.", "Senarai tidak dapat dimuatkan.")); return; }
    setFailed(null); setList(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = list?.rows ?? [];
  /* v1.378.0 - the CEO: personal-email staff (Gmail and others) are an OPTION - hidden until he ticks
     "Include", listed after the old-domain staff, never ticked for him */
  /* v1.380.0 - the CEO (18-11-2026): "still cant see any gmail staff account!" - they are always listed
     now, in their own section under the old-domain staff; still never ticked for him */
  const isPersonal = (r: Row) => r.source === "personal";
  const personalCount = rows.filter((r) => r.state !== "moved" && isPersonal(r)).length;
  const toMove = useMemo(() => rows.filter((r) => r.state !== "moved" && (withPersonal || !isPersonal(r))).sort((a, b) => Number(isPersonal(a)) - Number(isPersonal(b))), [rows, withPersonal]);
  const moved = useMemo(() => rows.filter((r) => r.state === "moved"), [rows]);
  const choosable = toMove.filter((r) => r.can && !isPersonal(r)); // v1.380.0 - Select all never ticks a personal-email person
  const addr = (r: Row) => (edits[r.id] ?? (r.pending_to ?? r.proposed)).trim().toLowerCase();
  const newDomain = list?.new_domain ?? "a2zcreative.my";
  const oldAt = list?.old_domain ? `@${list.old_domain}` : "@azoneofficial.com"; // v1.377.0 - an older engine answers without it
  const badAddr = (r: Row) => !addr(r).endsWith(`@${newDomain}`) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr(r));
  const allOn = choosable.length > 0 && choosable.every((r) => picked.has(r.id));
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(choosable.map((r) => r.id)));
  const items = () => toMove.filter((r) => picked.has(r.id)).map((r) => ({ user_id: r.id, new_email: addr(r), ...(resend.has(r.id) ? { resend: true } : {}) }));
  const personalPicked = (ids: number[]) => ids.some((id) => rows.some((r) => r.id === id && isPersonal(r)));
  const switchPersonal = (on: boolean) => {
    setWithPersonal(on);
    if (!on) setPicked((sel) => new Set([...sel].filter((id) => !rows.some((r) => r.id === id && isPersonal(r)))));
  };


  const review = async (only?: Row, again = false) => {
    setMsg(null); setDone(null);
    if (only) { setPicked(new Set([only.id])); if (again) setResend(new Set([only.id])); }
    const body = only ? [{ user_id: only.id, new_email: addr(only), ...(again ? { resend: true } : {}) }] : items();
    if (!body.length) return;
    setBusy(true);
    const r = await api<Preview & { error?: { message?: string } }>("/staff/accounts/email-move", { method: "POST", body: JSON.stringify({ items: body, dry_run: true, ...(personalPicked(body.map((b) => b.user_id)) ? { include_personal: true } : {}) }) });
    setBusy(false);
    if (!r.ok || !r.data) { setMsg(r.data?.error?.message ?? L("The check failed - nothing was sent.", "Semakan gagal - tiada apa dihantar.")); return; }
    setPreview(r.data); setOpen(true);
  };

  const confirm = async () => {
    if (!preview) return;
    const body = preview.rows.filter((p) => p.state === "send").map((p) => ({ user_id: p.user_id, new_email: p.to, ...(resend.has(p.user_id) ? { resend: true } : {}) }));
    setBusy(true); setMsg(null);
    const r = await withStepUp<Preview & { error?: { message?: string } }>(
      (totp) => api("/staff/accounts/email-move", { method: "POST", body: JSON.stringify({ items: body, reason: reason.trim(), ...(personalPicked(body.map((b) => b.user_id)) ? { include_personal: true } : {}), ...(totp ? { totp } : {}) }) }),
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
      <div className={css.headRow}><div className={css.lead}><span className={css.well}><AppIcon name="send" /></span><p className={css.h3}>{L("Move staff to @a2zcreative.my", "Pindahkan kakitangan ke @a2zcreative.my")}</p></div></div>
      <p className={css.warn}>{failed}</p>
    </section>
  );

  const shown = rows;
  /* the figures follow what is listed: the personal-email staff count only once they are included */
  const counts = { total: shown.length, moved: moved.length, sent: toMove.filter((r) => r.state === "sent").length, waiting: toMove.filter((r) => r.state !== "sent").length };
  const ttl = list?.ttl_hours ?? 72;

  return (
    <section className={`${card} ${css.card}`} data-testid="email-move">
      {promptNode}
      <div className={css.headRow}>
        <div className={css.lead}>
          <span className={css.well}><AppIcon name="send" /></span>
          <div className={css.headText}>
            <p className={css.h3}>{L(`Move staff to @${newDomain}`, `Pindahkan kakitangan ke @${newDomain}`)}</p>
            <p className={css.hint}>{L("Send verification to the new mailbox first. The current login keeps working until it is confirmed.", "Hantar pengesahan ke peti mel baharu dahulu. Log masuk semasa masih berfungsi sehingga ia disahkan.")}</p>
          </div>
        </div>
        <button type="button" className={btnSm} data-testid="email-move-help" onClick={() => setHelp(true)}><AppIcon name="info" />{L("Help & rules", "Bantuan & peraturan")}</button>
      </div>
      {/* the one connected KPI strip (the Tasks module's) - figures from the list the server sent */}
      {list && (
        <KpiRow label={L("Email move figures", "Angka pemindahan e-mel")} testid="email-move-counts">
          <KpiTile icon="time" tone="gold" label={L("To move", "Untuk dipindah")} value={counts.waiting} sub={L("Not sent or not confirmed", "Belum dihantar atau disahkan")} />
          <KpiTile icon="send" tone="blue" label={L("Links sent", "Pautan dihantar")} value={counts.sent} sub={L(`Waiting, valid ${ttl} hours`, `Menunggu, sah ${ttl} jam`)} />
          <KpiTile icon="success" tone="green" label={L("Already moved", "Sudah dipindahkan")} value={counts.moved} sub={L(`Sign in with @${newDomain}`, `Log masuk dengan @${newDomain}`)} />
        </KpiRow>
      )}
      <p className={css.band} role="note"><AppIcon name="info" />{L(`Each person confirms from the new mailbox within ${ttl} hours. Until then the old login email keeps working.`, `Setiap orang mengesahkan dari peti mel baharu dalam ${ttl} jam. Sehingga itu e-mel log masuk lama masih berfungsi.`)}</p>
      {personalCount > 0 && (
        <label className={css.option} data-testid="email-move-include-personal">
          <input type="checkbox" className={css.check} checked={withPersonal} onChange={(e) => switchPersonal(e.target.checked)} />
          <span className={css.optionText}>
            <strong>{L(`Also include staff using a personal email (${personalCount})`, `Sertakan juga kakitangan yang menggunakan e-mel peribadi (${personalCount})`)}</strong>
            <span>{L(`Optional - only staff who already have a working @${newDomain} mailbox.`, `Pilihan - hanya kakitangan yang sudah mempunyai peti mel @${newDomain} yang berfungsi.`)}</span>
          </span>
        </label>
      )}
      {list && !list.mail_ready && <p className={css.warn}><AppIcon name="warning" /> {L("Email sending is not set up - links cannot be sent yet.", "Penghantaran e-mel belum disediakan - pautan belum boleh dihantar.")}</p>}
      {done && <p className={css.done} data-testid="email-move-done"><AppIcon name="success" /> {done}</p>}
      {msg && !open && <p className={css.warn}>{msg}</p>}

      {!list ? <SkelRows rows={4} /> : toMove.length === 0 ? (
        <p className={css.empty}>{personalCount > 0 && !withPersonal
          ? L(`Nobody signs in with ${oldAt} any more. Tick the option above to list the staff with a personal email.`, `Tiada siapa lagi log masuk dengan ${oldAt}. Tandakan pilihan di atas untuk menyenaraikan kakitangan dengan e-mel peribadi.`)
          : L(`Nobody signs in with ${oldAt} any more.`, `Tiada siapa lagi log masuk dengan ${oldAt}.`)}</p>
      ) : (
        <>
          <div className={css.bar}>
            <label className={css.selCount}><input type="checkbox" className={css.check} aria-label={L("Select all", "Pilih semua")} checked={allOn} disabled={!choosable.length} onChange={toggleAll} /><strong>{picked.size}</strong> {L("selected", "dipilih")}</label>
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
                  <th className={`${th} ${css.cWide}`}>{L("Current login", "Log masuk semasa")}</th>
                  <th className={th}>{L("New login email", "E-mel log masuk baharu")}</th>
                  <th className={`${th} ${css.cState}`}>{L("Status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {toMove.map((r, i) => {
                  const [chip, en, ms] = STATE_CHIP[r.state];
                  const groupHead = isPersonal(r) && (i === 0 || !isPersonal(toMove[i - 1]!)) ? (
                    <tr key={`g-${r.id}`} className={css.group} data-testid="email-move-personal">
                      <td colSpan={5}>
                        <strong>{L(`Staff with a personal email - Gmail and others (${personalCount})`, `Kakitangan dengan e-mel peribadi - Gmail dan lain-lain (${personalCount})`)}</strong>
                        <span>{L("Optional: tick only the ones you want to move. Each needs a working @a2zcreative.my mailbox first - the link goes there. The new address is suggested from the name; check it.", "Pilihan: tandakan hanya yang anda mahu pindahkan. Setiap seorang memerlukan peti mel @a2zcreative.my yang berfungsi dahulu - pautan dihantar ke situ. Alamat baharu dicadangkan dari nama; semaknya.")}</span>
                      </td>
                    </tr>
                  ) : null;
                  const bad = picked.has(r.id) && badAddr(r);
                  return (<Fragment key={r.id}>{groupHead}
                    <tr className={picked.has(r.id) ? css.on : undefined} data-testid={`email-move-row-${r.id}`}>
                      <td className={`${td} ${css.cCheck}`}><input type="checkbox" className={css.check} aria-label={r.name} checked={picked.has(r.id)} disabled={!r.can} onChange={() => toggle(r.id)} /></td>
                      <td className={td}>
                        <span className={css.whoText}>
                          <strong>{r.name}</strong>
                          <span>{roleLabel(r.role)}{r.department ? ` · ${r.department}` : ""}{!r.active ? L(" · inactive", " · tidak aktif") : ""}</span>
                          {isPersonal(r) && <span><span className={chipSmWarn}>{L("Personal email", "E-mel peribadi")}</span> {L("suggested from the name - check it", "dicadangkan dari nama - semak")}</span>}
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
                    </tr></Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {list && (
        <div className={css.foot}>
          <p className={css.footNote}>{L("Each chosen person gets their own verification link - no account switches at once.", "Setiap orang yang dipilih menerima pautan pengesahan sendiri - tiada akaun bertukar serta-merta.")}</p>
          {moved.length > 0 && (
            <button type="button" className={btnSm} onClick={() => setShowMoved((v) => !v)} aria-expanded={showMoved} data-testid="email-move-show-moved">
              {L(`${showMoved ? "Hide" : "Show"} already moved (${moved.length})`, `${showMoved ? "Sembunyi" : "Tunjuk"} sudah dipindahkan (${moved.length})`)}<AppIcon name={showMoved ? "up" : "down"} />
            </button>
          )}
        </div>
      )}
      {showMoved && moved.length > 0 && (
        <ul className={css.movedList}>
          {moved.map((r) => <li key={r.id}><strong>{r.name}</strong><span>{r.email}{r.moved_at ? ` · ${myt(r.moved_at)}` : ""}</span></li>)}
        </ul>
      )}

      <SideDrawer open={help} onClose={() => setHelp(false)} title={L("Help & rules", "Bantuan & peraturan")} subtitle={L(`Moving staff logins to @${newDomain}`, `Memindahkan log masuk kakitangan ke @${newDomain}`)}>
        <div className={css.review} data-testid="email-move-rules">
          <p className={css.hint}>{L(
            `Staff who sign in with ${oldAt}, and below them the staff with a personal email (Gmail and others) - moved only if you tick them. Each person confirms from the new mailbox (link valid ${ttl} hours); until then the old address keeps working.`,
            `Kakitangan yang log masuk dengan ${oldAt}, dan di bawahnya kakitangan dengan e-mel peribadi (Gmail dan lain-lain) - dipindahkan hanya jika anda menandakannya. Setiap orang mengesahkan dari peti mel baharu (pautan sah ${ttl} jam); sehingga itu alamat lama masih berfungsi.`)}</p>
          <ul className={css.rules}>
            <li>{L(`The new address must end @${newDomain}. Each proposal keeps the person's name; edit it where the mailbox differs.`, `Alamat baharu mesti berakhir @${newDomain}. Setiap cadangan mengekalkan nama orang itu; ubah jika peti mel berbeza.`)}</li>
            <li>{L("Review asks the server first and shows every person; sending asks for a reason and your authenticator code, and is kept in the audit history.", "Semakan bertanya kepada pelayan dahulu dan menunjukkan setiap orang; penghantaran memerlukan sebab dan kod pengesah anda, dan disimpan dalam sejarah audit.")}</li>
            <li>{L("The login changes only when the person opens the link. They are then signed out everywhere and sign in with the new address; their account, history, payslips and records stay the same.", "Log masuk bertukar hanya apabila orang itu membuka pautan. Mereka kemudian dilog keluar di semua peranti dan log masuk dengan alamat baharu; akaun, sejarah, slip gaji dan rekod mereka kekal sama.")}</li>
            <li>{L("Passwords, two-factor sign-in and Google links are not touched by the move.", "Kata laluan, log masuk dua faktor dan pautan Google tidak disentuh oleh pemindahan.")}</li>
            <li>{L("CEO and super admin accounts, and your own, are moved by the super admin.", "Akaun CEO dan super admin, serta akaun anda sendiri, dipindahkan oleh super admin.")}</li>
          </ul>
        </div>
      </SideDrawer>

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
                    {p.personal && p.state === "send" && <span>{L("Personal email today - after the move they sign in with the new address. A linked Google sign-in keeps working.", "E-mel peribadi sekarang - selepas pindah mereka log masuk dengan alamat baharu. Log masuk Google yang dipautkan masih berfungsi.")}</span>}
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
