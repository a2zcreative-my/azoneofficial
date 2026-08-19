"use client";

/* v1.9.1 — office geofence settings (Users tab, super_admin/ceo/coo).
   Sets the point + radius that clock in/out must happen inside. The easy
   path is the "Use my current location" button, tapped while standing at
   the office; coordinates can also be typed (Google Maps → right-click →
   copy "lat, lng"). Clearing the fence returns punches to trust-based. */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { SITE_CONFIG } from "@/constants/site";
import { btnClass, btnGhost, card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);

const api = makeApi("/staff");

interface FenceInfo {
  configured: boolean;
  can_edit?: boolean;
  lat?: number;
  lng?: number;
  radius_m?: number;
  label?: string;
}

export function GeofenceCard() {
  const [info, setInfo] = useState<FenceInfo | null>(null);
  /* v1.16.1: the fields START at HQ (constants/site.ts), so switching the
     fence on is: open the card, press Save. A saved fence still wins — load()
     overwrites these with whatever is configured. Deliberately NOT seeded by
     migration: a system_meta row IS the enforcement switch, and a deploy
     must never silently start refusing punches for every member of staff. */
  const [lat, setLat] = useState(String(SITE_CONFIG.office.lat));
  const [lng, setLng] = useState(String(SITE_CONFIG.office.lng));
  const [radius, setRadius] = useState(String(SITE_CONFIG.office.radiusM));
  const [label, setLabel] = useState<string>(SITE_CONFIG.office.label); // <string>: SITE_CONFIG is as-const, the literal type would reject edits
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api<FenceInfo>(`/attendance/geofence`).then((r) => {
      if (!r.ok || !r.data) return;
      setInfo(r.data);
      if (r.data.configured) {
        if (typeof r.data.lat === "number") setLat(String(r.data.lat));
        if (typeof r.data.lng === "number") setLng(String(r.data.lng));
        if (typeof r.data.radius_m === "number") setRadius(String(r.data.radius_m));
        if (r.data.label) setLabel(r.data.label);
      }
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  const useHq = () => {
    setLat(String(SITE_CONFIG.office.lat));
    setLng(String(SITE_CONFIG.office.lng));
    setLabel(SITE_CONFIG.office.label);
    setMsg({ text: L(`Filled with ${SITE_CONFIG.office.label} — press Save to switch the fence on.`, `Diisi dengan ${SITE_CONFIG.office.label} — tekan Simpan untuk mengaktifkan sempadan.`), ok: true });
  };

  const useMyLocation = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setMsg({ text: L("This browser has no location support — type the coordinates instead.", "Pelayar ini tiada sokongan lokasi — taip koordinat secara manual."), ok: false });
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setBusy(false);
        setMsg({ text: L(`Got it (±${Math.round(p.coords.accuracy)} m). Stand at the office when you do this, then Save.`, `Berjaya (±${Math.round(p.coords.accuracy)} m). Pastikan anda berada di pejabat semasa melakukannya, kemudian tekan Simpan.`), ok: true });
      },
      () => {
        setBusy(false);
        setMsg({ text: L("Location refused — allow location access, or type the coordinates from Google Maps.", "Akses lokasi ditolak — benarkan akses lokasi, atau taip koordinat daripada Google Maps."), ok: false });
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const save = async () => {
    /* Review fix: NaN serialises to JSON null and Number(null) is 0 — an
       unvalidated save could have stored a fence at 0°,0° and locked the
       whole company out of punching. Validate BEFORE sending (the server
       double-checks with typeof). */
    const nLat = Number(lat.trim());
    const nLng = Number(lng.trim());
    const nRadius = Number(radius.trim());
    if (!Number.isFinite(nLat) || nLat < -90 || nLat > 90 || !Number.isFinite(nLng) || nLng < -180 || nLng > 180) {
      setMsg({ text: L("Latitude/longitude don't look like coordinates — use 'Use my current location', or paste \"lat, lng\" from Google Maps into the Latitude box.", "Latitud/longitud tidak kelihatan seperti koordinat — guna 'Guna lokasi semasa saya', atau tampal \"lat, lng\" daripada Google Maps ke dalam kotak Latitud."), ok: false });
      return;
    }
    if (!Number.isFinite(nRadius) || nRadius < 20 || nRadius > 2000) {
      setMsg({ text: L("Radius must be 20–2000 metres.", "Radius mesti antara 20–2000 meter."), ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await api<{ ok?: boolean; error?: { message?: string } }>(`/attendance/geofence`, {
      method: "POST",
      body: JSON.stringify({ lat: nLat, lng: nLng, radius_m: nRadius, label }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ text: L("Saved — clock in/out now requires being inside this radius.", "Disimpan — daftar masuk/keluar kini mesti dilakukan dalam radius ini."), ok: true });
      load();
    } else {
      setMsg({ text: res.data?.error?.message ?? L("Save failed — check the values.", "Simpan gagal — semak nilai."), ok: false });
    }
  };

  const clear = async () => {
    if (!window.confirm(L("Turn office check-in OFF? Staff will be able to clock in/out from anywhere again.", "Matikan daftar kehadiran pejabat? Kakitangan akan boleh daftar masuk/keluar dari mana-mana sahaja semula."))) return;
    setBusy(true);
    const res = await api<{ ok?: boolean }>(`/attendance/geofence`, {
      method: "POST",
      body: JSON.stringify({ clear: true }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ text: L("Office check-in is off.", "Daftar kehadiran pejabat telah dimatikan."), ok: true });
      setInfo({ configured: false, can_edit: true });
    } else {
      setMsg({ text: L("Could not turn it off — check your access and try again.", "Tidak dapat dimatikan — semak akses anda dan cuba lagi."), ok: false });
    }
  };

  return (
    <div className={card}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{L("📍 Office check-in (geofence)", "📍 Daftar kehadiran pejabat (geofence)")}</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${info?.configured
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "bg-secondary text-muted-foreground"}`}>
          {info?.configured ? "ON" : "OFF"}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        {L("When on, staff can only clock in/out — and record OT in/out — within the radius below. Positions come from the phone's GPS: good enough to stop clocking in from home, but not tamper-proof; the IP address stored on every punch is the cross-check. 100–200 m is a realistic radius (GPS inside a building drifts).",
          "Apabila diaktifkan, kakitangan hanya boleh daftar masuk/keluar — dan rekod OT masuk/keluar — dalam radius di bawah. Kedudukan diambil daripada GPS telefon: cukup untuk menghalang daftar masuk dari rumah, tetapi tidak kalis pengubahan; alamat IP yang disimpan pada setiap rekod ialah semakan silang. 100–200 m ialah radius yang realistik (GPS di dalam bangunan boleh melencong).")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{L("Latitude", "Latitud")}</span>
          <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" inputMode="decimal"
            placeholder="1.4927" value={lat}
            onChange={(e) => {
              // Pasting "1.4927, 103.7414" straight from Google Maps fills both boxes.
              const pair = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(e.target.value);
              if (pair) { setLat(pair[1] || ""); setLng(pair[2] || ""); } else { setLat(e.target.value); }
            }} />
        </label>
        <label className="block">
          <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">{L("Longitude", "Longitud")}</span>
          <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" inputMode="decimal"
            placeholder="103.7414" value={lng} onChange={(e) => setLng(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Radius (m)</span>
          <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" inputMode="numeric"
            value={radius} onChange={(e) => setRadius(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-muted-foreground mb-0.5 block text-[11px] font-medium">Label</span>
          <input className="border-input bg-background h-9 w-full rounded-lg border px-2 text-sm" maxLength={60}
            value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btnGhost} disabled={busy} onClick={useHq}>
          {L("Use HQ location", "Guna lokasi HQ")}
        </button>
        <button type="button" className={btnGhost} disabled={busy} onClick={useMyLocation}>
          {L("Use my current location", "Guna lokasi semasa saya")}
        </button>
        <button type="button" className={btnClass} disabled={busy || !lat || !lng} onClick={() => void save()}>
          {L("Save", "Simpan")}
        </button>
        {info?.configured && (
          <button type="button" className="text-destructive text-xs underline" disabled={busy} onClick={() => void clear()}>
            {L("Turn off", "Matikan")}
          </button>
        )}
      </div>
      {msg && (
        <p className={`mt-2 text-xs font-medium ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>{msg.text}</p>
      )}
      <p className="text-muted-foreground mt-2 text-[11px]">
        {L("Reminders ride along automatically: staff still clocked in get a bell + push at 6:30 pm (unless they're on OT) and a firmer one at 10 pm. Forgot-to-punch cases from home are fixed with a manual punch (admin → Attendance).",
          "Peringatan berjalan secara automatik: kakitangan yang masih berdaftar masuk menerima loceng + notifikasi tolak pada 6:30 petang (kecuali mereka sedang OT) dan peringatan lebih tegas pada 10 malam. Kes terlupa daftar dari rumah dibetulkan dengan rekod manual (admin → Kehadiran).")}
      </p>
    </div>
  );
}
