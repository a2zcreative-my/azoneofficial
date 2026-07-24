# Admin Guide

> The admin v0 is LIVE at `/admin` (after Worker deploy + first super admin creation — see worker/README.md).

## Using admin v0
1. Visit azoneofficial.com/admin and sign in
2. **Dashboard** — enquiry and product counts
3. **Enquiries** — every contact-form submission with a status workflow: new → contacted → qualified → closed
4. **Products / Posts / Portfolio / Testimonials** — create, edit, delete; public pages show only published/visible items
5. Not yet in the UI: media upload screen, site-content editor, user management (API supports content + media already)

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
