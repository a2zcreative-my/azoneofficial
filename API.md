# API

## Current
No API — the site is fully static. Leads arrive via WhatsApp deep links (`https://wa.me/60123834821`) and email.

## Phase 3 — IMPLEMENTED in `/worker`: health · enquiries (POST public rate-limited, GET/PATCH marketing+) · auth (login rate-limited/logout/me) · dashboard summary · content GET/PUT · media upload/serve/delete (R2) · full CRUD for products/posts/portfolio/testimonials (editor+ write, admin+ delete, public reads filtered). Also implemented: GET /content (editor+ listing) · users management (GET/POST /users, PATCH /users/:id — super_admin only) · dashboard summary now includes posts/testimonials counts and recent audit activity. Table below is the reference.
Base: `/api/v1`, JSON, session-cookie auth for admin routes.

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | /auth/login | public (rate-limited) | Create session |
| POST | /auth/logout | session | Destroy session |
| GET | /content/:key | public | Read site content |
| PUT | /content/:key | editor+ | Update site content |
| GET/POST | /products | public / editor+ | List / create products |
| GET/PUT/DELETE | /products/:id | public / editor+ | Read / update / delete |
| POST | /enquiries | public (rate-limited) | Contact form submission |
| GET/PATCH | /enquiries/:id | marketing+ | Read / update status |
| CRUD | /posts, /portfolio, /testimonials, /media | editor+ | Content management |
| GET | /dashboard/summary | admin+ | Stats for dashboard |

Error format: `{ "error": { "code": string, "message": string } }`. All request bodies validated with Zod; responses typed in `types/`.
