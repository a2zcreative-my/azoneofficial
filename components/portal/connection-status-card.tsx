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
      <p className="text-sm font-semibold">🔌 TikTok connection</p>
      {!st ? (
        <p className="text-muted-foreground mt-1 text-sm">Checking…</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
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
              <div className="sm:col-span-2">
                <p className="text-amber-700">
                  ⚠ The most recent webhook failed signature verification (last failure {myt(st.last_failed_at ?? st.last_event_at)}). Failures at a
                  steady ~30-min rhythm are usually TikTok RETRYING the same undelivered event — the counter climbs until one verifies. Order sync
                  is unaffected either way.
                </p>
                {/* v1.4.220: stop guessing — replay the newest failed event
                    against the secret the worker holds RIGHT NOW. */}
                {!dbg && !dbgDenied && (
                  <button type="button" className="mt-1.5 rounded-lg border border-amber-700 px-2.5 py-1 text-xs font-medium text-amber-800"
                    disabled={dbgBusy} onClick={() => void runDebug()}>
                    {dbgBusy ? "Checking…" : "🔍 Test the current secret against the last failed event"}
                  </button>
                )}
                {dbg?.state === "replayed" && dbg.current_secret_verifies && (
                  <p className="mt-1.5 font-medium text-green-700">
                    ✅ The secret now on the server VERIFIES that event — your update worked; the event simply arrived before it. The next delivery
                    (TikTok retries automatically) will pass and this card turns green on its own.
                  </p>
                )}
                {dbg?.state === "replayed" && !dbg.current_secret_verifies && (
                  <p className="mt-1.5 font-semibold text-red-600">
                    ❌ The secret now on the server does NOT match this event&apos;s signature{dbg.relay_header ? " — and the event carries a relay header (x-webhook-secret): it comes through Make/Zapier, so set TIKTOK_WEBHOOK_SECRET to the relay's value instead" : ""}.
                    {!dbg.relay_header && " Re-view the App Secret in Partner Center (app 7668934538403645205 → Basic information → view + copy), then run wrangler secret put TIKTOK_APP_SECRET inside THIS project's worker/ folder."}
                  </p>
                )}
                {dbg?.state === "insufficient_data" && (
                  <p className="text-muted-foreground mt-1.5">
                    The last failed event predates the diagnostic (its signature wasn&apos;t stored). TikTok retries roughly every half hour — press the
                    test again after the next failure lands and you&apos;ll get a definitive verdict.
                  </p>
                )}
                {dbg?.state === "no_signature_header" && (
                  <p className="mt-1.5 font-medium text-amber-800">
                    The failing requests carry NO TikTok signature at all{dbg.relay_header ? " but DO carry a relay header — set TIKTOK_WEBHOOK_SECRET to match your Make/Zapier relay" : " — something other than TikTok is posting to the webhook URL"}.
                  </p>
                )}
              </div>
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
