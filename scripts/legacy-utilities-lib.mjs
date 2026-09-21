/* v1.172.2 - shared helpers for the frozen legacy utility sheet
 * (styles/legacy-utilities.css): read which classes it defines, find which
 * class-like tokens the source tree references, and prune the sheet.
 *
 * Used by tests/tailwind-retired.mjs (the guard) and
 * scripts/prune-legacy-utilities.mjs (the shrink tool). No dependencies.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* ---- source scanning ------------------------------------------------- */
export const SOURCE_DIRS = ["app", "components", "lib", "hooks", "constants"];

export function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) { if (!["node_modules", ".next", "out"].includes(n)) walk(p, out); }
    else if (/\.(tsx?|mjs|js)$/.test(n)) out.push(p);
  }
  return out;
}

/* Block comments are blanked (a `/*` glued to a word - `image/*` - is not a
   comment); line comments dropped. */
export const stripComments = (s) =>
  s.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");

/* The string literals of a source file, each as {toks, before}: the
   whitespace-separated tokens of the literal, and the 24 characters of code
   before it (so a lone "hidden" can be told apart from className="hidden").
   A `${...}` inside a template literal is JavaScript again and may hold its
   own quoted class strings (`${on ? "erp-chip-success" : "mt-2"}`), so it is
   scanned recursively. */
export function classTokensOf(source) {
  return literalsOf(stripComments(source));
}
function literalsOf(src, out = []) {
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(src))) {
    let s = m[1] ?? m[2] ?? m[3] ?? "";
    const before = src.slice(Math.max(0, m.index - 24), m.index);
    if (m[3] !== undefined) {
      let cleaned = "";
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "$" && s[i + 1] === "{") {
          let d = 1, j = i + 2;
          while (j < s.length && d > 0) { if (s[j] === "{") d++; else if (s[j] === "}") d--; j++; }
          literalsOf(s.slice(i + 2, j - 1), out);
          cleaned += " ";
          i = j - 1;
        } else cleaned += s[i];
      }
      s = cleaned;
    }
    const toks = s.split(/\s+/).filter(Boolean);
    if (toks.length) out.push({ toks, before, template: m[3] !== undefined });
  }
  return out;
}

/* Is this literal a CLASS string? Never when it reads as prose or as a CSS
   value (a capitalised word, trailing punctuation, a bare number or unit).
   Otherwise yes when it names an .erp-* class, when a known legacy class in
   it carries a hyphen, colon or bracket (no English word looks like `mt-2`),
   when two or more tokens are known classes, or when a single known class
   is written straight into a className / class attribute. A lone "hidden"
   in an attribute value, a "fixed" in a style object, a "table" in a
   sentence: not class strings. */
