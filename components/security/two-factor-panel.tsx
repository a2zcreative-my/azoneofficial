"use client";

/**
 * Two-factor authentication panel (v1.4.37).
 *
 * Shown to super_admin, admin and CEO accounts. Enrolment: Start setup →
 * add the secret to an authenticator app → confirm a code → backup codes are
 * shown ONCE. Disabling requires the account password.
 */

import { useCallback, useEffect, useState } from "react";
import { card } from "@/lib/ui-styles";
import { useSaveToast } from "@/components/ui/save-toast";

const API = "/api/v1";

async function api<T>(path: string, init?: RequestInit) {
  try {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: null };
  }
}

const input =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";
const btn =
  "inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50";
const btnGhost =
  "inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-secondary";

export function TwoFactorPanel() {
  const { show: showToast, node: toastNode } = useSaveToast();
  const [status, setStatus] = useState<{ enabled: boolean; eligible: boolean; backup_codes_left: number } | null>(null);
  const [secret, setSecret] = useState("");
  const [otpauth, setOtpauth] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const res = await api<{ enabled: boolean; eligible: boolean; backup_codes_left: number }>("/auth/2fa/status");
    if (res.data) setStatus(res.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (!status?.eligible) return null;

  const startSetup = async () => {
    setErr("");
    const res = await api<{ secret: string; otpauth: string }>("/auth/2fa/setup", { method: "POST" });
    if (res.ok && res.data) {
      setSecret(res.data.secret);
      setOtpauth(res.data.otpauth);
    } else {
      setErr("Could not start setup — try again.");
      showToast("No changes", "Could not start two-factor setup — try again", "notice");
    }
  };

  const enable = async () => {
    setErr("");
    const res = await api<{ backup_codes?: string[]; error?: { message?: string } }>("/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    if (res.ok && res.data?.backup_codes) {
      setBackupCodes(res.data.backup_codes);
      setSecret("");
      setCode("");
      setMsg("Two-factor authentication is on.");
      showToast("Saved", "Two-factor is ON — save your backup codes before leaving this page");
      void load();
    } else {
      const m = res.data?.error?.message ?? "That code is not correct.";
      setErr(m);
      showToast("No changes", m, "notice");
    }
  };

  const disable = async () => {
    setErr("");
    const res = await api<{ error?: { message?: string } }>("/auth/2fa/disable", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setPassword("");
      setMsg("Two-factor authentication is off.");
      showToast("Saved", "Two-factor is OFF for this account");
      void load();
    } else {
      const m = res.data?.error?.message ?? "Your current password is required.";
      setErr(m);
      showToast("No changes", m, "notice");
    }
  };

  return (
    <div className={card}>
      {toastNode}
      <p className="text-sm font-semibold">
        Two-factor authentication
        {status.enabled ? (
          <span className="ml-2 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase">On</span>
        ) : (
          <span className="ml-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white uppercase">Off</span>
        )}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        A stolen password is not enough to reach this account — signing in also
        needs a 6-digit code from your phone. All staff accounts hold company
        data, so turning this on is strongly recommended for everyone.
      </p>
      {msg && <p className="mt-2 text-xs font-medium text-green-700">{msg}</p>}
      {err && <p className="text-destructive mt-2 text-xs font-medium">{err}</p>}

      {backupCodes.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/20">
          <p className="text-xs font-semibold">Save these backup codes now — they are shown only once.</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Each works once if you lose your phone. Keep them somewhere safe and private.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-4">
            {backupCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button type="button" className={`${btnGhost} mt-3`} onClick={() => setBackupCodes([])}>
            I have saved them
          </button>
        </div>
      )}

      {!status.enabled && !secret && backupCodes.length === 0 && (
        <button type="button" className={`${btn} mt-3`} onClick={() => void startSetup()}>
          Turn on two-factor
        </button>
      )}

      {!status.enabled && secret && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium">1. Add this key to your authenticator app</p>
            <p className="text-muted-foreground text-xs">
              Google Authenticator, Authy, 1Password or Microsoft Authenticator →
              &quot;Add account&quot; → &quot;Enter setup key&quot;.
            </p>
            <p className="border-border bg-secondary/40 mt-2 rounded-lg border px-3 py-2 font-mono text-sm break-all">
              {secret}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              Account name: AZ ONE OFFICIAL · Type: time-based
            </p>
            {otpauth && (
              <a href={otpauth} className="mt-1 inline-block text-xs underline">
                Or open in your authenticator app
              </a>
            )}
          </div>
          <div>
            <p className="text-xs font-medium">2. Enter the 6-digit code it shows</p>
            <input
              className={`${input} mt-1 max-w-40 text-center tracking-[0.3em]`}
              inputMode="numeric"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button type="button" className={btn} disabled={code.length < 6} onClick={() => void enable()}>
            Confirm and turn on
          </button>
        </div>
      )}

      {status.enabled && (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground text-xs">
            Backup codes remaining: <span className="font-medium">{status.backup_codes_left}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              className={`${input} max-w-56`}
              placeholder="Current password to turn off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className={btnGhost} disabled={!password} onClick={() => void disable()}>
              Turn off
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
