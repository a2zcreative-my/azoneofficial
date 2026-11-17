"use client";

/* v1.247.0 - TASK EMAILS, the management side (the owner's brief of
   01-11-2026, claude/TASK-EMAIL-AUDIT.md).

   v1.337.0 - THE TASK EMAIL WORKSPACE (the CEO, 17-11-2026: "Keep email
   configuration in an appropriate authorized settings workspace. Do not create
   duplicate notification engines ... Fix the broken email preview"). The one
   long card that sat at the foot of Tasks > Reports & Archive is now two views
   of System > Automation & Rules:

     TaskEmailSettings  the connected strip (service, in-app, triggers, delivery),
                        the not-configured banner, the triggers and their rules,
                        the delivery configuration AS THE WORKER SEES IT, and the
                        email preview
     TaskEmailLog       the delivery log: every queued / accepted / retried / not
                        sent message, with the provider's own answer

   The engine is unchanged and single (worker/src/task-mail.ts, the email leg of
   notify()): every route, gate and setting is the one it was. Read by the CEO,
   COO and CCO; changed, tested and retried by the CEO (the server decides).
   The sender itself (the send_email binding, MAIL_FROM) is never configured
   here - wrangler.toml and the Cloudflare dashboard own it.

   THE PREVIEW (the broken one): every API answer carries X-Frame-Options: DENY,
   so an iframe pointed AT the preview route was refused by the browser. The
   HTML is now read like any other answer and drawn with srcDoc in a sandboxed
   frame (no scripts, no same-origin) - the DENY header stays as it is.

   NOTHING CLAIMS DELIVERY. "Accepted" means Cloudflare took the message; the
   sender is "proven" only by a message Cloudflare accepted; inbox delivery is
   never claimed. */

import { useCallback, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { PillSwitch } from "@/components/ui/panel";
import { useSaveToast } from "@/components/ui/save-toast";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SplitColumn, SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split";
import { CompactTaskTable, type TableCol } from "@/components/portal/task-table";
import { type PageSize } from "@/components/ui/pagination-controls";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { btnSm, btnSmPrimary, chipDanger, chipInfo, chipNeutral, chipSmSuccess, chipSmWarn, chipSuccess, chipWarn, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import css from "./task-mail.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

type Kind = "assigned" | "moved" | "update" | "mention" | "review" | "decision" | "due" | "overdue" | "escalation" | "reminder" | "digest" | "test";
interface Settings {
  enabled: boolean; triggers: Record<Kind, boolean>; lead_hours: number; escalation_days: number; overdue_days: number[];
  digest_on: boolean; digest_time: string; quiet_from: string; quiet_to: string; cap_per_day: number;
}
interface Diagnostics { binding: boolean; from: string | null; outbox: boolean; waiting: number; oldest_waiting: string | null; last_accepted: string | null; last_test: { status: string; at: string; error: string | null } | null; dead_7d: number }
interface SettingsReply { settings: Settings; sender: { ready: boolean; from: string | null }; can_edit: boolean; can_broadcast?: boolean; diagnostics?: Diagnostics }
interface LogRow { id: number; to_email: string; to_name: string | null; kind: string; subject: string; status: string; attempts: number; last_error: string | null; not_before: string | null; created_at: string; sent_at: string | null; reason: string | null; created_by_name: string | null }

const TRIGGERS: [Kind, string, string, string, string][] = [
  ["assigned", "New task assigned", "Tugasan baharu", "To the assignee, as soon as somebody else sets a task for them.", "Kepada penerima, sebaik sahaja orang lain menetapkan tugasan untuk mereka."],
  ["moved", "Task reassigned", "Tugasan diagih semula", "To the new assignee, and a plain note to the previous one.", "Kepada penerima baharu, dan nota ringkas kepada penerima terdahulu."],
  ["update", "Important update", "Kemas kini penting", "Progress, blocker, waiting for client: to the Project Owner and the assigner - at most one email per task an hour.", "Kemajuan, halangan, menunggu pelanggan: kepada Pemilik Projek dan yang menetapkan - paling banyak satu e-mel sejam setiap tugasan."],
  ["mention", "Mentioned in a comment", "Disebut dalam komen", "To the person mentioned with @, nobody else.", "Kepada orang yang disebut dengan @ sahaja."],
  ["review", "Ready for review", "Sedia untuk semakan", "To the reviewer when the assignee submits for review.", "Kepada penyemak apabila penerima menghantar untuk semakan."],
  ["decision", "Approved or returned", "Diluluskan atau dikembalikan", "To the people who did the work.", "Kepada mereka yang membuat kerja itu."],
  ["due", "Due soon", "Hampir tarikh akhir", "To the assignee, before the deadline (lead time below). Not on leave or a public holiday.", "Kepada penerima, sebelum tarikh akhir. Tidak semasa cuti atau cuti umum."],
  ["overdue", "Overdue", "Lewat", "To the assignee on day 1, 3 and 7 after the deadline, then it stops.", "Kepada penerima pada hari 1, 3 dan 7 selepas tarikh akhir, kemudian berhenti."],
  ["escalation", "Escalation to the HOD", "Eskalasi kepada Ketua Jabatan", "To the assignee's reporting line, once, after the days below. No reporting line, no escalation.", "Kepada barisan pelaporan penerima, sekali. Tiada barisan pelaporan, tiada eskalasi."],
  ["reminder", "Manual reminder", "Peringatan manual", "Sent from a task's drawer by management, the Project Owner or the person who set it.", "Dihantar dari laci tugasan oleh pengurusan, Pemilik Projek atau yang menetapkan."],
];
const PREVIEWS: [Kind, string, string][] = [["assigned", "New task", "Tugasan baharu"], ["update", "Update", "Kemas kini"], ["review", "Review", "Semakan"], ["due", "Due soon", "Hampir tarikh akhir"], ["overdue", "Overdue", "Lewat"], ["escalation", "Escalation", "Eskalasi"], ["reminder", "Reminder", "Peringatan"], ["digest", "Daily digest", "Ringkasan harian"]];

const STATUS_CHIP: Record<string, string> = { accepted: chipSuccess, queued: chipInfo, sending: chipInfo, failed: chipWarn, dead: chipDanger };
const statusLabel = (s: string) => ({ accepted: L("Accepted by Cloudflare", "Diterima Cloudflare"), queued: L("Queued", "Dalam giliran"), sending: L("Sending", "Menghantar"), failed: L("Retrying", "Mencuba semula"), dead: L("Not sent", "Tidak dihantar") }[s] ?? s);
const when = (iso: string | null) => (iso ? new Date(`${iso.replace(" ", "T")}Z`).toLocaleString("en-MY", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) : "—");

/** the settings, the diagnostics and the commands, read once per view */
function useTaskMail() {
  const [cfg, setCfg] = useState<SettingsReply | null>(null);
  const [failed, setFailed] = useState("");
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    void api<SettingsReply & { error?: { message?: string } }>("/staff/tasks/mail-settings").then((r) => {
      if (!alive) return;
      if (r.ok && r.data) { setCfg(r.data); setFailed(""); } else setFailed(r.data?.error?.message ?? L("Task email settings could not be read.", "Tetapan e-mel tugasan tidak dapat dibaca."));
    });
    return () => { alive = false; };
  }, [tick]);
  return { cfg, failed, reload, tick };
}

