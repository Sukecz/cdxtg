import { pathToFileURL } from "node:url";
import { loadConfig, type AppConfig } from "./config.js";
import { errorMessage } from "./text.js";

export function formatConfigSummary(config: AppConfig): string {
  const monitor = config.rateLimitMonitor;
  const interval = monitor.intervalMs === 0
    ? "disabled"
    : `every ${formatDuration(monitor.intervalMs)}`;
  const telegramTargets = monitor.telegramChatIds.length === 0
    ? "no recipients"
    : `${monitor.telegramChatIds.length} chat${monitor.telegramChatIds.length === 1 ? "" : "s"}`;

  return [
    "Configuration is valid.",
    `Telegram allowlist: ${config.allowedUserIds.size} user${config.allowedUserIds.size === 1 ? "" : "s"}`,
    `Codex workspaces: ${config.workspaces.length}`,
    `Rate-limit monitor: ${interval}`,
    `Reset notifications: ${monitor.telegramNotifications ? `enabled for ${telegramTargets}` : "disabled"}`,
    `MQTT publishing: ${monitor.mqtt ? "enabled" : "disabled"}`,
    `Home Assistant discovery: ${monitor.mqtt?.homeAssistantDiscovery ? "enabled" : "disabled"}`,
    "No secret values were displayed.",
  ].join("\n");
}

function formatDuration(milliseconds: number): string {
  const seconds = milliseconds / 1_000;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    console.log(formatConfigSummary(loadConfig()));
  } catch (error) {
    console.error(`Configuration error: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
