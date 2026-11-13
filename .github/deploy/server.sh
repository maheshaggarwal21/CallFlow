#!/usr/bin/env bash
# Runs ON the droplet, piped in by .github/workflows/deploy.yml (env: SHA, STAMP).
# Backup → copy of the live web app → pull to SHA → npm ci if the lockfile changed → build API →
# migrations ADDED since the running commit, in filename order → restart API. Stops at the first error.
set -euo pipefail
cd /root/CallFlow

DB=$(grep -E '^DATABASE_URL=' apps/api/.env | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
# pg_dump can't go through the pgbouncer pooler: strip the query and use the session port
DUMP_DB=$(echo "${DB%%\?*}" | sed -E 's/:6543\//:5432\//')
mkdir -p /root/backups
pg_dump "$DUMP_DB" -Fc -f "/root/backups/pre-update-$STAMP.dump"
echo "backup: /root/backups/pre-update-$STAMP.dump ($(du -h "/root/backups/pre-update-$STAMP.dump" | cut -f1))"
cp -a /var/www/callflow "/var/www/callflow.prev-$STAMP"

OLD=$(git rev-parse HEAD)
git fetch -q origin main
git merge --ff-only -q "$SHA"
echo "code: ${OLD:0:7} → $(git log --oneline -1)"

cd apps/api
if ! git diff --quiet "$OLD" HEAD -- package-lock.json; then echo "dependencies changed: npm ci"; npm ci --no-audit --no-fund; fi
npm run build --silent
for f in $(git diff --name-only --diff-filter=A "$OLD" HEAD -- src/db/migrations/ | sort); do
  node scripts/migrate-one.js "$(basename "$f")"
done
pm2 restart api-server >/dev/null
echo "api-server restarted"

