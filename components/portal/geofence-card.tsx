"use client";

/* v1.9.1 — office geofence settings (Users tab, super_admin/ceo/coo).
   Sets the point + radius that clock in/out must happen inside. The easy
   path is the "Use my current location" button, tapped while standing at
   the office; coordinates can also be typed (Google Maps → right-click →
   copy "lat, lng"). Clearing the fence returns punches to trust-based. */

import { useCallback, useEffect, useState } from "react";
import { makeApi } from "@/lib/api";
import { SITE_CONFIG } from "@/constants/site";
import { btnClass, btnGhost, btnSm, chipSmNeutral, chipSmSuccess, chipSmWarn, fieldLabel, inputClass, listBox } from "@/lib/ui-styles";
import { SkelRows } from "@/components/ui/skeleton";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile"; // v1.344.0
import { SplitColumn, SplitPane, WorkspaceSplit } from "@/components/ui/workspace-split"; // v1.344.0
import { api as rootApi } from "@/lib/api"; // v1.344.0 - the audit read lives outside /staff
import css from "./geofence-card.module.css"; // v1.344.0
import { getLang } from "@/lib/i18n";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { AppIcon, type AppIconName } from "@/components/ui/app-icon";

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

/* v1.344.0 (image 05, the CEO 17-11-2026) - OFFICE LOCATION, one page: a
   strip of four (the fence, its radius, the location rule, the last change),
   then the fence form over the attendance location rules (left) and the map
   of the saved fence over its change history (right). The form, its checks
   and the save/turn-off calls are exactly what they were. The rules are
   worded from the server's own (staff.ts gateGeofence, punch-location.ts):
   a position is required on every punch; outside the radius plus the phone's
   accuracy (up to 150 m) the punch is RECORDED and flagged, never refused;
   CEO/COO/CCO are not flagged. The map is OpenStreetMap tiles around the
   saved point with the radius drawn to scale; the history is the audit log
   (attendance.geofence_set / _clear). */
interface FenceAudit { id: number; action: string; created_at: string; user_name: string | null; detail: string | null }
const stampMyt = (s: string) => { const t = Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`); if (!Number.isFinite(t)) return "—"; const d = new Date(t + 8 * 3600_000); return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

/** OpenStreetMap tiles around a point, the radius drawn to scale (no script, no key) */
function FenceMap({ lat, lng, radius, label }: { lat: number; lng: number; radius: number; label: string }) {
  const cos = Math.cos((lat * Math.PI) / 180);
  const z = Math.max(12, Math.min(18, Math.floor(Math.log2((156543.03392 * cos * 70) / Math.max(20, radius)))));
  const scale = 256 * 2 ** z;
  const px = ((lng + 180) / 360) * scale;
  const latR = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * scale;
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const rPx = radius / ((156543.03392 * cos) / 2 ** z);
  const tiles: { x: number; y: number }[] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) tiles.push({ x: tx + dx, y: ty + dy });
  const n = 2 ** z;
  return (
    <div className={css.map} role="img" aria-label={L(`Map: ${label}, radius ${radius} m`, `Peta: ${label}, radius ${radius} m`)} data-testid="fence-map">
      {tiles.filter((t) => t.y >= 0 && t.y < n).map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={`${t.x}/${t.y}`} alt="" className={css.tile} loading="lazy" draggable={false}
          src={`https://tile.openstreetmap.org/${z}/${((t.x % n) + n) % n}/${t.y}.png`}
          style={{ left: `calc(50% + ${Math.round(t.x * 256 - px)}px)`, top: `calc(50% + ${Math.round(t.y * 256 - py)}px)` }} />
      ))}
      <span className={css.circle} style={{ width: `${Math.round(rPx * 2)}px`, height: `${Math.round(rPx * 2)}px` }} aria-hidden />
      <span className={css.pin} aria-hidden />
      <span className={css.attrib}>© OpenStreetMap</span>
    </div>
  );
}

