import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAllowedUserChecker, createBooleanSettingProvider, createWorkspaceProvider, parseNumericList, parseWorkspaces } from "../src/config.js";

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