const PROSE = /[.,;:!?'"()]$|^[\d.]+(?:s|ms|px|%|deg|rem|em|vh|vw)?$|^[A-Z][a-z]/;
export function isClassString({ toks, before }, defined) {
  if (toks.some((t) => PROSE.test(t))) return false;
  if (toks.some((t) => t.startsWith("erp-"))) return true;
  const known = toks.filter((t) => defined.has(t));
  if (known.length === 0) return false;
  if (known.some((t) => /[-:\[]/.test(t))) return true;
  if (known.length >= 2) return true;
  return /(?:className|class)\s*=\s*\{?\s*$/.test(before) || /className=\{`[^`]*$/.test(before);
}

/* Every legacy class each file references from its class strings. */
export function legacyRefsOf(source, defined) {
  const refs = new Set();
  for (const lit of classTokensOf(source)) {
    if (!isClassString(lit, defined)) continue;
    for (const t of lit.toks) if (defined.has(t)) refs.add(t);
  }
  return refs;
}

/* What a Tailwind utility looks like. Deliberately the FAMILIES the tree
   used, not the whole grammar: a token is only judged when it carries a
   hyphen, a colon or a bracket (so prose words are never mistaken), and
   only inside a string that already holds a known class. */
const VARIANT = /^(?:sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl|dark|hover|focus|focus-visible|focus-within|active|disabled|first|last|odd|even|group-hover|peer-checked|motion-reduce|print|aria-[a-z]+|data-\[[^\]]*\]|\[&[^\]]*\]|\*|has-\[[^\]]*\]|supports-\[[^\]]*\]|selection|placeholder|checked|open|empty|only|not-first|not-last|nth-\[[^\]]*\]):/;
const FAMILY = /^-?(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|ms|me|w|h|min-w|min-h|max-w|max-h|size|gap|gap-x|gap-y|space-x|space-y|text|bg|border|border-[trblxy]|rounded|rounded-[trblse]{1,2}|shadow|ring|ring-offset|opacity|z|top|left|right|bottom|inset|inset-x|inset-y|flex|grid|grid-cols|grid-rows|col|col-span|row|row-span|order|font|leading|tracking|items|justify|justify-self|justify-items|self|place|place-items|place-content|content|overflow|overflow-x|overflow-y|whitespace|break|truncate|underline|underline-offset|decoration|uppercase|lowercase|capitalize|normal-case|tabular-nums|transition|duration|ease|delay|animate|cursor|select|pointer-events|outline|outline-offset|divide|divide-x|divide-y|translate|translate-x|translate-y|rotate|scale|scale-x|scale-y|transform|origin|object|aspect|columns|list|align|indent|hidden|block|inline|inline-flex|inline-block|inline-grid|contents|table|absolute|relative|fixed|sticky|static|shrink|grow|basis|visible|invisible|collapse|sr-only|not-sr-only|backdrop|blur|brightness|filter|isolate|resize|scroll|scroll-mt|scroll-mb|scroll-pt|snap|touch|will-change|accent|caret|fill|stroke|line-clamp|antialiased|italic|line-through|no-underline|container|prose|from|via|to|bg-gradient|backdrop-blur|mix-blend|appearance|box|float|clear|line-height|font-mono|font-sans|leading-none|leading-tight|tabular|slashed-zero|proportional-nums|drop-shadow|saturate|grayscale|invert|sepia|hue-rotate|contrast|perspective|skew|skew-x|skew-y|content-\[)(?:-|$|\[)/;

export function looksLikeUtility(tok) {
  if (tok.startsWith("erp-")) return false;
  if (/[;"'=<>{}$]|:$|^\(|\)$|\.$/.test(tok)) return false; // CSS text, JSX, prose
  if (/^[A-Za-z]+$/.test(tok) && !/^(?:flex|grid|hidden|block|inline|contents|table|absolute|relative|fixed|sticky|static|truncate|uppercase|lowercase|capitalize|underline|italic|antialiased|visible|invisible|collapse|isolate|shrink|grow|transition|transform|filter|resize|container|border|rounded|shadow|ring|outline|blur|invert|sepia|grayscale)$/.test(tok)) return false;
  let t = tok;
  let guard = 0;
  while (VARIANT.test(t) && guard++ < 4) t = t.replace(VARIANT, "");
  if (t.startsWith("!")) t = t.slice(1);
  if (/^\[(?:--|&)/.test(t) && t.endsWith("]")) return true; // arbitrary property / selector: [--x:1], [&>*]:p-2
  return FAMILY.test(t);
}

/* ---- the sheet ------------------------------------------------------- */
const unescape = (s) => s.replace(/\\(.)/g, "$1");

/* A tiny block parser: enough for the frozen sheet (at-rules containing
   rules; rules with opaque bodies, nested @supports inside them included). */
export function parseCss(text) {
  let i = 0;
  const parseBlock = (end) => {
    const nodes = [];
    while (i < text.length) {
      // leading whitespace / comments
      const ws = text.slice(i).match(/^\s*/)[0]; i += ws.length;
      if (i >= text.length) break;
      if (text[i] === "}") { if (end) { i++; } return nodes; }
      if (text.startsWith("/*", i)) { const j = text.indexOf("*/", i); nodes.push({ type: "comment", text: text.slice(i, j + 2) }); i = j + 2; continue; }
      // header up to `{` or `;`
      let j = i, depth = 0;
      while (j < text.length) {
        const ch = text[j];
        if (ch === "(" || ch === "[") depth++;
        else if (ch === ")" || ch === "]") depth--;
        else if (depth === 0 && (ch === "{" || ch === ";")) break;
        j++;
      }
      const header = text.slice(i, j).trim();
      if (text[j] === ";") { nodes.push({ type: "statement", text: header + ";" }); i = j + 1; continue; }
      i = j + 1; // past `{`
      const isContainer = /^@(?:media|layer|supports|container)\b/.test(header) && !/^@layer\s+properties\b/.test(header);
      if (isContainer || (header.startsWith("@") && /^@(?:media|layer|supports)/.test(header))) {
        const children = parseBlock(true);
        nodes.push({ type: "at", header, children });
      } else {
        // opaque body: match braces
        let k = i, d = 1;
        while (k < text.length && d > 0) { if (text[k] === "{") d++; else if (text[k] === "}") d--; k++; }
        nodes.push({ type: "rule", header, body: text.slice(i, k - 1) });
        i = k;
      }
    }
    return nodes;
  };
  return parseBlock(false);
}

export function serialize(nodes, indent = "") {
  let out = "";
  for (const n of nodes) {
    if (n.type === "comment") out += indent + n.text + "\n";
    else if (n.type === "statement") out += indent + n.text + "\n";
    else if (n.type === "rule") out += indent + n.header + " {" + reindent(n.body, indent) + indent + "}\n";
    else if (n.type === "at") out += indent + n.header + " {\n" + serialize(n.children, indent + "  ") + indent + "}\n";
  }
  return out;
}
function reindent(body, indent) {
  const lines = body.replace(/^\n+|\s+$/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  return "\n" + lines.map((l) => indent + "  " + l).join("\n") + "\n";
}

/* The first class of a rule's selector, unescaped (`.md\:flex` -> "md:flex"). */
export function classOfSelector(sel) {
  const s = sel.replace(/^:where\(/, "");
  const m = s.match(/^\.((?:\\.|[^\s{,:\\.>+~\[)])+)/);
  return m ? unescape(m[1]) : null;
}

export function definedClasses(nodes, out = new Set()) {
  for (const n of nodes) {
    if (n.type === "rule") { for (const part of n.header.split(/(?<!\\),/)) { const c = classOfSelector(part.trim()); if (c) out.add(c); } }
    else if (n.type === "at") definedClasses(n.children, out);
  }
  return out;
}

/* Remove every rule whose first class is not in `keep`; drop emptied at-rules. */
export function prune(nodes, keep) {
  const out = [];
  for (const n of nodes) {
    if (n.type === "rule") {
      const classes = n.header.split(/(?<!\\),/).map((p) => classOfSelector(p.trim())).filter(Boolean);
      if (classes.length === 0 || classes.some((c) => keep.has(c))) out.push(n);
    } else if (n.type === "at") {
      if (/^@layer\s+properties\b/.test(n.header)) { out.push(n); continue; }
      const kids = prune(n.children, keep);
      if (kids.some((k) => k.type !== "comment")) out.push({ ...n, children: kids });
    } else out.push(n);
  }
  return out;
}

/* Everything the tree references, per file, as {file: Set<token>}. */
export function referencedTokens(root, dirs = SOURCE_DIRS) {
  const files = dirs.flatMap((d) => walk(join(root, d)));
  const perFile = new Map();
  for (const f of files) {
    const set = new Set();
    for (const { toks } of classTokensOf(readFileSync(f, "utf8"))) for (const t of toks) set.add(t);
    perFile.set(relative(root, f).replace(/\\/g, "/"), set);
  }
  return perFile;
}
