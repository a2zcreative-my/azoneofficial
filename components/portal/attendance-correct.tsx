"use client";
/* 19-11-2026 - CORRECT A DAY WHERE YOU READ IT (the CEO: "on attendance & record I should be able
   to perform correction"). The Corrections tab of a person's day (PersonDayDrawer) now carries the
   corrections themselves, for those who hold attendance_correct (CEO, COO, CCO, HR admin, admin):
     - change the time of a punch        PATCH  /staff/attendance/:id     (marked "Amended")
     - remove a wrong punch               DELETE /staff/attendance/:id
     - add a missing clock-in / clock-out POST   /staff/attendance/manual (marked "Manual")
   The SAME routes the Exceptions tab's back-entry uses - nothing new on the server but the reason,
   which every change here asks for and the audit log keeps. The server still refuses a change to
   your own record, a time in the future and a duplicate punch, and re-derives the day (and its
   overtime) after each change. A forgotten punch someone asked for is still decided in Exceptions
   & Approvals. */
import { useState } from "react";
import { L } from "@/components/portal/page-shared";
import { AppIcon } from "@/components/ui/app-icon";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useFeedback } from "@/components/ui/feedback-modal";
import { api } from "@/lib/api";
import { dmy } from "@/lib/format";
import { btnSm, btnSmPrimary, chipSmInfo, chipSmSuccess, inputClassSm, selectClassSm } from "@/lib/ui-styles";
import { addDays, mytHm, type DayPunch } from "./attendance-shared";
import css from "./attendance4.module.css";

/** a stored UTC moment as Malaysia "YYYY-MM-DD" and "HH:MM" */
const myt = (utc: string) => { const d = new Date(Date.parse(`${utc.replace(" ", "T")}Z`) + 8 * 3600 * 1000).toISOString(); return { day: d.slice(0, 10), time: d.slice(11, 16) }; };
const okReason = (r: string) => r.trim().length >= 5;

type Res = { ok: boolean; status: number; data?: { error?: { message?: string } } | null };

