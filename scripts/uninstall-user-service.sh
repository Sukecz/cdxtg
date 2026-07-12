#!/usr/bin/env bash
set -euo pipefail

UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
UNIT_FILE="${UNIT_DIR}/cdxtg.service"

systemctl --user disable --now cdxtg.service 2>/dev/null || true
rm -f -- "${UNIT_FILE}"
systemctl --user daemon-reload
systemctl --user reset-failed cdxtg.service 2>/dev/null || true

echo "User služba cdxtg byla odebrána. Projekt ani telegram.env nebyly smazány."
