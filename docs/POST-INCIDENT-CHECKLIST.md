# POST-INCIDENT-CHECKLIST.md (v1.4.12)

After the master-password backdoor removal. Do the steps in order — the first
group runs BEFORE deploying the fix, so you don't lock yourself out.

## Before deploying v1.4.12
- [ ] Signed in on your working super admin session, open /admin → Users
- [ ] Reset password on your SECOND super admin account (set one you know)
- [ ] Sign out; sign in as that second account with its new password (proves
      real-password login works for you)
- [ ] From there, Reset password on the first super admin account
- [ ] Reset password on every other password account (hand each over directly)

## Deploy
- [ ] `cd worker && npx wrangler deploy`   (no migration needed)
- [ ] Rebuild and push the site

## After deploying
- [ ] /admin → Users → Force logout on EVERY account (clears backdoor-era sessions)
- [ ] Each person signs in and changes their password in Profile / Account
- [ ] Verify: try signing in with the old master string — it must now fail

## Wider hygiene
- [ ] Treat the string as public (it was in the repo / git history)
- [ ] If it was reused anywhere else, change it there too
- [ ] Confirm the Google super admin (aliffarhan1997@gmail.com) still signs in
      — that account is your password-independent recovery path

## Verified correct (no action needed)
- Stored data (attendance, leave, roles, password hashes) was never affected
- Session tokens are stored hashed; each request re-checks expiry + active user
- Password change / reset / suspend already revoke sessions
