#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${CDXTG_ENV_FILE:-${PROJECT_DIR}/telegram.env}"
UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
UNIT_FILE="${UNIT_DIR}/cdxtg.service"
NODE_BIN="$(command -v node || true)"

if [[ -z "${NODE_BIN}" ]]; then
  echo "Error: Node.js was not found in PATH." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  CDXTG_ENV_FILE="${ENV_FILE}" bash "${PROJECT_DIR}/scripts/setup-env.sh"
  echo "Installation stopped. Complete the generated configuration and run this command again." >&2
  exit 1
fi

chmod 600 "${ENV_FILE}"

if ! grep -Eq '^[[:space:]]*TELEGRAM_ALLOWED_USER_IDS[[:space:]]*=[[:space:]]*[0-9]' "${ENV_FILE}"; then
  echo "Error: TELEGRAM_ALLOWED_USER_IDS is not configured. Discover your ID with /id and add it to telegram.env first." >&2
  exit 1
fi

echo "Building cdxtg…"
npm --prefix "${PROJECT_DIR}" run build

mkdir -p "${UNIT_DIR}"
umask 077
{
  echo '[Unit]'
  echo 'Description=cdxtg - Telegram control for Codex'
  echo 'After=network-online.target'
  echo 'Wants=network-online.target'
  echo
  echo '[Service]'
  echo 'Type=simple'
  printf 'WorkingDirectory=%s\n' "${PROJECT_DIR}"
  echo 'Environment=NODE_ENV=production'
  printf 'Environment="CDXTG_ENV_FILE=%s"\n' "${ENV_FILE}"
  printf 'ExecStart="%s" --disable-warning=ExperimentalWarning "%s/dist/src/index.js"\n' "${NODE_BIN}" "${PROJECT_DIR}"
  echo 'Restart=on-failure'
  echo 'RestartSec=5'
  echo
  echo '[Install]'
  echo 'WantedBy=default.target'
} > "${UNIT_FILE}"

systemctl --user daemon-reload
systemctl --user enable cdxtg.service
systemctl --user restart cdxtg.service

echo "cdxtg is installed, running, and enabled for automatic startup."
systemctl --user status cdxtg.service --no-pager --lines=5
