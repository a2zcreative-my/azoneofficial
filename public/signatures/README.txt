v1.38.0 — the real signature PNGs were removed from this folder.

They were publicly downloadable by anyone (no login) and are now served only
from the private R2 vault, through authenticated routes:
  staff:    GET /api/v1/staff/signature/<role>-sign.png   (session required)
  customer: GET /api/v1/public/doc-signature?t=<share token>

The 1x1 transparent placeholders here exist only so stale cached HTML that
still references the old paths renders a blank instead of a broken image.
tests/no-public-signatures.mjs fails the build if a real image ever returns.

Upload the real PNGs once, in /admin -> Staff -> Signatures. Because the old
files were public for an unknown period, treat them as compromised: re-scan
fresh signatures rather than re-uploading the leaked ones.
