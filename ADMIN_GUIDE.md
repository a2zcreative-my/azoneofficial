# Admin Guide

> The admin v0 is LIVE at `/admin` (after Worker deploy + first super admin creation — see worker/README.md).

## Using admin v0
1. Visit azoneofficial.com/admin — sign in with email+password or **Continue with Google**. New teammates can self-register (any valid email); their accounts stay pending until a super admin activates them in **Users**. Google accounts on @azoneofficial.com are approved automatically.
2. **Dashboard** — enquiry and product counts
3. **Enquiries** — every contact-form submission with a status workflow: new → contacted → qualified → closed
4. **Products / Posts / Portfolio / Testimonials** — create, edit, delete; public pages show only published/visible items
5. **Media** — upload files to R2, preview images, copy public URLs, delete
6. **Content** — no-code website edits. These keys are LIVE on the public site (set them and the page updates within a minute, no deploy):
   - `home.hero.headline` · `home.hero.subheadline` — homepage hero
   - `about.body1` · `about.body2` — About section paragraphs
   - `home.cta.heading` — closing CTA headline
   - `footer.slogan` — footer tagline
   - `contact.intro` — Contact page opening line
   Other keys can be saved for future wiring; values can be text or JSON
7. **Users** (super admin only) — add team members, change roles, activate/deactivate (deactivation revokes sessions), reset passwords

## Roles & permissions (planned)
| Capability | Super Admin | Admin | Editor | Marketing |
|---|---|---|---|---|
| Manage users & roles | ✅ | — | — | — |
| Edit site content / menus / SEO | ✅ | ✅ | ✅ | — |
| Products / portfolio / blog / media / testimonials | ✅ | ✅ | ✅ | — |
| View & manage enquiries/leads | ✅ | ✅ | — | ✅ |
| View dashboard analytics | ✅ | ✅ | ✅ | ✅ |
| Audit log | ✅ | ✅ | — | — |

## Content editing principle
No code changes should be required to update website content. Every editable string maps to a `site_content` key (DATABASE.md).

## Until Phase 3 ships
Content is edited in `constants/*.ts` and deployed by git push — see USER_GUIDE.md.
