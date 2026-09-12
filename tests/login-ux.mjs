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
 *   9. THE FORGOTTEN PASSWORD IS ANSWERED HONESTLY. There is no self-service
 *      reset in this system; the page says an administrator sets one.
 *  10. STILL BILINGUAL, STILL STATIC-EXPORT SAFE. Every string is L(en, ms),
 *      and the language is read in an effect - never at module scope, which
 *      would render "en" into login.html and "ms" on the client (v1.27.0).
 *
 * Negative-tested by: dropping the <form> for a bare div (2); removing a
 * label (3); swapping inputClassLg for inputClass (4); putting
 * `disabled={!email || !password}` back on the submit (5); removing
 * autoComplete="one-time-code" (8); dropping the svh/safe-area column (1).
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
const styles = read("lib/ui-styles.ts");
const i18n = read("lib/i18n.ts");

/* ---- 1. two shapes, one page ---- */
{
  ok("from lg up the page is a two-column grid", /className="lg:grid lg:min-h-\[100svh\] lg:grid-cols-2"/.test(src));
  ok("the brand panel is beside the form and a phone never draws it", /function BrandPanel\(/.test(src) && /hidden[^"]*lg:flex/.test(src) && /<BrandPanel lang=\{lang\} \/>/.test(src));
  ok("nothing needed to sign in lives in the brand panel", (() => {
    const panel = src.slice(src.indexOf("function BrandPanel("), src.indexOf("/* ── the page ──"));
    return !/<input|<form|type="submit"|auth\/google/.test(panel);
  })());
  /* the v1.29.2 phone fix, kept verbatim: svh, not vh, and the home indicator */
  ok("the form column is a centred svh column with the safe-area inset (v1.29.2 kept)",
    /flex min-h-\[100svh\] w-full max-w-sm flex-col justify-center/.test(src) && /pb-\[max\(1\.5rem,env\(safe-area-inset-bottom\)\)\]/.test(src));
  ok("and it is not capped at phone width on a desk", /lg:max-w-md/.test(src));
}

/* ---- 2. a real form ---- */
{
  ok("sign-in is a <form> that submits", /<form className="space-y-4" noValidate onSubmit=\{\(e\) => \{ e\.preventDefault\(\); if \(!busy\) void submit\(\); \}\}>/.test(src));
  ok("the code screen is a <form> too", /<form\s+className="mt-5 space-y-4"\s+onSubmit=/.test(src));
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
  ok("...and inputClassLg really is 16px on a phone", /export const inputClassLg[\s\S]*?text-base[\s\S]*?sm:text-sm/.test(styles));
  ok("the email field asks for the email keyboard and no autocapitalise", /inputMode="email"/.test(src) && /autoCapitalize="none"/.test(src));
  ok("the password field keeps its autocomplete contract", /autoComplete=\{mode === "register" \? "new-password" : "current-password"\}/.test(src) && /autoComplete="username"/.test(src));
  ok("the password can be revealed, and the toggle says which state it is in", /aria-pressed=\{showPw\}/.test(src) && /aria-label=\{showPw \? L\("Hide password"/.test(src));
  ok("Caps Lock is reported instead of a silent wrong password", /getModifierState\?\.\("CapsLock"\)/.test(src) && /Caps Lock is on/.test(src));
}

/* ---- 5. the button is never born dead ---- */
{
  ok("the submit is disabled only while a request is in flight", /<button type="submit" className=\{btnClassBlock\} disabled=\{busy\}>/.test(src));
  ok("and what is missing is said in words", /Please enter your email address/.test(src) && /Please enter your password/.test(src) && /Sila masukkan kata laluan anda/.test(src));
  ok("the password floor is stated, not merely enforced", /Your password needs at least 10 characters/.test(src));
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
  ok("the code field autofills from the authenticator / SMS", /autoComplete="one-time-code"/.test(src) && /inputMode="numeric"/.test(src));
  ok("a pasted code is stripped to six digits", /const next = raw\.replace\(\/\\D\/g, ""\)\.slice\(0, 6\);/.test(src));
  ok("the sixth digit signs in by itself", /if \(next\.length === 6 && !busy\) void verifyCode\(next\);/.test(src));
  ok("and it cannot fire twice", /if \(verifying\.current\) return;/.test(src));
  ok("the code is verified with the value just typed, not with stale state", /const verifyCode = async \(value: string\)/.test(src) && /body: JSON\.stringify\(\{ challenge, code: value \}\)/.test(src));
}

/* ---- 9 + 10. honest help, and still bilingual ---- */
{
  ok("the forgotten password is answered with what actually happens", /Forgot your password\?/.test(src) && /There is no self-service reset on this system/.test(src) && /Users tab/.test(src));
  ok("the help is disclosed, not always shouting", /aria-expanded=\{helpOpen\}/.test(src));
  const bare = [...src.matchAll(/>([A-Z][A-Za-z' ]{6,})</g)].map((m) => m[1].trim())
    .filter((t) => !/^(A2Z|EN|BM)/.test(t));
  ok("no bare English string is rendered outside L(en, ms)", bare.length === 0, bare.slice(0, 3).join(" · "));
  ok("the language is read in an effect, never at module scope (static export)",
    /useEffect\(\(\) => \{ setLangState\(getLang\(\)\); \}, \[\]\);/.test(src) && !/^const lang = getLang\(\)/m.test(src));
  ok("the build stamp is still on the page", /v\{APP_VERSION\}/.test(src));
}

console.log(failed === 0
  ? `login-ux: ${passed} checks passed.`
  : `\n${failed} login-ux check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;
