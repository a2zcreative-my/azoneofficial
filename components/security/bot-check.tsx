"use client";

/* v1.341.0 - THE CLOUDFLARE BOT CHECK, before a sign-in (the CEO, 17-11-2026).

   One hook for every sign-in door: the sign-in page (password, Google,
   passkey - action "signin") and the set-password link page ("set_password").
   The PUBLIC site key comes from the worker (/auth/methods -> bot_check); with
   none the check is off and nothing is drawn. The widget is Cloudflare
   Turnstile in its "interaction-only" look: most people never see it; a
   suspicious browser is asked to tick a box. A token is good for one sign-in,
   so after each try the widget is reset for a fresh one.

   The worker decides (worker/src/security-status.ts botCheck). If Cloudflare's
   challenge cannot load here, the form still sends - without a token - and the
   worker lets it through only if Cloudflare is unreachable from the server too
   (the owner's "lenient on an outage"); otherwise it is refused. */

import { useCallback, useEffect, useRef, useState } from "react";
import { getLang } from "@/lib/i18n";
import css from "./bot-check.module.css";

type Turnstile = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error("turnstile_unreachable")); };
    document.head.appendChild(s);
  });
  return loading;
}

export type BotState = "off" | "checking" | "ready" | "unavailable";

export function useBotCheck(siteKey: string | null, action: "signin" | "set_password" | "partner_apply" | "growth_check") { // v1.351.0 - the public partner application asks too; v1.369.0 - and the Business Growth Check
  const box = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<BotState>(siteKey ? "checking" : "off");
  const [seenKey, setSeenKey] = useState(siteKey);
  if (seenKey !== siteKey) { setSeenKey(siteKey); setState(siteKey ? "checking" : "off"); setToken(null); }

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let live = true;
    const el = box.current;
    loadScript().then(() => {
      if (!live || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(el, {
        sitekey: siteKey, action, appearance: "interaction-only", size: "flexible",
        language: getLang() === "ms" ? "ms" : "en",
        callback: (t: string) => { setToken(t); setState("ready"); },
        "expired-callback": () => { setToken(null); setState("checking"); },
        "error-callback": () => { setToken(null); setState("unavailable"); return true; },
      });
    }).catch(() => { if (live) setState("unavailable"); });
    return () => {
      live = false;
      if (widget.current && window.turnstile) { try { window.turnstile.remove(widget.current); } catch { /* gone */ } }
      widget.current = null;
    };
  }, [siteKey, action]);

  /** after a token is spent (one sign-in try), ask for a fresh one */
  const spend = useCallback(() => {
    setToken(null);
    if (widget.current && window.turnstile) { setState("checking"); try { window.turnstile.reset(widget.current); } catch { /* the next render brings one */ } }
  }, []);

  const L = (en: string, ms: string) => (getLang() === "ms" ? ms : en);
  const node = siteKey ? (
    <div className={css.wrap} data-testid="bot-check" data-state={state}>
      <div ref={box} className={css.box} />
      {state === "checking" && <p className={css.note} role="status">{L("Checking your browser with Cloudflare…", "Menyemak pelayar anda dengan Cloudflare…")}</p>}
      {state === "unavailable" && <p className={css.note} role="status">{L("Cloudflare's security check could not load. You can still try to sign in.", "Semakan keselamatan Cloudflare tidak dapat dimuatkan. Anda masih boleh cuba log masuk.")}</p>}
    </div>
  ) : null;

  /** v1.345.0 - the widget alone, for a page that words the state itself (the sign-in page's
      Cloudflare notice). Render EITHER node OR widgetNode - one box per page. */
  const widgetNode = siteKey ? (
    <div className={css.wrap} data-testid="bot-check" data-state={state}><div ref={box} className={css.box} /></div>
  ) : null;

  /** may the form be sent now? (off, a token in hand, or the check could not load) */
  const canSend = state === "off" || state === "unavailable" || token !== null;
  return { node, widgetNode, token, canSend, state, spend };
}
