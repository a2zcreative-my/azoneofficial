"use client";

/* v1.226.0 - SHIFT REMINDERS on Profile (the owner's Shift Reminders brief,
   30-10-2026, and his answer "add the switches"). Two switches of the
   person's own - Clock-in reminder, Clock-out reminder - and whether THIS
   device receives them. The reminders are sent by the server on its
   five-minute tick (worker/src/shift-reminders-cron.ts), so nothing here
   runs a timer: the phone can be locked and the app closed. A tap on a
   reminder opens On Shift; it never clocks anybody in or out. */

import { useEffect, useState } from "react";
import { usePortal } from "@/components/portal/portal-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { useSaveToast } from "@/components/ui/save-toast";
import { SkelRows } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { getLang } from "@/lib/i18n";
import { devicePushStatus, enablePush, type DevicePush } from "@/lib/push-client";
import { btnSm, card } from "@/lib/ui-styles";
import css from "./shift-reminder-prefs.module.css";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
type Key = "shift_clock_in" | "shift_clock_out";
interface Prefs { prefs: Record<Key, boolean>; devices: number; push_configured: boolean }

export function ShiftReminderPrefs() {
  const { setPushState } = usePortal();
  const [data, setData] = useState<Prefs | null>(null);
  const [missing, setMissing] = useState(false);
  const [device, setDevice] = useState<DevicePush | null>(null);
  const [busy, setBusy] = useState<Key | "device" | null>(null);
  const { show: showToast, node: toastNode } = useSaveToast();

  useEffect(() => {
    let alive = true;
    void api<Prefs>("/staff/notification-prefs").then((r) => {
      if (!alive) return;
      if (r.ok && r.data?.prefs) setData(r.data); else setMissing(true);
    });
    void devicePushStatus().then((d) => { if (alive) setDevice(d); });
    return () => { alive = false; };
  }, []);

  const flip = async (key: Key) => {
    if (!data || busy) return;
    const next = !data.prefs[key];
    setBusy(key);
    setData({ ...data, prefs: { ...data.prefs, [key]: next } });
    const r = await api<Prefs>("/staff/notification-prefs", { method: "PUT", body: JSON.stringify({ key, enabled: next }) });
    setBusy(null);
    if (r.ok) {
      if (r.data?.prefs) setData(r.data);
      showToast(L("Saved", "Disimpan"), next ? L("Reminder on", "Peringatan hidup") : L("Reminder off", "Peringatan mati"));
    } else {
      setData((d) => (d ? { ...d, prefs: { ...d.prefs, [key]: !next } } : d));
      showToast(L("Not saved", "Tidak disimpan"), L("Try again", "Cuba lagi"), "notice");
    }
  };

  const turnOn = async () => {
    setBusy("device");
    const r = await enablePush();
    setBusy(null);
    if (r === "ok") {
      setDevice("on"); setPushState("granted");
      showToast(L("Notifications on", "Pemberitahuan hidup"), L("This device will get your shift reminders", "Peranti ini akan menerima peringatan syif anda"));
    } else if (r === "denied") {
      setDevice("denied");
      showToast(L("Blocked", "Disekat"), L("Notifications are blocked for this site in this browser's settings", "Pemberitahuan disekat untuk laman ini dalam tetapan pelayar"), "notice");
    } else {
      showToast(L("Not turned on", "Tidak dihidupkan"), r === "unconfigured" ? L("Push is not set up on the server yet", "Push belum disediakan di pelayan") : L("Try again", "Cuba lagi"), "notice");
    }
  };

  const rows: [Key, string, string][] = [
    ["shift_clock_in", L("Clock-in reminder", "Peringatan masuk kerja"), L("15 minutes before each shift starts, unless you have already clocked in.", "15 minit sebelum setiap syif bermula, kecuali anda sudah clock in.")],
    ["shift_clock_out", L("Clock-out reminder", "Peringatan keluar kerja"), L("15 minutes before your shift ends, and when it ends - only while you are clocked in.", "15 minit sebelum syif tamat, dan semasa ia tamat - hanya semasa anda masih clock in.")],
  ];

  const deviceLine: Record<DevicePush, string> = {
    on: L("On for this device.", "Hidup untuk peranti ini."),
    off: L("Off on this device - reminders still appear in the bell.", "Mati pada peranti ini - peringatan masih muncul di loceng."),
    denied: L("Blocked for this site in this browser's settings. Allow notifications there, then come back.", "Disekat untuk laman ini dalam tetapan pelayar. Benarkan pemberitahuan di sana, kemudian kembali."),
    unsupported: L("This browser cannot receive notifications. On iPhone: open this site in Safari, tap Share → Add to Home Screen, open A2Z from the Home Screen, then turn notifications on here.", "Pelayar ini tidak boleh menerima pemberitahuan. Di iPhone: buka laman ini dalam Safari, tekan Kongsi → Tambah ke Skrin Utama, buka A2Z dari Skrin Utama, kemudian hidupkan pemberitahuan di sini."),
  };

  if (missing) return null;
  return (
    <section className={`${card} ${css.card}`} aria-label={L("Shift reminders", "Peringatan syif")}>
      {toastNode}
      <div>
        <p className={css.title}><AppIcon name="time" /> {L("Shift reminders", "Peringatan syif")}</p>
        <p className={css.meta}>{L("Sent by A2Z to your devices - the app does not need to be open. A tap opens On Shift; you still clock in and out yourself.", "Dihantar oleh A2Z ke peranti anda - aplikasi tidak perlu dibuka. Tekan untuk membuka Dalam Syif; anda masih clock in dan clock out sendiri.")}</p>
      </div>
      {!data ? <SkelRows rows={2} /> : (
        <ul className={css.list}>
          {rows.map(([key, label, hint]) => (
            <li key={key} className={css.row}>
              <label className={css.label} htmlFor={`pref-${key}`}>
                <span className={css.name}>{label}</span>
                <span className={css.hint}>{hint}</span>
              </label>
              <input id={`pref-${key}`} type="checkbox" role="switch" className={css.switch}
                checked={data.prefs[key]} disabled={busy === key} aria-checked={data.prefs[key]}
                onChange={() => void flip(key)} />
            </li>
          ))}
        </ul>
      )}
      <div className={css.device}>
        <p className={css.deviceText}>
          <span className={device === "on" ? css.dotOn : css.dotOff} aria-hidden />
          <span><strong>{L("This device", "Peranti ini")}:</strong> {device ? deviceLine[device] : "…"}</span>
        </p>
        {device === "off" && (
          <button type="button" className={btnSm} disabled={busy === "device"} onClick={() => void turnOn()}>
            {L("Turn on for this device", "Hidupkan untuk peranti ini")}
          </button>
        )}
      </div>
      <p className={css.meta}>{L("Arrival time depends on your phone, its settings and the network.", "Masa tiba bergantung pada telefon anda, tetapannya dan rangkaian.")}</p>
    </section>
  );
}