export function GeofenceCard({ onAudit }: { onAudit?: () => void }) {
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
  const { confirm, node: confirmNode } = useConfirm();
  /* v1.77.0 — skeleton until the first fetch lands. `info` stays null on a
     failed load too, so a separate flag clears the skeleton either way. */
  const [loaded, setLoaded] = useState(false);

  const [history, setHistory] = useState<FenceAudit[] | "denied" | null>(null);
  const loadHistory = useCallback(() => {
    void rootApi<{ entries: FenceAudit[] }>("/audit?action=attendance.geofence&limit=10").then((r) => setHistory(r.ok && r.data ? r.data.entries : "denied"));
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);
  const load = useCallback(() => {
    void api<FenceInfo>(`/attendance/geofence`).then((r) => {
      setLoaded(true);
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
      setMsg({ text: L("Saved — punches outside this radius are now flagged as outside the office.", "Disimpan — daftar di luar radius ini kini ditanda sebagai di luar pejabat."), ok: true });
      load(); loadHistory();
    } else {
      setMsg({ text: res.data?.error?.message ?? L("Save failed — check the values.", "Simpan gagal — semak nilai."), ok: false });
    }
  };

  const clear = async () => {
    /* v1.62.0 — the last of the browser's own dialogs in the portal. Turning
       the geofence off is exactly the kind of decision that deserves the
       branded box rather than a grey Chrome one. */
    if (!(await confirm({
      title: L("Turn office check-in OFF?", "Matikan daftar kehadiran pejabat?"),
      message: L("Staff will be able to clock in and out from anywhere again.",
                 "Kakitangan akan boleh daftar masuk dan keluar dari mana-mana sahaja semula."),
      confirmLabel: L("Turn it off", "Matikan"),
      cancelLabel: L("Keep it on", "Kekalkan"),
      variant: "danger",
    }))) return;
    setBusy(true);
    const res = await api<{ ok?: boolean }>(`/attendance/geofence`, {
      method: "POST",
      body: JSON.stringify({ clear: true }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ text: L("Office check-in is off.", "Daftar kehadiran pejabat telah dimatikan."), ok: true });
      setInfo({ configured: false, can_edit: true }); loadHistory();
    } else {
      setMsg({ text: L("Could not turn it off — check your access and try again.", "Tidak dapat dimatikan — semak akses anda dan cuba lagi."), ok: false });
    }
  };

  const nLat = Number(lat), nLng = Number(lng), nRad = Number(radius);
  const valid = Number.isFinite(nLat) && Math.abs(nLat) <= 90 && Number.isFinite(nLng) && Math.abs(nLng) <= 180 && Number.isFinite(nRad) && nRad >= 20 && nRad <= 2000;
  const saved = info?.configured && typeof info.lat === "number" && typeof info.lng === "number" && typeof info.radius_m === "number";
  const unsaved = !!saved && valid && (nLat !== info!.lat || nLng !== info!.lng || nRad !== info!.radius_m);
  const last = Array.isArray(history) ? history[0] ?? null : null;
  const rule = (icon: AppIconName, title: string, sub: string, chip: React.ReactNode, testid: string) => (
    <li data-testid={testid}><span className={css.rowIcon} aria-hidden><AppIcon name={icon} /></span>
      <span className={css.rowText}><strong>{title}</strong><small>{sub}</small></span>{chip}</li>
  );
  return (
    <div className={css.page} data-testid="office-location">
      {confirmNode}
      <KpiRow label={L("Office location figures", "Angka lokasi pejabat")} testid="location-strip">
        <KpiTile icon="place" tone={info?.configured ? "green" : "gold"} label={L("Office Location", "Lokasi Pejabat")} busy={!loaded} testid="tile-office"
          value={info?.configured ? L("Configured", "Ditetapkan") : L("Off", "Mati")} sub={info?.configured ? (info.label ?? label) : L("Punches are not checked against an office", "Daftar tidak disemak terhadap pejabat")} />
        <KpiTile icon="target" tone="blue" label={L("Geofence Radius", "Radius Geofence")} busy={!loaded} testid="tile-radius"
          value={info?.configured && typeof info.radius_m === "number" ? `${info.radius_m} m` : "—"} sub={L("Plus the phone's accuracy, up to 150 m", "Tambah ketepatan telefon, sehingga 150 m")} />
        <KpiTile icon="verify" tone="green" label={L("GPS Verification", "Pengesahan GPS")} testid="tile-gps"
          value={L("Required", "Diwajibkan")} sub={L("A position on every punch", "Kedudukan pada setiap daftar")} />
        <KpiTile icon="time" tone="purple" label={L("Last Updated", "Kemas Kini Terakhir")} busy={history === null} testid="tile-updated"
          value={history === "denied" ? "—" : last ? stampMyt(last.created_at).slice(0, 10) : L("Not recorded", "Tidak direkodkan")}
          sub={history === "denied" ? L("Audit History is for the CEO and admins", "Sejarah Audit untuk CEO dan pentadbir") : last ? `${last.action.endsWith("_clear") ? L("Turned off", "Dimatikan") : L("Set", "Ditetapkan")}${last.user_name ? ` · ${last.user_name}` : ""}` : L("No change in the audit log", "Tiada perubahan dalam log audit")} />
      </KpiRow>
      <WorkspaceSplit testid="location-split" ratio="50-50">
        <SplitColumn>
          <SplitPane fit testid="fence-form" title={L("Office Location & Geofence", "Lokasi Pejabat & Geofence")} sub={L("The point and radius On Shift checks every punch against", "Titik dan radius yang On Shift semak bagi setiap daftar")} label={L("Office location and geofence", "Lokasi pejabat dan geofence")}
            actions={!loaded ? undefined : <span className={info?.configured ? chipSmSuccess : chipSmNeutral}>{info?.configured ? L("On", "Hidup") : L("Off", "Mati")}</span>}>
            {!loaded ? <SkelRows rows={4} /> : (
              <div className={css.form}>
                <label className={`${css.field} ${css.wide}`}>
                  <span className={fieldLabel}>{L("Office name", "Nama pejabat")}</span>
                  <input className={inputClass} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
                <label className={css.field}>
                  <span className={fieldLabel}>{L("Latitude", "Latitud")}</span>
                  <input className={inputClass} inputMode="decimal" placeholder="1.4927" value={lat}
                    onChange={(e) => {
                      // Pasting "1.4927, 103.7414" straight from Google Maps fills both boxes.
                      const pair = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(e.target.value);
                      if (pair) { setLat(pair[1] || ""); setLng(pair[2] || ""); } else { setLat(e.target.value); }
                    }} />
                </label>
                <label className={css.field}>
                  <span className={fieldLabel}>{L("Longitude", "Longitud")}</span>
                  <input className={inputClass} inputMode="decimal" placeholder="103.7414" value={lng} onChange={(e) => setLng(e.target.value)} />
                </label>
                <label className={`${css.field} ${css.wide}`}>
                  <span className={fieldLabel}>{L("Geofence radius (metres, 20 to 2000)", "Radius geofence (meter, 20 hingga 2000)")}</span>
                  <input className={inputClass} inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value)} />
                </label>
                <div className={`${css.actions} ${css.wide}`}>
                  <button type="button" className={btnClass} disabled={busy || !lat || !lng} onClick={() => void save()} data-testid="fence-save">{L("Save location", "Simpan lokasi")}</button>
                  <button type="button" className={btnGhost} disabled={busy} onClick={useMyLocation}>{L("Use current location", "Guna lokasi semasa")}</button>
                  <button type="button" className={btnGhost} disabled={busy} onClick={useHq}>{L("Use HQ location", "Guna lokasi HQ")}</button>
                  {info?.configured && (
                    <button type="button" className={css.danger} disabled={busy} onClick={() => void clear()}>{L("Turn off", "Matikan")}</button>
                  )}
                </div>
                {msg && <p className={`${css.msg} ${css.wide} ${msg.ok ? css.msgOk : css.msgBad}`} role="status">{msg.text}</p>}
              </div>
            )}
          </SplitPane>
          <SplitPane testid="location-rules" title={L("Attendance Location Rules", "Peraturan Lokasi Kehadiran")} sub={L("How the server treats a punch's position - unchanged", "Cara pelayan menilai kedudukan daftar - tidak diubah")} label={L("Attendance location rules", "Peraturan lokasi kehadiran")}>
            <ul className={`${listBox} ${css.rows}`}>
              {rule("place", L("Inside / outside the geofence", "Dalam / luar geofence"), L("Outside = further than the radius plus the phone's accuracy (up to 150 m)", "Luar = lebih jauh daripada radius tambah ketepatan telefon (sehingga 150 m)"), <span className={chipSmNeutral}>{L("Server rule", "Peraturan pelayan")}</span>, "rule-inside")}
              {rule("warning", L("Punches outside the geofence", "Daftar di luar geofence"), L("Recorded and flagged for HR, never refused; CEO, COO and CCO are not flagged", "Direkodkan dan ditanda untuk HR, tidak ditolak; CEO, COO dan CCO tidak ditanda"), <span className={chipSmWarn}>{L("Flagged", "Ditanda")}</span>, "rule-outside")}
              {rule("verify", L("No position", "Tiada kedudukan"), L("Refused, unless the phone says why (denied, timeout) - then recorded as NO LOCATION", "Ditolak, kecuali telefon memberi sebab (ditolak, tamat masa) - kemudian direkod sebagai TIADA LOKASI"), <span className={chipSmNeutral}>{L("Required", "Diwajibkan")}</span>, "rule-required")}
            </ul>
          </SplitPane>
        </SplitColumn>
        <SplitColumn>
          <SplitPane testid="fence-map-pane" title={L("Office Map & Verification Zone", "Peta Pejabat & Zon Pengesahan")} sub={saved ? L(`${info?.label ?? label} · ${info?.radius_m} m${unsaved ? " · showing the unsaved values" : ""}`, `${info?.label ?? label} · ${info?.radius_m} m${unsaved ? " · memaparkan nilai belum disimpan" : ""}`) : L("Not saved yet - showing the form's values", "Belum disimpan - memaparkan nilai borang")} label={L("Office map", "Peta pejabat")}>
            {valid ? <FenceMap lat={nLat} lng={nLng} radius={nRad} label={label} /> : <p className={css.muted}>{L("Enter a valid latitude, longitude and radius to see the zone.", "Masukkan latitud, longitud dan radius yang sah untuk melihat zon.")}</p>}
          </SplitPane>
          <SplitPane fit testid="location-history" title={L("Location Change History", "Sejarah Perubahan Lokasi")} sub={L("Every change, from the audit log", "Setiap perubahan, daripada log audit")} label={L("Location change history", "Sejarah perubahan lokasi")}
            actions={onAudit ? <button type="button" className={btnSm} onClick={onAudit}>{L("View audit", "Lihat audit")}</button> : undefined}>
            {history === null ? <SkelRows rows={2} /> : history === "denied" ? <p className={css.muted}>{L("Audit History is for the CEO, Admin and Super Admin.", "Sejarah Audit untuk CEO, Admin dan Super Admin.")}</p> : history.length === 0 ? (
              <p className={css.muted}>{L("No change recorded yet.", "Belum ada perubahan direkodkan.")}</p>
            ) : (
              <ul className={`${listBox} ${css.rows}`} data-testid="history-list">
                {history.slice(0, 4).map((h) => {
                  let det: { radius_m?: number; label?: string } = {};
                  try { det = h.detail ? JSON.parse(h.detail) : {}; } catch { /* plain text */ }
                  const off = h.action.endsWith("_clear");
                  return rule(off ? "blocked" : "place", off ? L("Office check-in turned off", "Daftar pejabat dimatikan") : L(`Set: ${det.label ?? "office"}${det.radius_m ? ` · ${det.radius_m} m` : ""}`, `Ditetapkan: ${det.label ?? "pejabat"}${det.radius_m ? ` · ${det.radius_m} m` : ""}`),
                    `${stampMyt(h.created_at)} MYT${h.user_name ? ` · ${h.user_name}` : ""}`, <span className={off ? chipSmWarn : chipSmSuccess}>{off ? L("Off", "Mati") : L("Set", "Ditetapkan")}</span>, `hist-${h.id}`);
                })}
              </ul>
            )}
          </SplitPane>
        </SplitColumn>
      </WorkspaceSplit>
    </div>
  );
}
