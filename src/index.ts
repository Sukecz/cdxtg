import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { errorMessage } from "./text.js";
import { randomBytes } from "node:crypto";

async function main(): Promise<void> {
  const config = loadConfig();
  const pairingCode = config.allowedUserIds.size === 0
    ? randomBytes(8).toString("hex").toUpperCase()
    : undefined;
  const bot = createBot(config, pairingCode);

  await bot.api.setMyCommands([
    { command: "start", description: "Welcome and access status" },
    { command: "help", description: "Command reference" },
    { command: "id", description: "Telegram user ID and chat ID" },
    { command: "pair", description: "Authorize the first Telegram user" },
    { command: "new", description: "Choose workspace and start a session" },
    { command: "status", description: "Show the current session" },
    { command: "workspace", description: "Select a workspace" },
    { command: "model", description: "Select a Codex model" },
    { command: "reasoning", description: "Select reasoning effort" },
    { command: "mode", description: "Select readonly/write mode" },
    { command: "stop", description: "Stop the running task" },
    { command: "version", description: "Show the cdxtg version" },
  ]);

  const me = await bot.api.getMe();
  console.log(`cdxtg is running as @${me.username}`);
  if (config.allowedUserIds.size === 0) {
    console.warn(`No Telegram user is authorized. Send /pair ${pairingCode} to the bot from a private chat.`);
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