/** v1.337.0 - the preview, read as text and drawn with srcDoc in a sandboxed frame
    (the API's X-Frame-Options: DENY refused the old iframe src) */
function EmailPreview() {
  const [kind, setKind] = useState<Kind>("assigned");
  const [got, setGot] = useState<{ kind: Kind; html: string | null; error: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/staff/tasks/mail-preview?kind=${kind}`, { credentials: "include" });
        const text = await res.text();
        if (!alive) return;
        if (res.ok && /^\s*<!doctype html>/i.test(text)) setGot({ kind, html: text, error: "" });
        else {
          let msg = L("The preview could not be built.", "Pratonton tidak dapat dibina.");
          try { msg = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* not JSON */ }
          setGot({ kind, html: null, error: `${msg} (${res.status})` });
        }
      } catch {
        if (alive) setGot({ kind, html: null, error: L("No connection - the preview could not be read.", "Tiada sambungan - pratonton tidak dapat dibaca.") });
      }
    })();
    return () => { alive = false; };
  }, [kind]);
  const shown = got && got.kind === kind ? got : null;
  return (
    <SplitPane testid="mail-preview-pane" title={L("Email Preview", "Pratonton E-mel")} label={L("Email preview", "Pratonton e-mel")}
      sub={L("The real template, with your name and a sample task.", "Templat sebenar, dengan nama anda dan tugasan contoh.")}
      actions={<select className={selectClassSm} value={kind} aria-label={L("Which email", "E-mel mana")} onChange={(e) => setKind(e.target.value as Kind)} data-testid="mail-preview-kind">
        {PREVIEWS.map(([k, en, ms]) => <option key={k} value={k}>{L(en, ms)}</option>)}
      </select>}>
      {!shown ? <SkelRows rows={4} /> : shown.html
        ? <iframe title={L("Email preview", "Pratonton e-mel")} className={css.preview} srcDoc={shown.html} sandbox="" data-testid="mail-preview" />
        : <p className={css.warnLine} role="alert" data-testid="mail-preview-error">{shown.error}</p>}
    </SplitPane>
  );
}

/* ------------------------------------------------------------------ the settings view */
export function TaskEmailSettings() {
  const { cfg, failed, reload } = useTaskMail();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [seen, setSeen] = useState<SettingsReply | null>(null);
  if (cfg !== seen) { setSeen(cfg); if (cfg) setDraft(cfg.settings); }
  const [busy, setBusy] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"" | "steps" | "broadcast">("");
  const { show: showToast, node: toastNode } = useSaveToast();

  if (failed && !cfg) return <p className={css.warnLine} role="alert">{failed}</p>;
  if (!cfg || !draft) return <SkelRows rows={8} />;
  const edit = cfg.can_edit;
  const ready = cfg.sender.ready;
  const dg = cfg.diagnostics;
  const dirty = JSON.stringify(draft) !== JSON.stringify(cfg.settings);
  const onCount = TRIGGERS.filter(([k]) => draft.triggers[k]).length + (draft.digest_on ? 1 : 0);

  const save = async () => {
    setBusy("save");
    const r = await api<SettingsReply & { error?: { message?: string } }>("/staff/tasks/mail-settings", { method: "PUT", body: JSON.stringify(draft) });
    setBusy(null);
    if (!r.ok) { showToast(L("Not saved", "Tidak disimpan"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "error"); return; }
    showToast(L("Saved", "Disimpan"), L("Task email settings are updated.", "Tetapan e-mel tugasan dikemas kini."));
    reload();
  };
  const test = async () => {
    setBusy("test");
    const r = await api<{ to?: string; error?: { message?: string } }>("/staff/tasks/mail-test", { method: "POST", body: "{}" });
    setBusy(null);
    if (!r.ok) { showToast(L("Test not sent", "Ujian tidak dihantar"), r.data?.error?.message ?? L("Try again", "Cuba lagi"), "error"); reload(); return; }
    showToast(L("Accepted by Cloudflare", "Diterima Cloudflare"), L(`For ${r.data?.to}. Check that inbox (and its spam folder) - only a received message proves delivery.`, `Untuk ${r.data?.to}. Semak peti masuk itu (dan folder spam) - hanya mesej yang diterima membuktikan penghantaran.`));
    reload();
  };
  const flip = (k: Kind) => setDraft({ ...draft, triggers: { ...draft.triggers, [k]: !draft.triggers[k] } });

  /* the configuration as the Worker sees it - each line a fact, never a guess */
  const proven = dg?.last_test?.status === "accepted" || !!dg?.last_accepted;
  const facts: [string, string, boolean, string][] = [
    [L("Provider binding", "Pengikatan penyedia"), dg?.binding ? L("Bound", "Terikat") : L("Not bound", "Tidak terikat"), !!dg?.binding, "binding"],
    [L("From address", "Alamat pengirim"), dg?.from ?? cfg.sender.from ?? L("Not set", "Tidak ditetapkan"), !!(dg?.from ?? cfg.sender.from), "from"],
    [L("Sender proven", "Pengirim dibuktikan"), proven ? L(`Accepted ${when(dg?.last_accepted ?? dg?.last_test?.at ?? null)}`, `Diterima ${when(dg?.last_accepted ?? dg?.last_test?.at ?? null)}`) : L("Not yet - by an accepted test", "Belum - melalui ujian diterima"), proven, "proven"],
    [L("Delivery queue", "Giliran penghantaran"), !dg?.outbox ? L("Table missing (migration 0161)", "Jadual tiada (migrasi 0161)") : dg.waiting > 0 ? L(`${dg.waiting} waiting · oldest ${when(dg.oldest_waiting)}`, `${dg.waiting} menunggu · tertua ${when(dg.oldest_waiting)}`) : L("Empty · drained every 5 minutes", "Kosong · dikosongkan setiap 5 minit"), !!dg?.outbox, "queue"],
  ];

  return (
    <div className={css.page} data-testid="task-mail-panel">
      {toastNode}
      <KpiRow label={L("Task email figures", "Angka e-mel tugasan")} testid="mail-strip">
        <KpiTile icon={ready ? "verify" : "warning"} tone={ready ? "green" : "gold"} label={L("Email Service", "Perkhidmatan E-mel")} value={ready ? L("Configured", "Dikonfigurasi") : L("Setup required", "Perlu disediakan")}
          sub={ready ? (proven ? L("Sender proven by Cloudflare", "Pengirim dibuktikan Cloudflare") : L("Send a test to prove it", "Hantar ujian untuk membuktikannya")) : L("Not configured for sending", "Belum dikonfigurasi untuk menghantar")} cell="service" />
        <KpiTile icon="success" tone="green" label={L("In-app Alerts", "Amaran Dalam Aplikasi")} value={L("Enabled", "Dihidupkan")} sub={L("The bell rings whatever email does", "Loceng berbunyi walau apa pun e-mel")} cell="inapp" />
        <KpiTile icon="info" tone="blue" label={L("Email Triggers", "Pencetus E-mel")} value={draft.enabled ? `${onCount} / ${TRIGGERS.length + 1}` : L("Off", "Mati")} sub={draft.enabled ? L("Switched on below", "Dihidupkan di bawah") : L("Task emails are off", "E-mel tugasan dimatikan")} cell="triggers" />
        <KpiTile icon="time" tone={dg && dg.dead_7d > 0 ? "red" : "navy"} label={L("Delivery Status", "Status Penghantaran")} value={dg?.last_accepted ? L("Sending", "Menghantar") : L("No sends", "Tiada hantaran")}
          sub={dg?.last_accepted ? L(`Last accepted ${when(dg.last_accepted)}`, `Terakhir diterima ${when(dg.last_accepted)}`) : dg && dg.dead_7d > 0 ? L(`${dg.dead_7d} not sent in 7 days`, `${dg.dead_7d} tidak dihantar dalam 7 hari`) : L("See the Delivery Log", "Lihat Log Penghantaran")} cell="delivery" />
      </KpiRow>

      {!ready && (
        <div className={css.banner} role="status" data-testid="mail-not-configured">
          <AppIcon name="warning" />
          <span><strong>{L("Email sending is not configured", "Penghantaran e-mel belum dikonfigurasi")}</strong>
            {L(" - nothing is queued or sent until it is. The bell and phone notifications work as before.", " - tiada apa dimasukkan ke giliran atau dihantar sehingga ia disediakan. Loceng dan notifikasi telefon berfungsi seperti biasa.")}</span>
          <button type="button" className={btnSm} onClick={() => setDrawer("steps")} data-testid="mail-steps-open">{L("Setup checklist", "Senarai semak persediaan")}</button>
        </div>
      )}

      <WorkspaceSplit testid="mail-split" ratio="55-45">
        <SplitPane testid="mail-triggers" title={L("Notification Triggers", "Pencetus Notifikasi")} label={L("Notification triggers", "Pencetus notifikasi")}
          sub={L("Which task events also send an email, and the rules around them.", "Peristiwa tugasan mana yang turut menghantar e-mel, dan peraturannya.")}
          actions={edit ? <Switch checked={draft.enabled} onChange={() => setDraft({ ...draft, enabled: !draft.enabled })} label={L("Task emails", "E-mel tugasan")} testid="mail-master" /> : undefined}
          foot={edit ? (
            <span className={css.foot}>
              <span className={css.note}>{dirty ? L("Unsaved changes", "Perubahan belum disimpan") : L("Only the CEO changes these settings.", "Hanya CEO menukar tetapan ini.")}</span>
              <button type="button" className={btnSmPrimary} disabled={!dirty || busy !== null} onClick={() => void save()} data-testid="mail-save">{busy === "save" ? L("Saving…", "Menyimpan…") : L("Save settings", "Simpan tetapan")}</button>
            </span>
          ) : <span className={css.note}>{L("Only the CEO changes these settings.", "Hanya CEO menukar tetapan ini.")}</span>}>
          <ul className={css.triggers}>
            {TRIGGERS.map(([k, en, ms, den, dms]) => (
              <li key={k} className={css.trigger} data-testid={`mail-trigger-${k}`}>
                <span className={css.trigText}><strong>{L(en, ms)}</strong><span>{L(den, dms)}</span></span>
                <Switch checked={draft.enabled && draft.triggers[k]} disabled={!edit || !draft.enabled} onChange={() => flip(k)} label={<span className="erp-sr-only">{L(`${en} email`, `E-mel ${ms}`)}</span>} showState={false} />
              </li>
            ))}
            <li className={css.trigger} data-testid="mail-trigger-digest">
              <span className={css.trigText}><strong>{L("Daily digest", "Ringkasan harian")}</strong><span>{L("One summary each working morning at 8:30 AM: overdue, due in 3 days, waiting for review, blocked. Never empty, never on leave or a public holiday.", "Satu ringkasan setiap pagi bekerja pada 8:30 pagi. Tidak dihantar jika kosong, semasa cuti atau cuti umum.")}</span></span>
              <Switch checked={draft.enabled && draft.digest_on} disabled={!edit || !draft.enabled} onChange={() => setDraft({ ...draft, digest_on: !draft.digest_on, triggers: { ...draft.triggers, digest: !draft.digest_on } })} label={<span className="erp-sr-only">{L("Daily digest email", "E-mel ringkasan harian")}</span>} showState={false} />
            </li>
          </ul>
          <div className={css.fields}>
            <label>{L("Reminder before the deadline", "Peringatan sebelum tarikh akhir")}
              <select className={selectClassSm} disabled={!edit} value={draft.lead_hours} onChange={(e) => setDraft({ ...draft, lead_hours: Number(e.target.value) })}>
                {[24, 48, 72, 168].map((h) => <option key={h} value={h}>{h === 168 ? L("1 week", "1 minggu") : L(`${h / 24} day${h > 24 ? "s" : ""}`, `${h / 24} hari`)}</option>)}
              </select></label>
            <label>{L("Escalate to the HOD after", "Eskalasi kepada Ketua Jabatan selepas")}
              <select className={selectClassSm} disabled={!edit} value={draft.escalation_days} onChange={(e) => setDraft({ ...draft, escalation_days: Number(e.target.value) })}>
                {[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{L(`${d} day${d > 1 ? "s" : ""} overdue`, `${d} hari lewat`)}</option>)}
              </select></label>
            <label>{L("Most task emails per person a day", "Maksimum e-mel tugasan seorang sehari")}
              <input className={inputClassSm} type="number" min={1} max={50} disabled={!edit} value={draft.cap_per_day} onChange={(e) => setDraft({ ...draft, cap_per_day: Number(e.target.value) || 1 })} /></label>
            <label>{L("Quiet hours (held until the end)", "Waktu senyap (ditahan hingga tamat)")}
              <span className={css.pair}>
                <input className={inputClassSm} type="time" disabled={!edit} value={draft.quiet_from} aria-label={L("Quiet from", "Senyap dari")} onChange={(e) => setDraft({ ...draft, quiet_from: e.target.value })} />
                <span>–</span>
                <input className={inputClassSm} type="time" disabled={!edit} value={draft.quiet_to} aria-label={L("Quiet until", "Senyap hingga")} onChange={(e) => setDraft({ ...draft, quiet_to: e.target.value })} />
              </span></label>
          </div>
          <p className={css.note}>{L("Duplicates are impossible: each email has one reference, queued once. A new assignment, a reassignment and a manual reminder go at once, even in quiet hours; the rest wait for the morning and count towards the daily cap. A link opens the task only for someone who may open it.", "Pendua mustahil: setiap e-mel ada satu rujukan, dimasukkan ke giliran sekali. Tugasan baharu, agihan semula dan peringatan manual dihantar serta-merta; yang lain menunggu pagi dan dikira dalam had harian. Pautan membuka tugasan hanya untuk mereka yang boleh membukanya.")}</p>
        </SplitPane>
        <SplitColumn>
          <SplitPane fit testid="mail-config" title={L("Email Delivery Configuration", "Konfigurasi Penghantaran E-mel")} label={L("Email delivery configuration", "Konfigurasi penghantaran e-mel")}
            actions={<span className={ready ? chipSmSuccess : chipSmWarn} data-testid="mail-config-state">{ready ? L("Ready", "Sedia") : L("Not ready", "Belum sedia")}</span>}
            foot={<span className={css.foot}>
              <button type="button" className={btnSm} onClick={() => setDrawer("steps")}>{L("Setup checklist", "Senarai semak persediaan")}</button>
              {edit && <button type="button" className={btnSmPrimary} disabled={busy !== null || !ready} title={!ready ? L("Configure sending first", "Konfigurasi penghantaran dahulu") : undefined} onClick={() => void test()} data-testid="mail-test">{busy === "test" ? L("Sending…", "Menghantar…") : L("Send a test to me", "Hantar ujian kepada saya")}</button>}
              {cfg.can_broadcast && <button type="button" className={btnSm} onClick={() => setDrawer("broadcast")} data-testid="mail-broadcast-open">{L("Send a task update", "Hantar kemas kini tugasan")}</button>}
            </span>}>
            <dl className={css.facts}>
              {facts.map(([k, v, good, key]) => <div key={key} data-testid={`mail-fact-${key}`}><dt>{k}</dt><dd className={good ? css.good : css.warnText}>{v}</dd></div>)}
            </dl>
            {dg?.last_test && dg.last_test.status !== "accepted" && dg.last_test.error && <p className={css.warnLine}>{L("Last test", "Ujian terakhir")}: {dg.last_test.error}</p>}
          </SplitPane>
          <EmailPreview />
        </SplitColumn>
      </WorkspaceSplit>

      <SideDrawer open={drawer === "steps"} onClose={() => setDrawer("")} title={L("Email setup checklist", "Senarai semak persediaan e-mel")}
        subtitle={L("Done by the owner in Cloudflare and wrangler.toml - never here", "Dibuat oleh pemilik di Cloudflare dan wrangler.toml - bukan di sini")}>
        <ol className={css.steps} data-testid="mail-steps">
          <li><strong>{L("Onboard the sending domain", "Daftarkan domain penghantaran")}</strong>{L(" - Cloudflare dashboard > Compute > Email Service > Email Sending > Onboard Domain: a2zcreative.my. Cloudflare adds SPF, DKIM and DMARC.", " - Papan pemuka Cloudflare > Compute > Email Service > Email Sending > Onboard Domain: a2zcreative.my. Cloudflare menambah SPF, DKIM dan DMARC.")}</li>
          <li><strong>{L("Bind the sender to the API worker", "Ikat pengirim kepada pekerja API")}</strong>{L(" - in worker/wrangler.toml uncomment [[send_email]] name = \"EMAIL\" and add MAIL_FROM = \"A2Z Creative Marketing <hello@a2zcreative.my>\" to [vars].", " - dalam worker/wrangler.toml buka [[send_email]] name = \"EMAIL\" dan tambah MAIL_FROM ke [vars].")}</li>
          <li><strong>{L("Release", "Keluarkan")}</strong>{L(" - run PUSH.bat. The 5-minute task then drains the queue.", " - jalankan PUSH.bat. Tugas 5 minit kemudian mengosongkan giliran.")}</li>
          <li><strong>{L("Prove it", "Buktikan")}</strong>{L(" - Send a test to me. \"Accepted\" means Cloudflare took it; open your inbox (and spam) to confirm it arrived. Only then are task emails proven.", " - Hantar ujian kepada saya. \"Diterima\" bermakna Cloudflare mengambilnya; buka peti masuk (dan spam) untuk mengesahkan ia sampai.")}</li>
        </ol>
        <dl className={css.facts}>{facts.map(([k, v, good, key]) => <div key={key}><dt>{k}</dt><dd className={good ? css.good : css.warnText}>{v}</dd></div>)}</dl>
      </SideDrawer>
      {cfg.can_broadcast && (
        <SideDrawer open={drawer === "broadcast"} onClose={() => setDrawer("")} wide dirty="auto" title={L("Send a task update", "Hantar kemas kini tugasan")}
          subtitle={L("One email each: your message, then that person's own open tasks", "Satu e-mel setiap orang: mesej anda, kemudian tugasan terbuka orang itu")}>
          <BroadcastCard ready={ready} onSent={() => { reload(); setDrawer(""); }} />
        </SideDrawer>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the delivery log view */
export function TaskEmailLog() {
  const { cfg } = useTaskMail();
  const [show, setShow] = useState<"all" | "dead">("all");
  const [log, setLog] = useState<{ rows: LogRow[]; counts: Record<string, number>; pending_migration?: boolean } | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(10);
  const { show: showToast, node: toastNode } = useSaveToast();
  useEffect(() => {
    let alive = true;
    void api<{ rows: LogRow[]; counts: Record<string, number>; pending_migration?: boolean }>(`/staff/tasks/mail-log${show === "dead" ? "?status=dead" : ""}`).then((r) => { if (alive) { setLog(r.ok && r.data ? r.data : { rows: [], counts: {} }); setPage(1); } });
    return () => { alive = false; };
  }, [show, tick]);
  const edit = !!cfg?.can_edit;
  const retry = async (id: number) => {
    setBusy(id);
    const r = await api<{ error?: { message?: string } }>(`/staff/tasks/mail-log/${id}/retry`, { method: "POST", body: "{}" });
    setBusy(null);
    if (!r.ok) { showToast(L("Not queued", "Tidak dalam giliran"), r.data?.error?.message ?? "", "error"); return; }
    showToast(L("Queued again", "Dimasukkan semula"), L("It goes out on the next five-minute pass.", "Ia dihantar pada pusingan lima minit seterusnya."));
    setTick((n) => n + 1);
  };
  const cols: TableCol<LogRow>[] = [
    { key: "when", label: L("When", "Bila"), cell: (r) => <span className={css.nowrap}>{when(r.sent_at ?? r.created_at)}</span> },
    { key: "email", label: L("Email", "E-mel"), main: true, cell: (r) => <span className={css.cell}><span className={css.subject}>{r.subject.replace(/^\[A2Z OS\] /, "")}</span>{r.reason && <span className={css.why}>{L("Reason", "Sebab")}: {r.reason}{r.created_by_name ? ` — ${r.created_by_name}` : ""}</span>}</span> },
    { key: "to", label: L("To", "Kepada"), cell: (r) => <span className={css.cell}>{r.to_name ?? "—"}<span className={css.why}>{r.to_email === "-" ? "" : r.to_email}</span></span> },
    { key: "status", label: L("Status", "Status"), cell: (r) => <span className={css.cell}><span className={STATUS_CHIP[r.status] ?? chipNeutral}>{statusLabel(r.status)}</span>{r.last_error && <span className={css.why}>{r.last_error}</span>}{r.status === "queued" && r.not_before && <span className={css.why}>{L("held until", "ditahan hingga")} {when(r.not_before)}</span>}</span> },
    { key: "cmd", label: "", cmds: true, cell: (r) => (edit && (r.status === "dead" || r.status === "failed") && r.to_email !== "-" ? <button type="button" className={btnSm} disabled={busy !== null} onClick={() => void retry(r.id)}>{L("Retry", "Cuba semula")}</button> : null) },
  ];
  const c = log?.counts ?? {};
  return (
    <div className={css.page} data-testid="mail-log-view">
      {toastNode}
      <KpiRow label={L("Delivery, last 7 days", "Penghantaran, 7 hari lepas")} testid="mail-log-strip">
        <KpiTile icon="success" tone="green" label={L("Accepted", "Diterima")} value={c.accepted ?? 0} busy={!log} sub={L("Taken by Cloudflare · 7 days", "Diambil Cloudflare · 7 hari")} cell="accepted" />
        <KpiTile icon="time" tone="blue" label={L("Queued", "Dalam giliran")} value={(c.queued ?? 0) + (c.sending ?? 0)} busy={!log} sub={L("Waiting for the 5-minute pass", "Menunggu pusingan 5 minit")} cell="queued" />
        <KpiTile icon="refresh" tone="gold" label={L("Retrying", "Mencuba semula")} value={c.failed ?? 0} busy={!log} sub={L("After 5, then 20 minutes", "Selepas 5, kemudian 20 minit")} cell="retrying" />
        <KpiTile icon="error" tone="red" label={L("Not sent", "Tidak dihantar")} value={c.dead ?? 0} busy={!log} sub={L("Reason on each row", "Sebab pada setiap baris")} cell="dead" onClick={() => setShow("dead")} pressed={show === "dead"} />
      </KpiRow>
      <WorkspaceSplit testid="mail-log-split" ratio="50-50">
        <SplitPane testid="mail-log" title={L("Delivery Log", "Log Penghantaran")} label={L("Delivery log", "Log penghantaran")}
          sub={L("Every task email with the provider's own answer. \"Accepted\" is not inbox delivery.", "Setiap e-mel tugasan dengan jawapan penyedia sendiri. \"Diterima\" bukan penghantaran ke peti masuk.")}
          toolbar={<PillSwitch testid="mail-log-show" label={L("Show", "Papar")} value={show} onChange={setShow} options={[["all", L("All", "Semua")], ["dead", L("Not sent only", "Tidak dihantar sahaja")]] as const} />}>
          {!log ? <SkelRows rows={5} /> : log.pending_migration ? <p className={css.note}>{L("The delivery log appears once migration 0161 has run.", "Log penghantaran muncul selepas migrasi 0161 dijalankan.")}</p> : (
            <CompactTaskTable rows={log.rows} cols={cols} label={L("Delivery log", "Log penghantaran")} record="mail" testid="mail-log-table"
              onOpen={() => undefined} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(1); }}
              empty={<p className={css.note}>{L("No task emails yet. They appear here once sending is configured and a task event happens.", "Belum ada e-mel tugasan. Ia muncul di sini selepas penghantaran dikonfigurasi dan peristiwa tugasan berlaku.")}</p>} />
          )}
        </SplitPane>
      </WorkspaceSplit>
    </div>
  );
}

/* v1.249.0 - SEND A TASK UPDATE (the owner, 01-11-2026): a subject and a message
   to the people chosen; each gets ONE email with the message and their own open
   tasks - nobody sees another person's work. Who may send is the
   "Send a task update email" row of Roles & Permissions (default the CEO).
   v1.337.0 - drawn inside its drawer on the Task Email view. */
function BroadcastCard({ ready, onSent }: { ready: boolean; onSent: () => void }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"open_work" | "people">("open_work");
  const [people, setPeople] = useState<{ id: number; name: string; role?: string }[] | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [prev, setPrev] = useState<{ html: string; recipients: number; sample_for: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const { show, node } = useSaveToast();
  const pick = async (m: "open_work" | "people") => {
    setMode(m); setPrev(null);
    if (m === "people" && !people) {
      const r = await api<{ staff?: { id: number; name: string; role?: string }[] }>("/staff/staff-list");
      setPeople(r.data?.staff ?? []);
    }
  };
  const payload = (preview: boolean) => JSON.stringify({ subject, message, to: mode === "open_work" ? "open_work" : chosen, ...(preview ? { preview: true } : {}) });
  const ok = subject.trim().length >= 3 && message.trim().length >= 5 && (mode === "open_work" || chosen.length > 0);
  const doPreview = async () => {
    setBusy(true); setMsg("");
    const r = await api<{ html?: string; recipients?: number; sample_for?: string | null; error?: { message?: string } }>("/staff/tasks/mail-broadcast", { method: "POST", body: payload(true) });
    setBusy(false);
    if (!r.ok || !r.data?.html) { setMsg(r.data?.error?.message ?? L("No preview", "Tiada pratonton")); return; }
    setPrev({ html: r.data.html, recipients: r.data.recipients ?? 0, sample_for: r.data.sample_for ?? null });
  };
  const send = async () => {
    setBusy(true); setMsg("");
    const r = await api<{ queued?: number; skipped?: { id: number; why: string }[]; error?: { message?: string } }>("/staff/tasks/mail-broadcast", { method: "POST", body: payload(false) });
    setBusy(false);
    if (!r.ok) { setMsg(r.data?.error?.message ?? L("Not sent", "Tidak dihantar")); return; }
    const skipped = r.data?.skipped?.length ?? 0;
    show(L(`Queued for ${r.data?.queued ?? 0} people`, `Dalam giliran untuk ${r.data?.queued ?? 0} orang`), skipped > 0 ? L(`${skipped} skipped - see the log`, `${skipped} dilangkau - lihat log`) : L("It goes out on the next five-minute pass.", "Ia dihantar pada pusingan lima minit seterusnya."));
    setSubject(""); setMessage(""); setPrev(null); setChosen([]);
    onSent();
  };
  return (
    <div className={css.broadcast} data-testid="task-broadcast">
      {node}
      <p className={css.note}>{L("Each person gets one email: your message, then their own open tasks (status, progress, due date). Nobody sees anybody else's work. Once per person per hour.", "Setiap orang menerima satu e-mel: mesej anda, kemudian tugasan terbuka mereka sendiri. Tiada siapa melihat kerja orang lain. Sekali sejam bagi setiap orang.")}</p>
      <div className={css.bcRow} role="radiogroup" aria-label={L("Who receives it", "Siapa menerima")}>
        <label className={css.bcOpt}><input type="radio" name="bc-to" checked={mode === "open_work"} onChange={() => void pick("open_work")} />{L("Everyone with open tasks", "Semua yang ada tugasan terbuka")}</label>
        <label className={css.bcOpt}><input type="radio" name="bc-to" checked={mode === "people"} onChange={() => void pick("people")} />{L("Chosen people", "Orang dipilih")}</label>
      </div>
      {mode === "people" && (!people ? <SkelRows rows={2} /> : (
        <div className={css.bcPeople}>
          {people.map((p) => (
            <label key={p.id} className={css.bcOpt}><input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} />{p.name}{p.role === "agent" ? ` · ${L("agent", "ejen")}` : ""}</label>
          ))}
        </div>
      ))}
      <label className={css.bcField}><span>{L("Subject", "Subjek")}</span><input className={inputClassSm} value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} placeholder={L("e.g. This week's priorities", "cth. Keutamaan minggu ini")} /></label>
      <label className={css.bcField}><span>{L("Message", "Mesej")}</span><textarea className={inputClassSm} rows={4} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} /></label>
      {msg && <p className={css.warnLine} role="alert">{msg}</p>}
      <div className={css.bcRow}>
        <button type="button" className={btnSm} disabled={!ok || busy} onClick={() => void doPreview()}>{L("Preview", "Pratonton")}</button>
        <button type="button" className={btnSmPrimary} disabled={!ok || busy || !ready} title={!ready ? L("The sender is not set up yet", "Penghantar belum disediakan") : undefined} onClick={() => void send()}>{L("Send the update", "Hantar kemas kini")}</button>
      </div>
      {prev && (<>
        <p className={css.note}>{L(`${prev.recipients} people · preview for ${prev.sample_for ?? "the first of them"}`, `${prev.recipients} orang · pratonton untuk ${prev.sample_for ?? "yang pertama"}`)}</p>
        <iframe title={L("Task update preview", "Pratonton kemas kini tugasan")} sandbox="" srcDoc={prev.html} className={css.preview} />
      </>)}
    </div>
  );
}
