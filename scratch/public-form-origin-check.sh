#!/usr/bin/env bash
# v1.29.3 — proves the ONE cross-site door is exactly one door.
#
#   cd worker && npx wrangler dev --local --port 8788     # then, elsewhere:
#   bash scratch/public-form-origin-check.sh
#
# Expected: 201 for the enquiry form from azoneofficial.com (and its www
# twin), 403 for ANY other route from that origin, 403 for any other origin.
set -u
B="${1:-http://127.0.0.1:8788}"
pass=0; fail=0
check () { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ok   $1 ($3)"; pass=$((pass+1));
  else echo "  FAIL $1 — expected $2, got $3"; fail=$((fail+1)); fi
}
code () { curl -s -o /dev/null -w '%{http_code}' "$@"; }
J='Content-Type: application/json'
BODY='{"name":"Guard","message":"origin scope check"}'

check "enquiry from consultancy site"  201 "$(code -X POST "$B/api/v1/enquiries" -H 'Origin: https://azoneofficial.com'     -H "$J" -d "$BODY")"
check "enquiry from its www twin"      201 "$(code -X POST "$B/api/v1/enquiries" -H 'Origin: https://www.azoneofficial.com' -H "$J" -d "$BODY")"
check "enquiry from A2Z itself"        201 "$(code -X POST "$B/api/v1/enquiries" -H 'Origin: https://a2zcreative.my'        -H "$J" -d "$BODY")"
check "enquiry from a stranger"        403 "$(code -X POST "$B/api/v1/enquiries" -H 'Origin: https://evil.example'          -H "$J" -d "$BODY")"
check "LOGIN from consultancy site"    403 "$(code -X POST "$B/api/v1/auth/login" -H 'Origin: https://azoneofficial.com'    -H "$J" -d '{"email":"a@b.com","password":"x123456789"}')"
check "register from consultancy site" 403 "$(code -X POST "$B/api/v1/auth/register" -H 'Origin: https://azoneofficial.com' -H "$J" -d '{"email":"a@b.com","name":"A","password":"x123456789"}')"

acao=$(curl -s -i -X OPTIONS "$B/api/v1/enquiries" -H 'Origin: https://azoneofficial.com' -H 'Access-Control-Request-Method: POST' | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')
check "preflight echoes the form origin" "https://azoneofficial.com" "$acao"

echo "  ---- $pass passed, $fail failed"
[ "$fail" -eq 0 ]
