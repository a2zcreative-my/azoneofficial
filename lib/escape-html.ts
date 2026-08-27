/**
 * v1.45.0 (security audit C7) — escape a value before it becomes HTML.
 *
 * The print flows (badges, payslips, claim forms, document previews) build a
 * whole HTML document as a string and hand it to `document.write` in a new
 * window. Everything interpolated into those strings — a staff name, a
 * position, a customer's company, a claim description — arrives from the
 * database, i.e. from something a person typed. A name containing markup
 * would be parsed as markup: at best a broken payslip, at worst script
 * running in a same-origin window with the user's session.
 *
 * Nothing about this is exotic. It is the escaping React does for you on
 * every `{value}` — which is exactly why these hand-built strings were the
 * one place it went missing.
 *
 * Use for TEXT content and for quoted attribute values. It is deliberately
 * NOT enough for a URL in `href`/`src` (see safeUrl below) or for anything
 * inside a <script> or <style> block; those need their own rules and none of
 * our print flows put user data there.
 */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A URL that is safe to put in an href/src: same-origin paths and explicit
 * http(s)/data-image URLs only. Anything else — `javascript:` above all —
 * comes back empty, so the link simply does nothing instead of running.
 */
export function safeUrl(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (s === "") return "";
  if (s.startsWith("/") && !s.startsWith("//")) return esc(s);      // our own path
  if (/^https?:\/\//i.test(s)) return esc(s);
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/i.test(s)) return esc(s);
  if (/^blob:/i.test(s)) return esc(s);
  return "";
}
