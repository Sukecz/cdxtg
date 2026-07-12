#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${CDXTG_ENV_FILE:-${PROJECT_DIR}/telegram.env}"
UNIT_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/systemd/user"
UNIT_FILE="${UNIT_DIR}/cdxtg.service"
NODE_BIN="$(command -v node || true)"

if [[ -z "${NODE_BIN}" ]]; then
  echo "Chyba: Node.js nebyl nalezen v PATH." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Chyba: chybí ${ENV_FILE}. Zkopírujte .env.example jako telegram.env a doplňte konfiguraci." >&2
  exit 1
fi

if ! grep -Eq '^[[:space:]]*TELEGRAM_ALLOWED_USER_IDS[[:space:]]*=[[:space:]]*[0-9]' "${ENV_FILE}"; then
  echo "Chyba: TELEGRAM_ALLOWED_USER_IDS není nastaveno. Nejdřív zjistěte ID přes /id a doplňte ho do telegram.env." >&2
  exit 1
fi

echo "Sestavuji cdxtg…"
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
  printf 'ExecStart="%s" "%s/dist/src/index.js"\n' "${NODE_BIN}" "${PROJECT_DIR}"
  echo 'Restart=on-failure'
  echo 'RestartSec=5'
  echo 'NoNewPrivileges=true'
  echo 'PrivateTmp=true'
  echo 'PrivateDevices=true'
  echo 'ProtectSystem=strict'
  echo 'ProtectHome=read-only'
  echo 'ProtectKernelTunables=true'
  echo 'ProtectKernelModules=true'
  echo 'ProtectControlGroups=true'
  echo 'ProtectKernelLogs=true'
  echo 'RestrictSUIDSGID=true'
  echo 'LockPersonality=true'
  echo 'RestrictRealtime=true'
  echo
  echo '[Install]'
  echo 'WantedBy=default.target'
} > "${UNIT_FILE}"

systemctl --user daemon-reload
systemctl --user enable cdxtg.service
systemctl --user restart cdxtg.service

echo "cdxtg je nainstalován, spuštěn a zapnut pro automatický start."
systemctl --user status cdxtg.service --no-pager --lines=5