export function DayCorrections({ userId, name, day, punches, onChanged }: { userId: number; name: string; day: string; punches: DayPunch[]; onChanged: () => void }) {
  const { confirm, node: confirmNode } = useConfirm();
  const { show: feedback, node: feedbackNode } = useFeedback();
  const [editId, setEditId] = useState<number | null>(null);
  const [removeId, setRemoveId] = useState<number | null>(null);
  const [editDay, setEditDay] = useState(day);
  const [editTime, setEditTime] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [addType, setAddType] = useState<"clock_in" | "clock_out">(punches.some((x) => x.type === "clock_in" && !x.pending) ? "clock_out" : "clock_in");
  const [addDay, setAddDay] = useState(day);
  const [addTime, setAddTime] = useState("");
  const [addWhy, setAddWhy] = useState("");
  const real = punches.filter((x) => !x.pending);
  const word = (t: string) => (t === "clock_in" ? L("Clock in", "Masuk") : L("Clock out", "Keluar"));

  const failed = (title: string, r: Res) => feedback({ variant: "error", title, description: r.data?.error?.message ?? L("The server did not accept the change - nothing was changed.", "Pelayan tidak menerima perubahan - tiada apa diubah.") });
  const done = (title: string, facts: { icon: "date" | "time" | "edit"; label: string; value: string }[]) => {
    feedback({ variant: "success", acknowledge: true, testid: "att-correct-feedback", title, description: name, facts });
    onChanged();
  };

  const startEdit = (x: DayPunch) => { const m = myt(x.at); setRemoveId(null); setEditId(x.id); setEditDay(m.day); setEditTime(m.time); setWhy(""); };
  const startRemove = (x: DayPunch) => { setEditId(null); setRemoveId(x.id); setWhy(""); };
  const saveEdit = async (x: DayPunch) => {
    if (!editTime || !okReason(why) || busy) return;
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/attendance/${x.id}`, { method: "PATCH", body: JSON.stringify({ myt: `${editDay} ${editTime}`, reason: why.trim() }) }) as Res;
    setBusy(false);
    if (!r.ok) { failed(L("Time not changed", "Masa tidak diubah"), r); return; }
    setEditId(null);
    done(L("Punch time corrected", "Masa ketukan dibetulkan"), [
      { icon: "time", label: word(x.type), value: `${mytHm(x.at)} → ${editTime}` },
      { icon: "date", label: L("Day", "Hari"), value: dmy(editDay) },
      { icon: "edit", label: L("Reason", "Sebab"), value: why.trim() },
    ]);
  };
  const remove = async (x: DayPunch) => {
    if (!okReason(why) || busy) return;
    const yes = await confirm({ title: L("Remove this punch?", "Buang ketukan ini?"), message: L(`${word(x.type)} at ${mytHm(x.at)} on ${dmy(day)} is removed from ${name}'s day. The audit log keeps who removed it and why.`, `${word(x.type)} pada ${mytHm(x.at)}, ${dmy(day)} dibuang daripada hari ${name}. Log audit menyimpan siapa dan sebabnya.`), confirmLabel: L("Remove", "Buang"), variant: "danger" });
    if (!yes) return;
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>(`/staff/attendance/${x.id}?reason=${encodeURIComponent(why.trim())}`, { method: "DELETE" }) as Res;
    setBusy(false);
    /* a delete says so, either way (guard action-feedback) */
    if (!r.ok) { feedback({ variant: "error", title: L("Punch not removed", "Ketukan tidak dibuang"), description: r.data?.error?.message ?? L("The server did not accept the change - nothing was changed.", "Pelayan tidak menerima perubahan - tiada apa diubah.") }); return; }
    setRemoveId(null);
    feedback({ variant: "success", acknowledge: true, testid: "att-correct-feedback", title: L("Punch removed", "Ketukan dibuang"), description: name, facts: [
      { icon: "time", label: word(x.type), value: mytHm(x.at) },
      { icon: "edit", label: L("Reason", "Sebab"), value: why.trim() },
    ] });
    onChanged();
  };
  const add = async () => {
    if (!addTime || !okReason(addWhy) || busy) return;
    setBusy(true);
    const r = await api<{ error?: { message?: string } }>("/staff/attendance/manual", { method: "POST", body: JSON.stringify({ user_id: userId, type: addType, myt: `${addDay} ${addTime}`, reason: addWhy.trim() }) }) as Res;
    setBusy(false);
    if (!r.ok) { failed(L("Punch not added", "Ketukan tidak ditambah"), r); return; }
    done(addType === "clock_in" ? L("Clock-in added", "Daftar masuk ditambah") : L("Clock-out added", "Daftar keluar ditambah"), [
      { icon: "date", label: L("Day", "Hari"), value: dmy(addDay) },
      { icon: "time", label: word(addType), value: addTime },
      { icon: "edit", label: L("Reason", "Sebab"), value: addWhy.trim() },
    ]);
    setAddTime(""); setAddWhy("");
  };

  return (
    <div className={css.correct} data-testid="att-correct">
      <p className={css.sectionTitle}>{L("Correct this day", "Betulkan hari ini")}</p>
      {real.length === 0 ? <p className={css.empty}>{L("No punch recorded this day - add one below.", "Tiada ketukan direkod hari ini - tambah di bawah.")}</p> : (
        <ul className={css.list} data-testid="att-correct-punches">
          {real.map((x) => (
            <li key={x.id} className={css.correctRow}>
              {editId === x.id ? (
                <div className={css.correctForm}>
                  <strong>{L(`Change the ${x.type === "clock_in" ? "clock-in" : "clock-out"} (now ${mytHm(x.at)})`, `Ubah ${x.type === "clock_in" ? "daftar masuk" : "daftar keluar"} (kini ${mytHm(x.at)})`)}</strong>
                  <span className={css.correctFields}>
                    <input type="date" className={inputClassSm} value={editDay} min={addDays(day, -1)} max={addDays(day, 1)} onChange={(e) => setEditDay(e.target.value)} aria-label={L("Day", "Hari")} />
                    <input type="time" className={inputClassSm} value={editTime} onChange={(e) => setEditTime(e.target.value)} aria-label={L("Time", "Masa")} data-testid="att-edit-time" />
                  </span>
                  <input className={inputClassSm} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={L("Reason (e.g. phone had no signal, clocked in at 09:02)", "Sebab (cth. telefon tiada isyarat, masuk 09:02)")} aria-label={L("Reason", "Sebab")} data-testid="att-edit-why" />
                  <span className={css.correctActions}>
                    <button type="button" className={btnSm} onClick={() => setEditId(null)}>{L("Cancel", "Batal")}</button>
                    <button type="button" className={btnSmPrimary} disabled={busy || !editTime || !okReason(why)} onClick={() => void saveEdit(x)} data-testid="att-edit-save">{L("Save time", "Simpan masa")}</button>
                  </span>
                </div>
              ) : removeId === x.id ? (
                <div className={css.correctForm}>
                  <strong>{L(`Remove the ${x.type === "clock_in" ? "clock-in" : "clock-out"} at ${mytHm(x.at)}`, `Buang ${x.type === "clock_in" ? "daftar masuk" : "daftar keluar"} pada ${mytHm(x.at)}`)}</strong>
                  <input className={inputClassSm} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={L("Reason (e.g. punched twice by mistake)", "Sebab (cth. tertekan dua kali)")} aria-label={L("Reason", "Sebab")} data-testid="att-remove-why" />
                  <span className={css.correctActions}>
                    <button type="button" className={btnSm} onClick={() => setRemoveId(null)}>{L("Cancel", "Batal")}</button>
                    <button type="button" className="erp-button erp-button-danger erp-button-compact" disabled={busy || !okReason(why)} onClick={() => void remove(x)} data-testid="att-remove-save">{L("Remove punch", "Buang ketukan")}</button>
                  </span>
                </div>
              ) : (
                <>
                  <span className={css.listText}>
                    <strong>{mytHm(x.at)} · {word(x.type)}</strong>
                    <span className={x.source === "punch" ? chipSmSuccess : chipSmInfo}>{x.source === "manual" ? L("Manual", "Manual") : x.source === "amended" ? L("Amended", "Dipinda") : L("From On Shift", "Dari On Shift")}</span>
                  </span>
                  <span className={css.correctActions}>
                    <button type="button" className={btnSm} disabled={busy} onClick={() => startEdit(x)} data-testid={`att-edit-${x.id}`}><AppIcon name="edit" />{L("Change time", "Ubah masa")}</button>
                    <button type="button" className={btnSm} disabled={busy} onClick={() => startRemove(x)} data-testid={`att-remove-${x.id}`}>{L("Remove", "Buang")}</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={css.correctForm} data-testid="att-add">
        <strong>{L("Add a missing punch", "Tambah ketukan yang tiada")}</strong>
        <span className={css.correctFields}>
          <select className={selectClassSm} value={addType} onChange={(e) => setAddType(e.target.value as "clock_in" | "clock_out")} aria-label={L("Punch", "Ketukan")} data-testid="att-add-type">
            <option value="clock_in">{L("Clock in", "Masuk")}</option>
            <option value="clock_out">{L("Clock out", "Keluar")}</option>
          </select>
          <input type="date" className={inputClassSm} value={addDay} min={day} max={addDays(day, 1)} onChange={(e) => setAddDay(e.target.value)} aria-label={L("Day", "Hari")} />
          <input type="time" className={inputClassSm} value={addTime} onChange={(e) => setAddTime(e.target.value)} aria-label={L("Time", "Masa")} data-testid="att-add-time" />
        </span>
        <input className={inputClassSm} value={addWhy} onChange={(e) => setAddWhy(e.target.value)} placeholder={L("Reason (e.g. forgot to clock out, left at 17:10)", "Sebab (cth. terlupa daftar keluar, keluar 17:10)")} aria-label={L("Reason", "Sebab")} data-testid="att-add-why" />
        <span className={css.correctActions}>
          <span className={css.sub}>{L("A clock-out after midnight goes on the next day's date.", "Daftar keluar selepas tengah malam guna tarikh hari berikutnya.")}</span>
          <button type="button" className={btnSmPrimary} disabled={busy || !addTime || !okReason(addWhy)} onClick={() => void add()} data-testid="att-add-save"><AppIcon name="add" />{L("Add punch", "Tambah ketukan")}</button>
        </span>
      </div>
      <p className={css.sub}>{L("Every change needs a reason, is marked on the punch and kept in the Audit Log; the day's hours and overtime are worked out again.", "Setiap perubahan perlukan sebab, ditanda pada ketukan dan disimpan dalam Log Audit; jam dan OT hari itu dikira semula.")}</p>
      {confirmNode}{feedbackNode}
    </div>
  );
}
