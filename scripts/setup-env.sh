#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="${CDXTG_ENV_FILE:-${PROJECT_DIR}/telegram.env}"
TEMPLATE_FILE="${PROJECT_DIR}/.env.example"

if [[ -e "${ENV_FILE}" ]]; then
  chmod 600 "${ENV_FILE}"
  echo "Configuration already exists: ${ENV_FILE} (contents were not changed)"
  echo "Validate it without displaying secrets: npm run config:check"
  exit 0
fi

install -m 600 "${TEMPLATE_FILE}" "${ENV_FILE}"
echo "Created: ${ENV_FILE}"
echo
echo "Next steps:"
echo "  1. Add the token from @BotFather to TELEGRAM_BOT_TOKEN."
echo "  2. Run: npm run config:check"
echo "  3. Run the bot temporarily: npm run build && npm start"
echo "  4. Send /id in Telegram, then add that ID to TELEGRAM_ALLOWED_USER_IDS."
echo "  5. Optional monitoring, MQTT, and Home Assistant settings are grouped at the end of the file."
echo
echo "The file is ignored by Git and has mode 0600. Never commit its contents."
