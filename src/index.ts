import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { errorMessage } from "./text.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = createBot(config);

  await bot.api.setMyCommands([
    { command: "start", description: "Welcome and access status" },
    { command: "help", description: "Command reference" },
    { command: "id", description: "Telegram user ID a chat ID" },
    { command: "new", description: "Start a new Codex session" },
    { command: "status", description: "Show the current session" },
    { command: "workspace", description: "Select a workspace" },
    { command: "mode", description: "Select readonly/write mode" },
    { command: "stop", description: "Stop the running task" },
    { command: "version", description: "Show the cdxtg version" },
  ]);

  const me = await bot.api.getMe();
  console.log(`cdxtg is running as @${me.username}`);
  if (config.allowedUserIds.size === 0) {
    console.warn("The allowlist is empty. The bot will only identify users; use /id and set TELEGRAM_ALLOWED_USER_IDS.");
  }

  const stop = (): void => {
    void bot.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await bot.start({ drop_pending_updates: false });
}

main().catch((error) => {
  console.error(`cdxtg failed to start: ${errorMessage(error)}`);
  process.exitCode = 1;
});
