#!/usr/bin/env bash
# Cek cepat endpoint Auth dan REST di server.
# Pemakaian:
#   bash deploy/scripts/healthcheck.sh
#   bash deploy/scripts/healthcheck.sh https://pc.tailxxxx.ts.net
set -euo pipefail

BASE="${1:-http://127.0.0.1:8080}"

echo "== Auth =="
curl -fsS --max-time 10 "$BASE/auth/v1/health"
echo

echo "== REST =="
STATUS="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/rest/v1/")"
echo "HTTP $STATUS"
if [[ "$STATUS" != "200" ]]; then
    echo "REST belum siap."
    exit 1
fi

echo
echo "Kedua endpoint merespons."
