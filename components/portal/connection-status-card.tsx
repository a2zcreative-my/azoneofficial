"use client";

/* v1.4.212 (approved architecture review — extension-only): TikTok
   Connection Status card. NEW file; consumes the EXISTING
   /api/v1/integrations/tiktok/status route (v1.4.48) plus the two additive
   keys shipped alongside this card (last_order_at, failed_events_7d).
   Self-contained on purpose: own fetch, own types, style tokens copied
   from the approved dashboard card so nothing existing is imported or
   altered. All staff may view (the route already allows any non-customer). */

import { useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";
import { getLang } from "@/lib/i18n";

const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);


interface TtStatus {
  configured: boolean;
  authorized: boolean;
  last_event_at: string | null;
  last_event_verified: boolean | null;
  last_order_at: string | null;
  failed_events_7d: number;
  last_verified_at?: string | null; // v1.4.217
  last_failed_at?: string | null;   // v1.4.217
}

/** "2026-08-05 01:12:33" (UTC, D1 datetime) → "05-08-2026 09:12 MYT" */
function myt(ts: string | null): string {
  if (!ts) return L("never", "tidak pernah");
  const d = new Date(ts.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return ts;
  const m = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return `${m.slice(8, 10)}-${m.slice(5, 7)}-${m.slice(0, 4)} ${m.slice(11, 16)} MYT`;
}

interface DebugVerdict {
  state: "no_failures" | "insufficient_data" | "no_signature_header" | "replayed";
  event_at?: string;
  scheme?: "A" | "B";
  relay_header?: boolean;
  current_secret_verifies?: boolean;
}

export function ConnectionStatusCard() {
  const [st, setSt] = useState<TtStatus | null>(null);
  const [err, setErr] = useState("");
  const [dbg, setDbg] = useState<DebugVerdict | null>(null);
  const [dbgBusy, setDbgBusy] = useState(false);
  const [dbgDenied, setDbgDenied] = useState(false);
  const runDebug = async () => {
    setDbgBusy(true);
    try {
      const r = await fetch("/api/v1/integrations/tiktok/webhook-debug", { credentials: "include" });
      if (r.status === 401 || r.status === 403) { setDbgDenied(true); return; }
      if (r.ok) setDbg((await r.json()) as DebugVerdict);
    } finally { setDbgBusy(false); }
  };
  useEffect(() => {
    let alive = true;
    void fetch("/api/v1/integrations/tiktok/status", { credentials: "include" })
      .then(async (r) => (r.ok ? ((await r.json()) as TtStatus) : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setSt(d); })
      .catch(() => { if (alive) setErr("Status unavailable"); });
    return () => { alive = false; };
  }, []);

  if (err) return null; // an old worker without the route: show nothing, break nothing
  const dot = (ok: boolean) => (
    <span className={ok ? "font-semibold text-green-700" : "font-semibold text-red-600"}>{ok ? "●" : "●"}</span>
  );
  return (
    <div className={card}>
      <p className="text-sm font-semibold">{L("🔌 TikTok connection", "🔌 Sambungan TikTok")}</p>
      {!st ? (
        <p className="text-muted-foreground mt-1 text-sm">{L("Checking…", "Menyemak…")}</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
          <p>{dot(st.configured && st.authorized)} <span className="font-medium">{L("Shop authorization", "Kebenaran kedai")}</span>{" "}
            <span className="text-muted-foreground">{st.configured && st.authorized ? L("active", "aktif") : st.configured ? L("not authorized — re-authorize from Partner Center link", "tidak dibenarkan — beri kebenaran semula melalui pautan Partner Center") : L("keys not configured", "kunci belum dikonfigurasi")}</span></p>
          <p>{dot(!!st.last_order_at)} <span className="font-medium">{L("Last synced order", "Pesanan terakhir disegerak")}</span>{" "}
            <span className="text-muted-foreground">{myt(st.last_order_at)}</span></p>
          <p>{dot(!!st.last_event_at && st.last_event_verified !== false)} <span className="font-medium">{L("Last webhook", "Webhook terakhir")}</span>{" "}
            <span className="text-muted-foreground">{myt(st.last_event_at)}{st.last_event_at ? (st.last_event_verified ? L(" · signature OK", " · tandatangan OK") : L(" · signature FAILED", " · tandatangan GAGAL")) : ""}</span></p>
          <p>{dot(st.failed_events_7d === 0)} <span className="font-medium">{L("Webhook failures (7d)", "Kegagalan webhook (7 hari)")}</span>{" "}
            <span className={st.failed_events_7d > 0 ? "font-semibold text-amber-700" : "text-muted-foreground"}>{st.failed_events_7d}</span></p>
          {(() => {
            /* v1.4.217 (CEO: "still got this error even after insert the
               API"): three honest states instead of one scary one —
               (a) newest event VERIFIED but old failures in the 7d window
                   → green all-clear: the fix worked, history just ages out;
               (b) newest event FAILED → amber, but say plainly that after
                   fixing the secret this stays until TikTok sends the NEXT
                   event, and how to trigger one;
               (c) no failures at all → nothing. */
            const okAfterFail = !!st.last_verified_at && !!st.last_failed_at && st.last_verified_at > st.last_failed_at;
            if (st.last_event_verified === false) return (
              <div className="sm:col-span-2">
                <p className="text-amber-700">
                  {L(`⚠ The most recent webhook failed signature verification (last failure ${myt(st.last_failed_at ?? st.last_event_at)}). Failures at a steady ~30-min rhythm are usually TikTok RETRYING the same undelivered event — the counter climbs until one verifies. Order sync is unaffected either way.`,
                    `⚠ Webhook terbaru gagal pengesahan tandatangan (kegagalan terakhir ${myt(st.last_failed_at ?? st.last_event_at)}). Kegagalan pada rentak tetap ~30 minit biasanya bermakna TikTok CUBA SEMULA acara sama yang belum sampai — kiraan meningkat sehingga satu berjaya disahkan. Segerakan pesanan tidak terjejas sama sekali.`)}
                </p>
                {/* v1.4.220: stop guessing — replay the newest failed event
                    against the secret the worker holds RIGHT NOW. */}
                {!dbg && !dbgDenied && (
                  <button type="button" className="mt-1.5 rounded-lg border border-amber-700 px-2.5 py-1 text-xs font-medium text-amber-800"
                    disabled={dbgBusy} onClick={() => void runDebug()}>
                    {dbgBusy ? L("Checking…", "Menyemak…") : L("🔍 Test the current secret against the last failed event", "🔍 Uji rahsia semasa terhadap acara gagal yang terakhir")}
                  </button>
                )}
                {dbg?.state === "replayed" && dbg.current_secret_verifies && (
                  <p className="mt-1.5 font-medium text-green-700">
                    {L("✅ The secret now on the server VERIFIES that event — your update worked; the event simply arrived before it. The next delivery (TikTok retries automatically) will pass and this card turns green on its own.",
                      "✅ Rahsia yang kini ada pada pelayan BERJAYA mengesahkan acara itu — kemas kini anda berjaya; acara itu cuma tiba sebelumnya. Penghantaran seterusnya (TikTok mencuba semula secara automatik) akan lulus dan kad ini bertukar hijau dengan sendirinya.")}
                  </p>
                )}
                {dbg?.state === "replayed" && !dbg.current_secret_verifies && (
                  <p className="mt-1.5 font-semibold text-red-600">
                    {L("❌ The secret now on the server does NOT match this event's signature", "❌ Rahsia yang kini ada pada pelayan TIDAK sepadan dengan tandatangan acara ini")}{dbg.relay_header ? L(" — and the event carries a relay header (x-webhook-secret): it comes through Make/Zapier, so set TIKTOK_WEBHOOK_SECRET to the relay's value instead", " — dan acara ini membawa pengepala relay (x-webhook-secret): ia datang melalui Make/Zapier, jadi tetapkan TIKTOK_WEBHOOK_SECRET kepada nilai relay itu") : ""}.
                    {!dbg.relay_header && L(" Re-view the App Secret in Partner Center (app 7668934538403645205 → Basic information → view + copy), then run wrangler secret put TIKTOK_APP_SECRET inside THIS project's worker/ folder.", " Lihat semula App Secret di Partner Center (app 7668934538403645205 → Basic information → lihat + salin), kemudian jalankan wrangler secret put TIKTOK_APP_SECRET dalam folder worker/ projek INI.")}
                  </p>
                )}
                {dbg?.state === "insufficient_data" && (
                  <p className="text-muted-foreground mt-1.5">
                    {L("The last failed event predates the diagnostic (its signature wasn't stored). TikTok retries roughly every half hour — press the test again after the next failure lands and you'll get a definitive verdict.",
                      "Acara gagal yang terakhir berlaku sebelum diagnostik ini (tandatangannya tidak disimpan). TikTok mencuba semula lebih kurang setiap setengah jam — tekan ujian sekali lagi selepas kegagalan seterusnya tiba dan anda akan dapat keputusan muktamad.")}
                  </p>
                )}
                {dbg?.state === "no_signature_header" && (
                  <p className="mt-1.5 font-medium text-amber-800">
                    {L("The failing requests carry NO TikTok signature at all", "Permintaan yang gagal itu TIDAK membawa tandatangan TikTok langsung")}{dbg.relay_header ? L(" but DO carry a relay header — set TIKTOK_WEBHOOK_SECRET to match your Make/Zapier relay", " tetapi ADA membawa pengepala relay — tetapkan TIKTOK_WEBHOOK_SECRET supaya sepadan dengan relay Make/Zapier anda") : L(" — something other than TikTok is posting to the webhook URL", " — sesuatu selain TikTok sedang menghantar ke URL webhook itu")}.
                  </p>
                )}
              </div>
            );
            if (okAfterFail && st.failed_events_7d > 0) return (
              <p className="font-medium text-green-700 sm:col-span-2">
                {L(`✅ Secret fixed — the latest webhook (${myt(st.last_verified_at ?? null)}) verified OK. The failure counter only counts old events and empties as they age out of the 7-day window.`,
                  `✅ Rahsia sudah dibetulkan — webhook terbaru (${myt(st.last_verified_at ?? null)}) disahkan OK. Kiraan kegagalan hanya mengira acara lama dan akan kosong apabila acara itu keluar daripada tetingkap 7 hari.`)}
              </p>
            );
            return null;
          })()}
        </div>
      )}
    </div>
  );
}
