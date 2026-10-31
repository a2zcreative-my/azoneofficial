/**
 * THE SIGN-IN SCREEN, ON BOTH SCREENS — guard #77, v1.156.0.
 *
 * The CEO, 12-09-2026: *"provide me implementation for the better UI/UX on
 * the login page webview and mobile apps view"*.
 *
 * /login is the ONE screen every person in the company meets, including the
 * ones who never open another tab, and it is the only screen a stranger can
 * reach. Everything below was broken or missing before this release; each
 * check is the property, not the markup that happens to carry it today.
 *
 *   1. TWO SHAPES, ONE PAGE. From `lg` up the page is a two-column grid with
 *      a brand panel beside the form; below `lg` there is no grid at all and
 *      the form is a centred column measured in svh with the safe-area inset
 *      (the v1.29.2 phone fix, which this release must not undo). The brand
 *      panel is DECORATIVE: a phone never draws it, so nothing needed to
 *      sign in can live there.
 *   2. A REAL FORM. <form onSubmit> with a type="submit" button, so Enter
 *      submits from any field and password managers have something to fill.
 *      No hand-rolled "Enter key" listener doing the job of a form.
 *   3. EVERY FIELD IS NAMED. A visible <label htmlFor> for each input id -
 *      a placeholder disappears the moment you type and is not a name.
 *   4. THE PHONE IS NOT ZOOMED. The inputs use `inputClassLg` (16px on a
 *      phone). Below 16px iOS zooms the page in on focus and the person has
 *      to pinch back out to see the button they are typing towards.
 *   5. THE BUTTON IS NEVER BORN DEAD. The submit is disabled only while a
 *      request is in flight - never for an empty field - and what is missing
 *      is said in words instead.
 *   6. ERRORS ANNOUNCE THEMSELVES. role="alert", and the inputs point at the
 *      message with aria-describedby.
 *   7. LANGUAGE AT THE DOOR. EN/BM on the page, writing the same azone-lang
 *      key through setLang() that the rest of the app reads.
 *   8. THE CODE SCREEN BELONGS TO THE PHONE. autoComplete="one-time-code"
 *      and inputMode="numeric" (so the keypad and the SMS/authenticator
 *      autofill appear), the pasted value is stripped to digits and capped
 *      at six, and the sixth digit signs in by itself.
 *   9. THE FORGOTTEN PASSWORD IS ANSWERED NEUTRALLY (v1.211.0). There is no
 *      self-service reset; the page says to contact A2Z - and no longer how
 *      accounts are run inside (no "administrator", no "Users tab").
 *  10. STILL BILINGUAL, STILL STATIC-EXPORT SAFE. Every string is L(en, ms),
 *      and the language is read in an effect - never at module scope, which
 *      would render "en" into login.html and "ms" on the client (v1.27.0).
 *
 * Negative-tested by: dropping the <form> for a bare div (2); removing a
 * label (3); swapping inputClassLg for inputClass (4); putting
 * `disabled={!email || !password}` back on the submit (5); removing
 * autoComplete="one-time-code" (8); dropping the svh/safe-area column (1).
 *
 *  11. MINIMAL PUBLIC INFORMATION (v1.211.0, the owner's sign-in brief): no
 *      list of what is inside, no build number, no "staff and customer
 *      portal", no Create account; one sentence for every failed sign-in,
 *      by password or by Google, so the page never says whether an account
 *      exists or is switched off; and every Google failure lands HERE
 *      (worker OAUTH_FAILED), not on /admin where nothing read it.
 *
 * Run: node tests/login-ux.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const src = read("app/login/page.tsx");
const css = read("app/login/login.module.css");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const styles = read("lib/ui-styles.ts");
const i18n = read("lib/i18n.ts");

/* ---- 1. two shapes, one page ---- */
{
  /* v1.211.0 - the layout is the page's own module (app/login/login.module.css) */
  ok("from lg up the page is a two-column grid", /<div className=\{css\.page\}>/.test(src) && /@media \(min-width: 1024px\) \{\s*\.page \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/.test(css));
  ok("the brand panel is beside the form and a phone never draws it", /function BrandPanel\(/.test(src) && /\.brand \{\s*display: none;\s*\}\s*@media \(min-width: 1024px\) \{\s*\.brand \{\s*display: flex;/.test(css) && /<BrandPanel lang=\{lang\} \/>/.test(src));
  ok("nothing needed to sign in lives in the brand panel", (() => {
    const panel = src.slice(src.indexOf("function BrandPanel("), src.indexOf("/* ── the page ──"));
    return !/<input|<form|type="submit"|auth\/google/.test(panel);
  })());
  /* the v1.29.2 phone fix, kept verbatim: svh, not vh, and the home indicator */
  ok("the form column is a centred svh column with the safe-area inset (v1.29.2 kept)",
    /<main className=\{css\.formSide\}>/.test(src) && /\.formSide \{[^}]*justify-content: center;[^}]*min-height: 100svh;[^}]*padding: 1\.5rem 1\.5rem max\(1\.5rem, env\(safe-area-inset-bottom\)\);/.test(css));
  ok("and it is not capped at phone width on a desk", /@media \(min-width: 1024px\) \{\s*\.formSide \{[^}]*max-width: 28rem;/.test(css));
}

/* ---- 2. a real form ---- */
{
  ok("sign-in is a <form> that submits", /<form className=\{css\.form\} noValidate onSubmit=\{\(e\) => \{ e\.preventDefault\(\); if \(!busy\) void submit\(\); \}\}>/.test(src));
  ok("the code screen is a <form> too", /<form\s+className=\{css\.form\}\s+onSubmit=/.test(src));
  ok("both buttons are type=submit", (src.match(/<button type="submit"/g) ?? []).length >= 2);
  ok("no hand-rolled Enter listener stands in for the form", !/onKeyDown=\{\(e\) => e\.key === "Enter"/.test(src));
}

/* ---- 3 + 4. every field is named, and the phone is not zoomed ---- */
{
  const ids = [...src.matchAll(/<input\s+id="(\w+)"/g)].map((m) => m[1]);
  ok("every input carries an id", ids.length >= 3, `${ids.length} inputs with an id`);
  const labelled = ids.filter((id) => new RegExp(`<Field\\s+id="${id}"|<Field\\n\\s+id="${id}"`).test(src));
  ok("every input is inside a labelled Field", labelled.length === ids.length, `${labelled.length} of ${ids.length}: ${ids.filter((i) => !labelled.includes(i)).join(", ")}`);
  ok("Field renders a real <label htmlFor>", /<label htmlFor=\{id\}/.test(src));
  ok("the inputs are the 16px public-page field, not the 14px desk one", /inputClassLg/.test(src) && !/\binputClass\b(?!Lg)/.test(src));
  /* v1.172.2 (Tailwind retired): the field is the named .erp-input-public,
     16px below `sm` and 14px from it, in styles/erp-v3.css. */
  const v3 = read("styles/erp-v3.css");
  ok("...and inputClassLg really is 16px on a phone",
     /export const inputClassLg =[\s\S]*?"erp-input-public";/.test(styles)
     && /\.erp-input-public \{[^}]*font-size: 1rem;/.test(v3)
     && /@media \(min-width: 640px\) \{ \.erp-input-public \{ font-size: 0\.875rem;/.test(v3));
  ok("the email field asks for the email keyboard and no autocapitalise", /inputMode="email"/.test(src) && /autoCapitalize="none"/.test(src));
  ok("the password field keeps its autocomplete contract", /autoComplete="current-password"/.test(src) && /autoComplete="username"/.test(src));
  ok("the password can be revealed, and the toggle says which state it is in", /aria-pressed=\{showPw\}/.test(src) && /aria-label=\{showPw \? L\("Hide password"/.test(src));
  ok("Caps Lock is reported instead of a silent wrong password", /getModifierState\?\.\("CapsLock"\)/.test(src) && /Caps Lock is on/.test(src));
}

/* ---- 5. the button is never born dead ---- */
{
  ok("the submit is disabled only while a request is in flight", /<button type="submit" className=\{btnClassBlock\} disabled=\{busy\}>/.test(src));
  ok("and what is missing is said in words", /Please enter your email address/.test(src) && /Please enter your password/.test(src) && /Sila masukkan kata laluan anda/.test(src));

}

/* ---- 6. errors announce themselves ---- */
{
  ok("the error is an alert", /role="alert"/.test(src) && /function ErrorNote\(/.test(src));
  ok("the fields point at it", (src.match(/aria-describedby=\{error \? "form-error" : undefined\}/g) ?? []).length >= 2 && /aria-describedby=\{error \? "code-error" : undefined\}/.test(src));
  ok("and mark themselves invalid", (src.match(/aria-invalid=\{error \? true : undefined\}/g) ?? []).length >= 3);
}

/* ---- 7. language at the door ---- */
{
  ok("EN/BM is on the page", /function LangSwitch\(/.test(src) && /<LangSwitch lang=\{lang\} onPick=\{pickLang\} \/>/.test(src));
  ok("and it writes the key the rest of the app reads", /const pickLang = \(l: Lang\) => \{ setLang\(l\); setLangState\(l\); \};/.test(src) && /azone-lang/.test(i18n));
  ok("the pills say which is chosen", /aria-pressed=\{lang === "en"\}/.test(src) && /aria-pressed=\{lang === "ms"\}/.test(src));
}

/* ---- 8. the code screen belongs to the phone ---- */
{
  ok("the code field autofills from the authenticator / SMS (numeric keyboard while digits are typed)", /autoComplete="one-time-code"/.test(src) && /inputMode=\{\/\[A-Z-\]\/\.test\(code\) \? "text" : "numeric"\}/.test(src));
  /* v1.241.0 (go-live audit A1): a backup code is ABCDE-FGHIJ - letters, digits
     and a dash, eleven characters; the box used to strip everything but
     digits, so the page offered a backup code it could never send */
  ok("a pasted code keeps letters, digits and the dash, eleven at most, upper-cased", /let next = raw\.toUpperCase\(\)\.replace\(\/\[\^A-Z0-9-\]\/g, ""\)\.slice\(0, 11\);/.test(src));
  ok("a backup code typed without its dash gets it back (the server compares the issued form)", /if \(\/\[A-Z\]\/\.test\(next\) && !next\.includes\("-"\) && next\.length > 5\) next = `\$\{next\.slice\(0, 5\)\}-\$\{next\.slice\(5, 10\)\}`;/.test(src));
  ok("the sixth DIGIT signs in by itself; a backup code waits for Verify", /if \(\/\^\\d\{6\}\$\/\.test\(next\) && !busy\) void verifyCode\(next\);/.test(src) && /const codeReady = \/\^\\d\{6\}\$\/\.test\(code\) \|\| code\.replace\(\/-\/g, ""\)\.length >= 6;/.test(src) && /disabled=\{busy \|\| !codeReady\}/.test(src) && /maxLength=\{11\}/.test(src) && !/pattern="\[0-9\]\*"/.test(src));
  ok("and it cannot fire twice", /if \(verifying\.current\) return;/.test(src));
  ok("the code is verified with the value just typed, not with stale state", /const verifyCode = async \(value: string\)/.test(src) && /body: JSON\.stringify\(\{ challenge, code: value \}\)/.test(src));
}

/* ---- 9 + 10. honest help, and still bilingual ---- */
{
  ok("the forgotten password is answered, neutrally", /Forgot password\?/.test(src) && /To reset your password, please contact A2Z Creative Marketing\./.test(src) && /sila hubungi A2Z Creative Marketing/.test(src) && !/Users tab|self-service|administrator/i.test(strip(src)));
  ok("the help is disclosed, not always shouting", /aria-expanded=\{helpOpen\}/.test(src));
  const bare = [...src.matchAll(/>([A-Z][A-Za-z' ]{6,})</g)].map((m) => m[1].trim())
    .filter((t) => !/^(A2Z|EN|BM)/.test(t));
  ok("no bare English string is rendered outside L(en, ms)", bare.length === 0, bare.slice(0, 3).join(" · "));
  ok("the language is read in an effect, never at module scope (static export)",
    /useEffect\(\(\) => \{ setLangState\(getLang\(\)\); \}, \[\]\);/.test(src) && !/^const lang = getLang\(\)/m.test(src));
}

/* ---- 11. minimal public information (v1.211.0) ---- */
{
  const code = strip(src);
  ok("no build number on the page", !/APP_VERSION|lib\/version/.test(code));
  ok("no list of what is inside, no 'staff and customer portal'", !/Clock in, shifts|Sales, orders|payroll|payslips|targets|staff and customer portal|One login for everyone|your own area/i.test(code));
  ok("the brand panel is the mark, the welcome and the copyright", /Welcome to A2Z\./.test(src) && /A connected experience, designed for you\./.test(src) && /© A2Z Creative Marketing/.test(src));
  ok("the right side says Sign in / Securely access your account", /L\("Sign in", "Log masuk"\)/.test(src) && /Securely access your account\./.test(src) && /Akses akaun anda dengan selamat\./.test(src));
  ok("no Create account on the page, and no register call", !/auth\/register|Create account|Buat akaun/.test(code));
  ok("every failed sign-in says the one sentence", /const FAILED: \[string, string\] = \["Unable to sign in with the provided credentials\.", "Tidak dapat log masuk dengan maklumat yang diberikan\."\];/.test(src)
     && /\} else \{\s*setError\(L\(\.\.\.FAILED\)\);/.test(code) && /if \(q\.get\("error"\) === "oauth"\) setError\(LE\(\.\.\.FAILED\)\);/.test(code)
     && !/account is inactive|already exists|API Worker|not be deployed/i.test(code));
  ok("no company address in a placeholder", !/@a2zcreative/.test(code));
  const worker = read("worker/src/index.ts");
  const cb = worker.slice(worker.indexOf('const OAUTH_FAILED = "/login?error=oauth";'), worker.indexOf('const roleRow = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`)'));
  ok("every Google failure lands on /login, one way", cb.length > 500 && (cb.match(/Location: OAUTH_FAILED/g) ?? []).length === 5 /* v1.238.0 - +1: a Google account other than the linked one */ && !/\/admin\?(error|pending)/.test(worker));
  ok("the server still answers a bad password and a missing account the same", /return errorResponse\("invalid_credentials", "Email or password is incorrect", 401\);/.test(worker) && /DUMMY_PASSWORD_HASH/.test(worker));
}

console.log(failed === 0
  ? `login-ux: ${passed} checks passed.`
  : `\n${failed} login-ux check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
