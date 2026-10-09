#!/usr/bin/env bash
#
# Cron wrapper for retention — deletes R2 recordings older than the retention
# window (default 90 days) and clears their links in `calls`. See
# src/retention.ts for exactly what is and isn't deleted.
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

if [ ! -f dist/retention.js ]; then
  echo "$(date -Is) FATAL: dist/retention.js missing — run 'npm run build' in $APP_DIR" >> "$LOG"
  exit 1
fi

# Skip the run if the previous one is somehow still going.
exec flock -n "$LOCK" node dist/retention.js \
  --apply \
  --quiet \
  --days "${RETENTION_DAYS:-90}" \
  --max-delete "${RETENTION_MAX_DELETE:-3000}" \
  >> "$LOG" 2>&1
