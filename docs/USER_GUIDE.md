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

## Login (/login)
One login for everyone. The password field has a show/hide eye toggle if you want to check what you've typed. During registration you'll see live feedback on password length. After signing in (email/password or Google) you are routed automatically: customers → /account, operational staff → /portal, admin/CMS roles → /admin. Registration is open and creates a customer account instantly; staff access is assigned by administrators in Admin → Users.

## Customer account (/account)
Your details, your enquiry history (enquiries sent from the contact page with your email appear here with live status), and quick links to ELFIA.

## Staff Portal (/portal)
Sign in at /login, then open /portal. Everyone: clock in/out and breaks, attendance history, apply/cancel leave and see balances, tasks, announcements (acknowledge), notifications, profile (phone editable), light/dark mode. Managers (MD/COO/Admin/Live Manager): approve/reject leave, team attendance report, post announcements, assign tasks, HR fields in staff directory. Sales roles (BD/Finance/MD/Admin): customers + quotations/DO; invoices are finance-only. Live Hosts see only their own attendance, leave, tasks, announcements, and profile.


## Staff guide — role modules (v1.4.4)

Sign in at /login with your @azoneofficial.com Google account. You land in the
staff portal (/portal); your role decides which tabs you see.

**Everyone:** clock in and out in *Attendance* (shift is 10:00am–6:00pm MYT,
Monday–Friday — late clock-ins and early clock-outs are flagged for HR
automatically), apply for Annual / Medical / Emergency leave in *Leave*, and
change your password in *Profile* (Google accounts manage theirs with Google).

**HR & Administrative:** the *HR* tab shows the attendance verification table
for every staff member with a shift check per event; file your daily, weekly,
or monthly task report there; staff birthdays list at the side. Approve or
reject leave in *Leave*. Create quotations, delivery orders, and invoices in
*Sales* — numbers are issued automatically as QT-AZOODDMMYY-X.

**Sales & Marketing:** the *Inventory* tab holds live stock (use +/− to adjust
— status updates itself), postage tracking (set each order's status as it
moves), and marketing material requests (request what sales needs; mark done
when produced).

**Chief Commercial Officer:** the *Commercial* tab is the BD pipeline — add a
prospect, then keep its status honest: open, pending, KIV, closed won, or
closed lost, with your strategy and next action on the record.

**Chief Operation Officer:** the *Operations* tab takes one report per day —
operational status, sales results, and your strategy note for sales &
marketing. Submitting the same date again updates it.

**Chief Executive Officer:** the *Overview* tab is the whole company at a
glance — read-only by design.

## History (do not remove)
| Version | Change |
|---|---|
| v1.4.4 | Staff guide for the five role modules added. |
