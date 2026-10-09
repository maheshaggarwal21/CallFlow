#!/usr/bin/env bash
#
# Nightly storage upkeep:
#   1. retention  — deletes R2 recordings older than the retention window
#                   (default 90 days) and clears their links in `calls`
#   2. recompress — converts any WAV still stored and older than 16 days to the
#                   Settings-page format (only pre-2026-10-09 recordings or FTP
#                   compression fallbacks; usually nothing to do)
# See src/retention.ts and src/recompress.ts for the details and safeguards.
#
# Install (as the user that owns the CallFlow checkout):
#   chmod +x apps/api/scripts/retention-cron.sh
#   crontab -e
#   # daily at 02:30 IST (21:00 UTC — the droplet runs in UTC):
#   0 21 * * * /root/CallFlow/apps/api/scripts/retention-cron.sh >> /dev/null 2>&1
#
# Logged to $LOG_DIR/retention.log: one line per night that deletes something,
# plus any failure. A run that matches more than RETENTION_MAX_DELETE objects
# refuses and logs why, rather than deleting.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${RETENTION_LOG_DIR:-$APP_DIR/logs}"
LOG="$LOG_DIR/retention.log"
LOCK="${RETENTION_LOCK:-/tmp/callflow-retention.lock}"

mkdir -p "$LOG_DIR"

# Keep the log from growing without bound (10 MB, one generation).
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 10485760 ]; then
  mv -f "$LOG" "$LOG.1"
fi

cd "$APP_DIR"

for f in dist/retention.js dist/recompress.js; do
  if [ ! -f "$f" ]; then
    echo "$(date -Is) FATAL: $f missing — run 'npm run build' in $APP_DIR" >> "$LOG"
    exit 1
  fi
done

run_upkeep() {
  node dist/retention.js --apply --quiet \
    --days "${RETENTION_DAYS:-90}" \
    --max-delete "${RETENTION_MAX_DELETE:-3000}"
  # One CPU on the droplet: cap the night's work so it can't run into the
  # morning's FTP uploads; anything left over is picked up the next night.
  node dist/recompress.js --apply --quiet \
    --limit "${RECOMPRESS_LIMIT:-2000}" \
    --concurrency 1
}

# Skip the run if the previous one is somehow still going.
exec flock -n "$LOCK" bash -c "$(declare -f run_upkeep); cd '$APP_DIR'; run_upkeep" >> "$LOG" 2>&1
