# CONTRIBUTING.md

**Version:** v1.3.0 — workspace conventions. Supersedes the single-app guidance
from v1.2.x (History below).

## Where code goes

| Change | Location |
|---|---|
| Behaviour shared by two or more sites | `packages/*` |
| Copy, routes, palette for one site | `apps/<app>/` |
| API, auth, database | `worker/` |

**The boundary rule: a package may never import from an app.** If a shared
component needs client-specific information, take it as a prop or config
object. Concretely — `PageShell` does not render chrome, `FaqList` receives its
questions, `WhatsAppFab` receives an href. Breaking this rule is how a shared
package quietly becomes a second copy of one site.

## Styling

Shared components use semantic tokens only: `bg-brand`, `text-gold`,
`border-border`, `text-muted-foreground`, `bg-secondary`. Never a raw hex, never
`bg-[#1a2946]`. Each app maps those tokens to its own palette in
`styles/globals.css`. That is what lets one `Button` serve a navy agency and a
taupe fashion label.

## Adding a client site

1. Copy `apps/elfia` as a starting point.
2. Replace `constants/brand.ts` and `constants/seo.ts`; choose a new `CMS_SITE` key.
3. Write the palette in `styles/globals.css`.
4. Add the origin to the Worker's `SITE_ORIGINS`.
5. Create a Cloudflare Pages project building from the repository root.

No package should need editing. If one does, that is a signal the abstraction is
wrong — fix the package rather than forking it.

## Before opening a PR

```bash
pnpm typecheck
pnpm lint
pnpm build          # both apps
```

## Documentation

Docs are append-only for history. Add a row to the relevant History table; never
delete an existing entry. Update `CHANGELOG.md` (newest first) and
`MILESTONES.md` (appended).

## History (do not remove)
| Version | Conventions |
|---|---|
| v1.2.x | Single app; components in `components/`, imports via `@/`. |
| v1.3.0 | Workspace; shared code in `packages/*` under the no-app-imports rule; semantic-token styling; per-app palettes. |
