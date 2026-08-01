#!/usr/bin/env bash
#
# Cron wrapper for fixClockDrift — corrects recordings mis-stamped by the
# KoreCall PBX clock (see src/fixClockDrift.ts for the full write-up).
#
# Install (as the user that owns the CallFlow checkout):
#   chmod +x apps/api/scripts/clockfix-cron.sh
#   crontab -e
#   # every hour, on the hour:
#   0 * * * * /srv/callflow/apps/api/scripts/clockfix-cron.sh >> /dev/null 2>&1
#
# Everything is logged to $LOG_DIR/clockfix.log; cron mail is suppressed above so
# you get one place to look rather than an inbox full of "nothing to do".
#
# NOTE: this is a MITIGATION. The PBX will keep mis-stamping until its RTC
# battery / NTP-on-boot is fixed. Treat a persistently non-empty log as a
# reminder that the hardware still needs attention.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${CLOCKFIX_LOG_DIR:-$APP_DIR/logs}"
LOG="$LOG_DIR/clockfix.log"
LOCK="${CLOCKFIX_LOCK:-/tmp/callflow-clockfix.lock}"

mkdir -p "$LOG_DIR" "$APP_DIR/backups"

# Keep the log from growing without bound (10 MB, one generation).
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 10485760 ]; then
  mv -f "$LOG" "$LOG.1"
fi

cd "$APP_DIR"

if [ ! -f dist/fixClockDrift.js ]; then
  echo "$(date -Is) FATAL: dist/fixClockDrift.js missing — run 'npm run build' in $APP_DIR" >> "$LOG"
  exit 1
fi

run_fix() {
  node dist/fixClockDrift.js \
    --apply \
    --quiet \
    --since-days "${CLOCKFIX_SINCE_DAYS:-14}" \
    --min-segment "${CLOCKFIX_MIN_SEGMENT:-3}" \
    --max-rows "${CLOCKFIX_MAX_ROWS:-5000}" \
    --backup-dir "$APP_DIR/backups" \
    --keep "${CLOCKFIX_KEEP:-30}"
}

# A slow run must skip the next tick rather than stack up two processes writing
# the same rows. Prefer flock (Linux); fall back to an atomic mkdir lock so the
# script still behaves on hosts without util-linux (e.g. macOS).
if command -v flock >/dev/null 2>&1; then
  exec flock -n "$LOCK" bash -c "$(declare -f run_fix); cd '$APP_DIR'; run_fix" >> "$LOG" 2>&1
fi

LOCK_DIR="$LOCK.d"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # Reap a lock orphaned by a crash/reboot rather than wedging forever.
  if [ -f "$LOCK_DIR/pid" ] && ! kill -0 "$(cat "$LOCK_DIR/pid")" 2>/dev/null; then
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null || exit 0
  else
    echo "$(date -Is) another run holds the lock — skipping this tick" >> "$LOG"
    exit 0
  fi
fi
echo $$ > "$LOCK_DIR/pid"
trap 'rm -rf "$LOCK_DIR"' EXIT

run_fix >> "$LOG" 2>&1
