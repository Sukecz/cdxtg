import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAllowedUserChecker, createBooleanSettingProvider, createWorkspaceProvider, loadConfig, parseChatIdList, parseNumericList, parseWorkspaces } from "../src/config.js";
import { formatConfigSummary } from "../src/check-config.js";

describe("parseNumericList", () => {
  it("accepts an empty discovery-mode allowlist", () => {
    expect(parseNumericList(undefined)).toEqual([]);
  });

  it("parses comma-separated Telegram IDs", () => {
    expect(parseNumericList("123, 456")).toEqual([123, 456]);
  });

  it("rejects invalid IDs", () => {
    expect(() => parseNumericList("123,nope")).toThrow(/invalid ID/);
  });
});

describe("parseChatIdList", () => {
  it("accepts private and group chat IDs", () => {
    expect(parseChatIdList("123,-1001234567890")).toEqual([123, -1001234567890]);
  });
});

describe("rate-limit monitor configuration", () => {
  it("defaults notification chats to the Telegram allowlist", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_ALLOWED_USER_IDS: "123,456",
      CODEX_RATE_LIMIT_POLL_SECONDS: "60",
    });

    expect(config.rateLimitMonitor).toMatchObject({
      intervalMs: 60_000,
      resetDropPercent: 5,
      telegramNotifications: true,
      telegramChatIds: [123, 456],
    });
  });

  it("parses an optional MQTT publisher", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "test-token",
      CODEX_RATE_LIMIT_POLL_SECONDS: "120",
      MQTT_URL: "mqtts://broker.example.com:8883",
      MQTT_TOPIC: "home/codex/limits",
      MQTT_QOS: "1",
      MQTT_RETAIN: "false",
    });

    expect(config.rateLimitMonitor.mqtt).toEqual({
      url: "mqtts://broker.example.com:8883",
      topic: "home/codex/limits",
      qos: 1,
      retain: false,
      homeAssistantDiscovery: false,
      homeAssistantDiscoveryPrefix: "homeassistant",
      homeAssistantDeviceId: "cdxtg_codex",
      homeAssistantDeviceName: "Codex Usage",
    });
  });

  it("parses Home Assistant MQTT discovery settings", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "test-token",
      MQTT_URL: "mqtt://broker.example.com",
      MQTT_HOME_ASSISTANT_DISCOVERY: "true",
      MQTT_HOME_ASSISTANT_DISCOVERY_PREFIX: "ha",
      MQTT_HOME_ASSISTANT_DEVICE_ID: "office-codex",
      MQTT_HOME_ASSISTANT_DEVICE_NAME: "Office Codex",
    });

    expect(config.rateLimitMonitor.mqtt).toMatchObject({
      homeAssistantDiscovery: true,
      homeAssistantDiscoveryPrefix: "ha",
      homeAssistantDeviceId: "office-codex",
      homeAssistantDeviceName: "Office Codex",
    });
  });

  it("rejects credentials embedded in MQTT_URL", () => {
    expect(() => loadConfig({
      TELEGRAM_BOT_TOKEN: "test-token",
      MQTT_URL: "mqtt://user:password@broker.example.com",
    })).toThrow(/MQTT_USERNAME and MQTT_PASSWORD/);
  });

  it("rejects an overly aggressive polling interval", () => {
    expect(() => loadConfig({
      TELEGRAM_BOT_TOKEN: "test-token",
      CODEX_RATE_LIMIT_POLL_SECONDS: "10",
    })).toThrow(/at least 30/);
  });
});

describe("formatConfigSummary", () => {
  it("describes enabled features without exposing secret values", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "telegram-secret-value",
      TELEGRAM_ALLOWED_USER_IDS: "123",
      CODEX_RATE_LIMIT_POLL_SECONDS: "900",
      MQTT_URL: "mqtt://broker.example.com",
      MQTT_USERNAME: "private-user",
      MQTT_PASSWORD: "private-password",
      MQTT_HOME_ASSISTANT_DISCOVERY: "true",
    });
    const summary = formatConfigSummary(config);

    expect(summary).toContain("Rate-limit monitor: every 15m");
    expect(summary).toContain("MQTT publishing: enabled");
    expect(summary).toContain("Home Assistant discovery: enabled");
    expect(summary).not.toContain("telegram-secret-value");
    expect(summary).not.toContain("private-user");
    expect(summary).not.toContain("private-password");
  });
});
describe("parseWorkspaces", () => {
  it("canonicalizes and deduplicates existing paths", () => {
    expect(parseWorkspaces(".,.")).toEqual([process.cwd()]);
  });

  it("rejects missing paths", () => {
    expect(() => parseWorkspaces("/definitely/not/a/cdxtg/workspace")).toThrow(/does not exist/);
  });
});

describe("createAllowedUserChecker", () => {
  it("hot-reloads the allowlist without restarting the bot", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "cdxtg-test-"));
    const envFile = path.join(directory, "telegram.env");
    try {
      writeFileSync(envFile, "TELEGRAM_ALLOWED_USER_IDS=123\n");
      const isAllowed = createAllowedUserChecker(new Set(), envFile);
      expect(isAllowed(123)).toBe(true);
      expect(isAllowed(456)).toBe(false);

      writeFileSync(envFile, "TELEGRAM_ALLOWED_USER_IDS=456\n");
      const future = new Date(Date.now() + 1_000);
      utimesSync(envFile, future, future);
      expect(isAllowed(123)).toBe(false);
      expect(isAllowed(456)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("createWorkspaceProvider", () => {
  it("hot-reloads configured workspace paths", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "cdxtg-test-"));
    const first = path.join(directory, "first");
    const second = path.join(directory, "second");
    const envFile = path.join(directory, "telegram.env");
    try {
      mkdirSync(first);
      mkdirSync(second);
      writeFileSync(envFile, `CODEX_WORKSPACES=${first}\n`);
      const getWorkspaces = createWorkspaceProvider([directory], envFile);
      expect(getWorkspaces()).toEqual([first]);

      writeFileSync(envFile, `CODEX_WORKSPACES=${second}\n`);
      const future = new Date(Date.now() + 1_000);
      utimesSync(envFile, future, future);
      expect(getWorkspaces()).toEqual([second]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("createBooleanSettingProvider", () => {
  it("hot-reloads local security opt-ins", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "cdxtg-test-"));
    const envFile = path.join(directory, "telegram.env");
    try {
      writeFileSync(envFile, "CODEX_ENABLE_FULL_ACCESS=false\n");
      const isEnabled = createBooleanSettingProvider("CODEX_ENABLE_FULL_ACCESS", false, envFile);
      expect(isEnabled()).toBe(false);

      writeFileSync(envFile, "CODEX_ENABLE_FULL_ACCESS=true\n");
      const future = new Date(Date.now() + 1_000);
      utimesSync(envFile, future, future);
      expect(isEnabled()).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
