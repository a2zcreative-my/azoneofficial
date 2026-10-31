/* v1.238.0 - OUTBOUND EMAIL, THROUGH CLOUDFLARE EMAIL SENDING (the owner,
   31-10-2026, claude/ACCOUNT-RECOVERY-AUDIT.md: "Cloudflare Email Sending").

   The portal had no email channel at all. Cloudflare Email Sending (public
   beta since 16-04-2026, Workers Paid plan) sends from a Worker through a
   `send_email` binding once a sending domain is onboarded in the dashboard
   (Compute > Email Service > Email Sending > Onboard Domain - Cloudflare adds
   the SPF, DKIM and DMARC records itself).

   Until the binding (EMAIL) and the sender (MAIL_FROM) are configured, every
   send answers false and the callers fall back: a login email change is
   verified by Google sign-in or in person, and a set-password link is shown
   to the owner or super admin to hand over. Nothing pretends an email went.

   What is never put in an email: a password, a 2FA secret or a backup code.
   Links carry a single-use token whose hash alone is stored. */
import type { Env } from "./index";

export interface MailMessage { to: string; subject: string; text: string; html?: string }

export function mailReady(env: Env): boolean {
  return !!env.EMAIL && typeof env.EMAIL.send === "function" && !!env.MAIL_FROM;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Send one message. True only when Cloudflare accepted it. Never throws. */
export async function sendMail(env: Env, m: MailMessage): Promise<boolean> {
  if (!mailReady(env)) return false;
  try {
    const html = m.html ?? `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#14213d">${esc(m.text).replace(/\n/g, "<br>")}</div>`;
    await env.EMAIL!.send({ from: env.MAIL_FROM!, to: m.to, subject: m.subject, text: m.text, html });
    return true;
  } catch {
    return false;
  }
}
