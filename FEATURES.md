# Features

## Public website (implemented)
- **Home** — hero with live-pulse badge, about + animated statistics, services grid, session showcase, ELFIA dark section, 4-step process, FAQ accordion, consultation CTA
- **About** — agency story, Why Choose Us (6 points)
- **Services** — 6 services: live host service, live commerce management, TikTok strategy, creative design, video editing & content creation, business consultation
- **Products (ELFIA)** — brand page with categories; purchases happen during TikTok Live sessions
- **Portfolio / Case Studies** — data-driven; render honest "in preparation" states while `PORTFOLIO_ITEMS` / `CASE_STUDIES` arrays are empty
- **Blog** — static blog from `constants/pages.ts`; 2 starter posts; per-post routes via `generateStaticParams`
- **Careers** — open-interest page (hosts, live ops, creative)
- **FAQ** — standalone route
- **Contact** — WhatsApp-first, email, address, embedded Google Map, socials
- **Legal** — Privacy Policy (PDPA-aware), Terms & Conditions
- **SEO** — metadata templates, OG/Twitter images, sitemap, robots, JSON-LD
- **Accessibility** — keyboard focus, aria attributes on accordion/menu, reduced-motion respected

## Content management (current)
- All content lives in `constants/` (site.ts, content.ts, pages.ts) — edited in code, deployed via git push

## Admin & API (implemented)
- API Worker (`/worker`): auth + sessions, RBAC, rate limiting, audit logging, enquiries, full CRUD (products/posts/portfolio/testimonials), site content, R2 media
- Contact form on /contact storing enquiries (WhatsApp fallback)
- Admin UI at /admin: dashboard, enquiry workflow, CRUD panels

- Admin Media/Content/Users screens; dashboard activity feed
- ELFIA product detail pages with galleries; portfolio + testimonials read published D1 content at runtime (static fallback)

## Not yet implemented
- Hero/about/services site-content reads on public pages (Content API + editor exist; wiring is per-section as content gets created), blog posts from D1 (static posts remain source of truth), ELFIA RM pricing (awaiting decision — "announced live" shown meanwhile) — see ROADMAP.md
