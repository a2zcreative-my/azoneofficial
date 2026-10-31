"use client";

/* v1.238.0 - REPORT A PROBLEM (the owner, 31-10-2026; claude/ACCOUNT-
   RECOVERY-AUDIT.md: "Use existing Tasks/Desk infrastructure ... Avoid a
   duplicate ticket-management system. Do not store passwords, tokens or
   sensitive account credentials in support reports").

   A report is a Task assigned to the person the company owner or the super
   admin chose here (SupportCard, Users -> Security & Settings), else the
   owner, else an active CEO. The reporter sees it in their own Tasks. What
   is attached: the tab, the portal version and the last refused request's
   status, code and route - never a body, a message or a password. The
   worker (POST /staff/support/report) decides everything. */

import { type ReactNode, useEffect, useState } from "react";
import { AppIcon } from "@/components/ui/app-icon";
import { SideDrawer } from "@/components/ui/side-drawer";
import { SkelRows } from "@/components/ui/skeleton";
import { useSaveToast } from "@/components/ui/save-toast";
import { L } from "@/components/portal/page-shared";
import { roleLabel } from "@/components/portal/users-shared";
import { api, lastApiError } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import { btnClass, btnSm, card, selectClassSm, textareaClass } from "@/lib/ui-styles";
import ap from "./access-policy.module.css";
import css from "./support-card.module.css";

interface Settings {
  assignee: { id: number; name: string } | null;
  can_edit: boolean;
  people: { id: number; name: string; role: string }[];
  kinds: Record<string, string>;
}
const KIND_MS: Record<string, string> = {
  login: "Masalah log masuk", access: "Akses tiada", data: "Data salah",
  clock: "Gagal daftar masuk", quotation: "Ralat sebut harga", system: "Ralat sistem",
};
/* the same rule the worker refuses on - said before sending, not after */
const SECRETISH = /\b(password|kata laluan|passcode|pin)\s*[:=]/i;

function useSupport(enabled: boolean, tick: number) {
  const [got, setGot] = useState<{ d: Settings | null; e: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    void api<Settings>("/staff/support/settings", { signal: c.signal }).then((r) => {
      if (!c.signal.aborted) setGot({ d: r.ok && r.data ? r.data : null, e: r.ok ? "" : L("Problem reports need the latest server.", "Laporan masalah memerlukan pelayan terkini.") });
    });
    return () => c.abort();
  }, [enabled, tick]);
  return got;
}

