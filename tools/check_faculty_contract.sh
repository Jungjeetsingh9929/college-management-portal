#!/usr/bin/env bash
set -euo pipefail
TOKEN="$(node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync("/tmp/faculty-login.json","utf8")).token)')"
for endpoint in /api/subjects /api/faculty/students /api/faculty/schedule; do
  name="$(echo "$endpoint" | tr '/' '_')"
  curl -sS "http://127.0.0.1:5055$endpoint" -H "Authorization: Bearer $TOKEN" > "/tmp/faculty${name}.json"
  echo "--- $endpoint"
  wc -c "/tmp/faculty${name}.json"
  rg -o 'Operating Systems|Data Structures|CSE 3A|classes[^]]*' "/tmp/faculty${name}.json" | head -20 || true
 done
