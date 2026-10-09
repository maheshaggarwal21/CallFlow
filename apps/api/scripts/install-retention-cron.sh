#!/usr/bin/env bash
#
# Adds the nightly storage-upkeep job (retention + recompress) to root's crontab.
# Idempotent: does nothing if the entry is already there.
#
#   bash /root/CallFlow/apps/api/scripts/install-retention-cron.sh
#
# Runs at 21:00 UTC = 02:30 IST (the droplet's clock is UTC).

set -euo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/retention-cron.sh"
LINE="0 21 * * * $SCRIPT >/dev/null 2>&1"

chmod +x "$SCRIPT"
current="$(crontab -l 2>/dev/null || true)"
if grep -qF "$SCRIPT" <<<"$current"; then
  echo "already installed:"
else
  printf '%s\n%s\n' "$current" "$LINE" | sed '/^$/d' | crontab -
  echo "installed:"
fi
crontab -l | grep -F "$SCRIPT"