/** Users -> Security & Settings: who receives problem reports. */
export function SupportCard() {
  const [tick, setTick] = useState(0);
  const s = useSupport(true, tick);
  const { show: toast, node: toastNode } = useSaveToast();
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = s?.d ?? null;
  const chosen = pick || d?.assignee?.id || 0;

  const save = async () => {
    setBusy(true); setError("");
    const r = await api<{ error?: { message?: string } }>("/staff/support/settings", { method: "POST", body: JSON.stringify({ user_id: chosen }) });
    setBusy(false);
    if (r.ok) { toast(L("Saved", "Disimpan"), L("Problem reports go to the new person", "Laporan masalah pergi kepada orang baharu")); setPick(0); setTick((n) => n + 1); }
    else setError(r.data?.error?.message ?? L("The server refused the change.", "Pelayan menolak perubahan."));
  };

  return (
    <section className={card} aria-label={L("Problem reports", "Laporan masalah")}>
      {toastNode}
      <div className={ap.head}>
        <div>
          <h3 className={ap.title}>{L("Problem reports", "Laporan masalah")}</h3>
          <p className={ap.sub}>{L("Report a problem on the Desk becomes a task for this person - login trouble, missing access, wrong data, a clock-in that failed. A report never carries a password.", "Laporkan masalah di Meja menjadi tugasan untuk orang ini - masalah log masuk, akses tiada, data salah, daftar masuk yang gagal. Laporan tidak pernah membawa kata laluan.")}</p>
        </div>
      </div>
      {s?.e ? <p role="alert" className={ap.error}>{s.e}</p> : !d ? <SkelRows rows={1} /> : (
        <>
          <p className={css.who}>
            {d.assignee
              ? <><AppIcon name="person" /><span>{L("Reports go to", "Laporan pergi kepada")} <strong>{d.assignee.name}</strong></span></>
              : <><AppIcon name="warning" /><span>{L("Nobody receives reports yet - choose someone below.", "Tiada siapa menerima laporan lagi - pilih seseorang di bawah.")}</span></>}
          </p>
          {d.can_edit && (
            <fieldset className={ap.form} disabled={busy}>
              <div className={ap.formRow}>
                <label>{L("Send reports to", "Hantar laporan kepada")}
                  <select className={selectClassSm} value={chosen} onChange={(e) => setPick(Number(e.target.value))}>
                    {!chosen && <option value={0}>{L("Choose a person", "Pilih seseorang")}</option>}
                    {d.people.map((p) => <option key={p.id} value={p.id}>{p.name} - {roleLabel(p.role)}</option>)}
                  </select>
                </label>
                <button type="button" className={btnClass} disabled={!chosen || chosen === d.assignee?.id} onClick={() => void save()}>
                  <AppIcon name="save" />{L("Save", "Simpan")}
                </button>
              </div>
              {error && <p role="alert" className={ap.error}>{error}</p>}
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}

/** The Desk's "Report a problem" button and its sheet. */
export function ReportProblem({ tab, trigger }: { tab: string; trigger?: (open: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const s = useSupport(open, 0);
  const { show: toast, node: toastNode } = useSaveToast();
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ task: number; to: string } | null>(null);
  const kinds = s?.d?.kinds ?? {};
  const secret = SECRETISH.test(text);
  const close = () => { setOpen(false); setError(""); setDone(null); };

  const send = async () => {
    setBusy(true); setError("");
    const context = { tab, version: APP_VERSION, last_error: lastApiError() };
    const r = await api<{ task_id?: number; assigned_to?: string; error?: { message?: string } }>("/staff/support/report", {
      method: "POST", body: JSON.stringify({ kind, description: text.trim(), context }),
    });
    setBusy(false);
    if (r.ok && r.data?.task_id) {
      setDone({ task: r.data.task_id, to: r.data.assigned_to ?? "" });
      setKind(""); setText("");
      toast(L("Sent", "Dihantar"), L("Your report is a task now", "Laporan anda kini satu tugasan"));
    } else setError(r.data?.error?.message ?? (r.status === 0 ? L("No connection - nothing was sent. Try again when you are online.", "Tiada sambungan - tiada apa dihantar. Cuba lagi apabila dalam talian.") : L("The report was not sent.", "Laporan tidak dihantar.")));
  };

  return (
    <>
      {toastNode}
      {trigger ? trigger(() => setOpen(true)) : <button type="button" className={btnSm} onClick={() => setOpen(true)}><AppIcon name="fix" />{L("Report a problem", "Laporkan masalah")}</button>}
      <SideDrawer open={open} onClose={close} title={L("Report a problem", "Laporkan masalah")}
        subtitle={L("It becomes a task for the person who looks after the portal", "Ia menjadi tugasan untuk orang yang menjaga portal")}>
        {!s ? <SkelRows rows={3} /> : s.e ? <p role="alert" className={ap.error}>{s.e}</p> : done ? (
          <div className={css.done} role="status">
            <AppIcon name="success" />
            <p>{L(`Sent as task #${done.task}${done.to ? ` to ${done.to}` : ""}. You will see it in your Tasks.`, `Dihantar sebagai tugasan #${done.task}${done.to ? ` kepada ${done.to}` : ""}. Anda akan melihatnya dalam Tugasan anda.`)}</p>
            <button type="button" className={btnSm} onClick={() => setDone(null)}>{L("Report another", "Laporkan lagi")}</button>
          </div>
        ) : (
          <fieldset className={css.form} disabled={busy}>
            <label>{L("What kind of problem?", "Jenis masalah?")}
              <select className={selectClassSm} value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">{L("Choose one", "Pilih satu")}</option>
                {Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{L(v, KIND_MS[k] ?? v)}</option>)}
              </select>
            </label>
            <label>{L("What happened?", "Apa yang berlaku?")}
              <textarea className={textareaClass} rows={5} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={L("What you were doing, what you expected, what you saw instead", "Apa yang anda lakukan, apa yang dijangka, apa yang anda lihat")} />
            </label>
            <p className={secret ? css.warn : css.note}>
              <AppIcon name={secret ? "warning" : "lock"} />
              {secret
                ? L("Take the password out - nobody needs it to help you, and the report would be refused.", "Keluarkan kata laluan - tiada siapa memerlukannya untuk membantu anda, dan laporan akan ditolak.")
                : L("Never write a password, an authenticator code or a backup code here.", "Jangan sekali-kali tulis kata laluan, kod pengesah atau kod sandaran di sini.")}
            </p>
            <p className={css.note}><AppIcon name="info" />{L(`Sent with it: this tab (${tab}), portal ${APP_VERSION}${lastApiError() ? `, the last refused request (${lastApiError()})` : ""}.`, `Dihantar bersama: tab ini (${tab}), portal ${APP_VERSION}${lastApiError() ? `, permintaan terakhir yang ditolak (${lastApiError()})` : ""}.`)}</p>
            {error && <p role="alert" className={ap.error}>{error}</p>}
            <div className={css.actions}>
              <button type="button" className={btnClass} disabled={!kind || text.trim().length < 10 || secret} onClick={() => void send()}>
                <AppIcon name="next" />{busy ? L("Sending…", "Menghantar…") : L("Send report", "Hantar laporan")}
              </button>
            </div>
          </fieldset>
        )}
      </SideDrawer>
    </>
  );
}
