/* v1.23.4 — the ONE visible version number. Rendered in the portal's More
   sheet and on the login page so "is the live site actually on the new
   build?" is answerable by glancing at a phone instead of guessing. The
   value comes from package.json at build time — DEPLOY.bat rebuilds the
   site, so what you see is what is deployed (for the SITE; the API worker
   deploys in step 3 and can still lag if that step is skipped). */

import pkg from "../package.json";

export const APP_VERSION: string = pkg.version;
