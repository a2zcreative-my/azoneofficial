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
          {(st.failed_events_7d > 0 || st.last_event_verified === false) && (
            <p className="text-amber-700 sm:col-span-2">
              ⚠ Signature failures mean the stored app secret no longer matches Partner Center — re-copy the secret, run{" "}
              <span className="font-mono">wrangler secret put TIKTOK_APP_SECRET</span>, then deploy. Order sync still works; only webhook pushes are affected.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
