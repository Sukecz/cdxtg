import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { readCodexRuntimeStatus } from "./codex-status.js";
import { MqttRateLimitPublisher, RateLimitMonitor } from "./rate-limit-monitor.js";
import { errorMessage } from "./text.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = createBot(config);
  const monitor = new RateLimitMonitor({
    config: config.rateLimitMonitor,
    read: async () => (await readCodexRuntimeStatus({
      workspace: config.workspaces[0]!,
      includeRateLimits: true,
    })).rateLimits,
    notify: async (message) => {
      if (!config.rateLimitMonitor.telegramNotifications) return;
      await Promise.all(config.rateLimitMonitor.telegramChatIds.map(async (chatId) => {
        await bot.api.sendMessage(chatId, message);
      }));
    },
    ...(config.rateLimitMonitor.mqtt
      ? { publisher: new MqttRateLimitPublisher(config.rateLimitMonitor.mqtt) }
      : {}),
  });

  await bot.api.setMyCommands([
    { command: "start", description: "Welcome and access status" },
    { command: "help", description: "Command reference" },
    { command: "id", description: "Telegram user ID a chat ID" },
    { command: "new", description: "Choose workspace and start a session" },
    { command: "resume", description: "Continue a recent Codex session" },
    { command: "status", description: "Show the current session" },
    { command: "workspace", description: "Select a workspace" },
    { command: "model", description: "Select model and reasoning" },
    { command: "reasoning", description: "Change reasoning effort only" },
    { command: "stream", description: "Select streaming detail" },
    { command: "mode", description: "Select readonly/write mode" },
    { command: "stop", description: "Stop the running task" },
    { command: "version", description: "Show the cdxtg version" },
  ]);

  const me = await bot.api.getMe();
  console.log(`cdxtg is running as @${me.username}`);
  if (config.allowedUserIds.size === 0) {
    console.warn("The allowlist is empty. The bot will only identify users; use /id and set TELEGRAM_ALLOWED_USER_IDS.");
  }
  monitor.start();

  const stop = (): void => {
    void bot.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await bot.start({ drop_pending_updates: false });
  } finally {
    await monitor.stop();
  }
}

main().catch((error) => {
  console.error(`cdxtg failed to start: ${errorMessage(error)}`);
  process.exitCode = 1;
});
