#!/usr/bin/env bash
#
# Deploy origin/main on the droplet (API + FTP service; the web app is on Vercel).
#
#   bash /root/CallFlow/scripts/deploy.sh [migration.sql ...]
#
# Fast-forward only: if the checkout has diverged or has local edits, this stops
# rather than overwriting anything. Migrations named on the command line are
# applied one by one (see apps/api/scripts/migrate-one.js). Does not run
# `npm install` — do that by hand when a package.json changes.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "== pull"
git pull --ff-only origin main
git log --oneline -1

echo "== build api"
(cd apps/api && npm run build --silent)

for m in "$@"; do
  echo "== migrate $m"
  (cd apps/api && node scripts/migrate-one.js "$m")
done

echo "== build ftp-service"
(cd apps/ftp-service && npm run build --silent)

echo "== restart"
pm2 restart api-server ftp-receiver >/dev/null
sleep 4
pm2 ls

echo "== ffmpeg"
command -v ffmpeg >/dev/null && ffmpeg -version | head -1 || echo "ffmpeg NOT installed — recordings stay WAV"
pm2 logs ftp-receiver --lines 20 --nostream 2>/dev/null | grep -i ffmpeg | tail -1 || true
