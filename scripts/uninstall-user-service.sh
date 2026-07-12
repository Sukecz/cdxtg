#!/usr/bin/env bash
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
UNIT_FILE="${UNIT_DIR}/cdxtg.service"

systemctl --user disable --now cdxtg.service 2>/dev/null || true
rm -f -- "${UNIT_FILE}"
systemctl --user daemon-reload
systemctl --user reset-failed cdxtg.service 2>/dev/null || true

echo "The cdxtg user service was removed. The project and telegram.env were not deleted."
