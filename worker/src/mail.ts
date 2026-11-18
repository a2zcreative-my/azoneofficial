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

/* 18-11-2026 - ONE A2Z OS EMAIL LOOK (the CEO, 18-11-2026: "Email migrate I want to be the
   same template as reminder email!"). The task emails' frame - navy header with the A2Z OS
   mark, white card, headline, details box, gold button, footer - is drawn here, and BOTH the
   task emails (task-mail.ts buildTaskMail) and every staff account email use it, so they can
   never drift apart. A staff account email is one whose subject names "A2Z OS" (the login
   email change and move, set password, two-factor reset, recovery, passkey): it is drawn in
   this frame from its own words. Customer and client emails (the quotation, a customer's
   set-password link, the legacy notice, the Google codes) never say "A2Z OS" and keep their
   plain form - a quotation of AZ ONE OFFICIAL must not wear A2Z Creative Marketing's header. */
export const MAIL_NAVY = "#1a2946", MAIL_GOLD = "#c8a96a", MAIL_INK = "#14213d", MAIL_MUTED = "#5b6478";
export const mailEsc = esc;

export interface OsMailParts {
  title: string;                 // the <title> (the subject)
  headline: string;
  greeting?: string | null;      // "Hello MOHD," - escaped here
  paras: string[];               // the opening paragraphs, already HTML
  rows?: [string, string][] | null; // the details box (drawn when given) - escaped here
  note?: string | null;          // a muted line above the button, already HTML
  button?: { label: string; href: string } | null;
  after?: string | null;         // a muted line under the button, already HTML
  footer: string;                // the line under the company name, already HTML
}

export function osMailHtml(p: OsMailParts): string {
  const NAVY = MAIL_NAVY, GOLD = MAIL_GOLD, INK = MAIL_INK, MUTED = MAIL_MUTED;
  const trs = (p.rows ?? []).map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:${MUTED};font-size:13px;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:${INK};font-size:14px;font-weight:600;vertical-align:top">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(p.title)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="background:${NAVY};padding:20px 24px"><span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.01em">A2Z <span style="color:${GOLD}">OS</span></span><br><span style="color:${GOLD};font-size:11px;letter-spacing:0.14em;text-transform:uppercase">A2Z Creative Marketing</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 12px;font-size:20px;color:${NAVY}">${esc(p.headline)}</h1>
${p.greeting ? `<p style="margin:0 0 6px;color:${INK};font-size:15px">${esc(p.greeting)}</p>\n` : ""}${p.paras.map((h) => `<p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.5">${h}</p>`).join("\n")}
${p.rows ? `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;margin:0 0 20px"><tr><td><table role="presentation" cellspacing="0" cellpadding="0">${trs}</table></td></tr></table>\n` : ""}${p.note ? `<p style="margin:0 0 20px;color:${MUTED};font-size:13px;line-height:1.5">${p.note}</p>` : ""}
${p.button ? `<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="background:${GOLD};border-radius:8px"><a href="${esc(p.button.href)}" style="display:inline-block;padding:12px 22px;color:${NAVY};font-weight:700;font-size:15px;text-decoration:none">${esc(p.button.label)} →</a></td></tr></table>` : ""}
${p.after ? `<p style="margin:20px 0 0;color:${MUTED};font-size:12px;line-height:1.5">${p.after}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;color:${MUTED};font-size:12px;line-height:1.5"><strong style="color:${INK}">A2Z Creative Marketing</strong> · hello@a2zcreative.my<br>${p.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const URL_LINE = /^https?:\/\/\S+$/;
/** The button's words, from where the link goes. */
function buttonFor(href: string): string {
  if (/\/verify-email#/.test(href)) return "Confirm New Login Email";
  if (/\/set-password#/.test(href)) return "Set My Password";
  return "Open A2Z OS";
}

/** A staff account email, drawn in the A2Z OS frame from its own plain words. */
export function osAccountMail(m: MailMessage): string {
  const headline = m.subject.replace(/^A2Z OS:\s*/, "").replace(/^./, (c) => c.toUpperCase());
  const paras: string[] = [];
  let button: { label: string; href: string } | null = null;
  let tail: string | null = null;
  const blocks = m.text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  blocks.forEach((b, i) => {
    const lines = b.split("\n");
    const url = lines.find((l) => URL_LINE.test(l.trim()));
    if (url && !button) {
      button = { label: buttonFor(url.trim()), href: url.trim() };
      const words = lines.filter((l) => l !== url).join(" ").trim().replace(/:$/, ".");
      if (words) paras.push(esc(words));
      return;
    }
    /* the closing "if you did not expect this" line sits under the button, muted */
    if (i === blocks.length - 1 && blocks.length > 1 && /^If you did not/i.test(b)) { tail = esc(b); return; }
    paras.push(esc(b).replace(/\n/g, "<br>"));
  });
  const b = button as { label: string; href: string } | null;
  const rows: [string, string][] | null = b && /\/verify-email#/.test(b.href) ? [["New login email", m.to]] : null;
  const after = [tail, b ? `If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${esc(b.href)}</span>` : null].filter(Boolean).join("<br><br>") || null;
  return osMailHtml({ title: m.subject, headline, paras, rows, button: b, after, footer: "This is an automated email from A2Z OS. Please do not reply." });
}

/** v1.247.0 - the provider's own answer, kept verbatim for the delivery log. */
export async function sendMailResult(env: Env, m: MailMessage): Promise<{ ok: boolean; error: string | null }> {
  if (!mailReady(env)) return { ok: false, error: "Email sending is not configured (send_email binding / MAIL_FROM)" };
  try {
    const html = m.html ?? (/\bA2Z OS\b/.test(m.subject) ? osAccountMail(m) : `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#14213d">${esc(m.text).replace(/\n/g, "<br>")}</div>`);
    await env.EMAIL!.send({ from: env.MAIL_FROM!, to: m.to, subject: m.subject, text: m.text, html });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
  }
}

/** Send one message. True only when Cloudflare accepted it. Never throws. */
export async function sendMail(env: Env, m: MailMessage): Promise<boolean> {
  return (await sendMailResult(env, m)).ok;
}
