#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${CDXTG_ENV_FILE:-${PROJECT_DIR}/telegram.env}"
TEMPLATE_FILE="${PROJECT_DIR}/.env.example"

if [[ -e "${ENV_FILE}" ]]; then
  chmod 600 "${ENV_FILE}"
  echo "Configuration already exists: ${ENV_FILE} (contents were not changed)"
  exit 0
fi

install -m 600 "${TEMPLATE_FILE}" "${ENV_FILE}"
echo "Created: ${ENV_FILE}"
echo "Set TELEGRAM_BOT_TOKEN and, after discovering it with /id, TELEGRAM_ALLOWED_USER_IDS."
