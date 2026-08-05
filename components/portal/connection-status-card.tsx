"use client";

/* v1.4.212 (approved architecture review — extension-only): TikTok
   Connection Status card. NEW file; consumes the EXISTING
   /api/v1/integrations/tiktok/status route (v1.4.48) plus the two additive
   keys shipped alongside this card (last_order_at, failed_events_7d).
   Self-contained on purpose: own fetch, own types, style tokens copied
   from the approved dashboard card so nothing existing is imported or
   altered. All staff may view (the route already allows any non-customer). */

import { useEffect, useState } from "react";

const card = "rounded-lg border border-border bg-card p-3.5 md:p-4";

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
  if (!ts) return "never";
  const d = new Date(ts.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return ts;
  const m = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return `${m.slice(8, 10)}-${m.slice(5, 7)}-${m.slice(0, 4)} ${m.slice(11, 16)} MYT`;
}

export function ConnectionStatusCard() {
  const [st, setSt] = useState<TtStatus | null>(null);
  const [err, setErr] = useState("");
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
      <p className="text-sm font-semibold">🔌 TikTok connection</p>
      {!st ? (
        <p className="text-muted-foreground mt-1 text-sm">Checking…</p>
      ) : (
        <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
          <p>{dot(st.configured && st.authorized)} <span className="font-medium">Shop authorization</span>{" "}
            <span className="text-muted-foreground">{st.configured && st.authorized ? "active" : st.configured ? "not authorized — re-authorize from Partner Center link" : "keys not configured"}</span></p>
          <p>{dot(!!st.last_order_at)} <span className="font-medium">Last synced order</span>{" "}
            <span className="text-muted-foreground">{myt(st.last_order_at)}</span></p>
          <p>{dot(!!st.last_event_at && st.last_event_verified !== false)} <span className="font-medium">Last webhook</span>{" "}
            <span className="text-muted-foreground">{myt(st.last_event_at)}{st.last_event_at ? (st.last_event_verified ? " · signature OK" : " · signature FAILED") : ""}</span></p>
          <p>{dot(st.failed_events_7d === 0)} <span className="font-medium">Webhook failures (7d)</span>{" "}
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
              <p className="text-amber-700 sm:col-span-2">
                ⚠ The most recent webhook failed signature verification (last failure {myt(st.last_failed_at ?? st.last_event_at)}). If the app secret
                was just updated (<span className="font-mono">wrangler secret put TIKTOK_APP_SECRET</span>), this line stays until TikTok sends the
                NEXT event — a new order or a status change — because the card reports history, not the current secret. Place a small test order or
                wait for the next real one; when it arrives verified, this turns green by itself. Order sync is unaffected either way.
              </p>
            );
            if (okAfterFail && st.failed_events_7d > 0) return (
              <p className="font-medium text-green-700 sm:col-span-2">
                ✅ Secret fixed — the latest webhook ({myt(st.last_verified_at ?? null)}) verified OK. The failure counter only counts old events and
                empties as they age out of the 7-day window.
              </p>
            );
            return null;
          })()}
        </div>
      )}
    </div>
  );
}
