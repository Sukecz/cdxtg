#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${CDXTG_ENV_FILE:-${PROJECT_DIR}/telegram.env}"
TEMPLATE_FILE="${PROJECT_DIR}/.env.example"

if [[ -e "${ENV_FILE}" ]]; then
  chmod 600 "${ENV_FILE}"
  echo "Konfigurace už existuje: ${ENV_FILE} (obsah nebyl změněn)"
  exit 0
fi

install -m 600 "${TEMPLATE_FILE}" "${ENV_FILE}"
echo "Vytvořeno: ${ENV_FILE}"
echo "Doplňte TELEGRAM_BOT_TOKEN a po zjištění přes /id také TELEGRAM_ALLOWED_USER_IDS."
