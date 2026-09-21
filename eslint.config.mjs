/* v1.172.0 — Next.js 16. `next lint` is gone from the framework and
   eslint-config-next now ships flat-config arrays, so the FlatCompat shim
   that translated the old "next/core-web-vitals" string presets is not
   needed and would not understand the new exports. The presets are imported
   directly; the house rules below are unchanged from v1.100.1. */
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      /* v1.172.0 — eslint-config-next 16 brings eslint-plugin-react-hooks 7,
         whose recommended set now includes the React Compiler's own checks
         (set-state-in-effect, purity, refs, immutability,
         preserve-manual-memoization) as ERRORS. They did not exist in the
         v15 rule set; this project does not enable the compiler; and on the
         day of the upgrade they flagged 123 places in working business
         screens - attendance, payroll, sales, the roster - that a framework
         migration must not rewrite. Every pre-upgrade rule keeps its
         severity. These five are reported as WARNINGS so the findings stay
         on screen for the pass that adopts the compiler, without a version
         bump silently changing what `npm run ci` refuses. Not off. */
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    /* v1.100.1 — the desktop app drops delivered files into "Claude outputs"
       inside this project; they are duplicates of files that live elsewhere
       and linting them fails the build on imports that only resolve from
       their real home. */
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "Claude outputs/**"],
  },
];

export default eslintConfig;
