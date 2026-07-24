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
