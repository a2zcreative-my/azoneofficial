# User Guide (public website)

## For visitors
- **Book a consultation**: every "Book free consultation" / WhatsApp button opens WhatsApp (+60 12-383 4821) with a pre-filled message
- **ELFIA**: browse `/products`; purchases happen during TikTok Live sessions — follow the TikTok link to catch drops
- **Contact**: `/contact` has WhatsApp, email, address, and a map

## For the AZ ONE team (until the admin CMS ships)
All content is edited in code, then pushed to deploy:
- **Company info / nav / tagline** → `constants/site.ts`
- **Contact details, services, stats, FAQ, ELFIA products** → `constants/content.ts`
- **Why-us, portfolio, case studies, blog posts, careers** → `constants/pages.ts`
- **ELFIA photos** → add files to `public/elfia/` and set `imageSrc` in `constants/content.ts`
- Portfolio/case-study/testimonial sections appear automatically once their arrays have entries

After editing: commit → push → Cloudflare deploys.

## Staff Portal (/portal)
Sign in at /admin, then open /portal. Everyone: clock in/out and breaks, attendance history, apply/cancel leave and see balances, tasks, announcements (acknowledge), notifications, profile (phone editable), light/dark mode. Managers (MD/COO/Admin/Live Manager): approve/reject leave, team attendance report, post announcements, assign tasks, HR fields in staff directory. Sales roles (BD/Finance/MD/Admin): customers + quotations/DO; invoices are finance-only. Live Hosts see only their own attendance, leave, tasks, announcements, and profile.
