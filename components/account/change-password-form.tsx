"use client";

import { useState } from "react";
import { PasswordInput } from "@/components/ui/password-input";

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Self-service password change. Used in /admin (Account tab) and /portal
 * (Profile). Requires the current password, enforces the same 10+ character
 * minimum as the API, and — server-side — revokes every other session on
 * success, so a stolen session dies the moment the password rotates.
 *
 * Google-only accounts have no password; the API answers `google_account`
 * and this form explains instead of failing cryptically.
 */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < 10;
  const ready =
    current.length > 0 && next.length >= 10 && next === confirm && state.kind !== "busy";

  const submit = async () => {
    setState({ kind: "busy" });
    try {
      const res = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      if (res.ok) {
        setCurrent("");
        setNext("");
        setConfirm("");
        setState({ kind: "done" });
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      const code = data?.error?.code;
      setState({
        kind: "error",
        message:
          code === "google_account"
            ? "This account signs in with Google — manage your password in your Google account instead."
            : code === "invalid_credentials"
              ? "Current password is incorrect — use the eye icon to check what you typed."
              : (data?.error?.message ??
                "Could not change the password. Check the fields and try again."),
      });
    } catch {
      setState({ kind: "error", message: "Network error — try again." });
    }
  };

  return (
    <div className="max-w-sm space-y-3">
      <label className="block">
        <span className="text-muted-foreground mb-1 block text-xs font-medium">
          Current password
        </span>
        <PasswordInput
          
          autoComplete="current-password"
          className={inputClass}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="text-muted-foreground mb-1 block text-xs font-medium">
          New password
        </span>
        <PasswordInput
          
          autoComplete="new-password"
          className={inputClass}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        {tooShort && (
          <p className="text-destructive mt-1 text-xs">{next.length} of 10 characters minimum</p>
        )}
      </label>

      <label className="block">
        <span className="text-muted-foreground mb-1 block text-xs font-medium">
          Confirm new password
        </span>
        <PasswordInput
          
          autoComplete="new-password"
          className={inputClass}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <p className="text-destructive mt-1 text-xs">Passwords do not match.</p>}
      </label>

      {state.kind === "error" && (
        <p className="text-destructive text-sm">{state.message}</p>
      )}
      {state.kind === "done" && (
        <p className="text-sm font-medium text-green-700">
          Password changed. Any other signed-in devices have been logged out.
        </p>
      )}

      <button
        type="button"
        disabled={!ready}
        onClick={() => void submit()}
        className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium transition-colors disabled:opacity-50"
      >
        {state.kind === "busy" ? "Changing…" : "Change password"}
      </button>
    </div>
  );
}
