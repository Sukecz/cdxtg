import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { errorMessage } from "./text.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = createBot(config);

  await bot.api.setMyCommands([
    { command: "start", description: "Úvod a stav" },
    { command: "help", description: "Přehled příkazů" },
    { command: "id", description: "Telegram user ID a chat ID" },
    { command: "new", description: "Nová Codex relace" },
    { command: "status", description: "Stav relace" },
    { command: "workspace", description: "Výběr workspace" },
    { command: "mode", description: "Režim readonly/write" },
    { command: "stop", description: "Zastavit úlohu" },
    { command: "version", description: "Verze cdxtg" },
  ]);

  const me = await bot.api.getMe();
  console.log(`cdxtg běží jako @${me.username}`);
  if (config.allowedUserIds.size === 0) {
    console.warn("Allowlist je prázdný. Bot odpoví pouze identifikací uživatele; použijte /id a nastavte TELEGRAM_ALLOWED_USER_IDS.");
  }

  const stop = (): void => {
    void bot.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await bot.start({ drop_pending_updates: false });
}

main().catch((error) => {
  console.error(`cdxtg se nepodařilo spustit: ${errorMessage(error)}`);
  process.exitCode = 1;
});
