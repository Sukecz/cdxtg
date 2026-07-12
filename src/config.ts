import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import type { ApprovalMode, SandboxMode } from "@openai/codex-sdk";

export interface AppConfig {
  telegramBotToken: string;
  allowedUserIds: ReadonlySet<number>;
  workspaces: readonly string[];
  model?: string;
  defaultMode: SafeSandboxMode;
  enableWrite: boolean;
  approvalPolicy: ApprovalMode;
  logLevel: LogLevel;
  envFile?: string;
}

export type SafeSandboxMode = Extract<SandboxMode, "read-only" | "workspace-write">;
export type LogLevel = "debug" | "info" | "warn" | "error";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  let envFile: string | undefined;
  if (env === process.env) {
    envFile = path.resolve(env.CDXTG_ENV_FILE?.trim() || "telegram.env");
    loadDotenv({ path: envFile, quiet: true });
    loadDotenv({ path: path.resolve(".env"), quiet: true, override: false });
  }

  const telegramBotToken = required(env, "TELEGRAM_BOT_TOKEN");
  const allowedUserIds = new Set(parseNumericList(env.TELEGRAM_ALLOWED_USER_IDS));
  const workspaces = parseWorkspaces(env.CODEX_WORKSPACES);
  const enableWrite = parseBoolean(env.CODEX_ENABLE_WRITE, false, "CODEX_ENABLE_WRITE");
  const defaultMode = parseMode(env.CODEX_DEFAULT_MODE, enableWrite);
  const approvalPolicy = parseApprovalPolicy(env.CODEX_APPROVAL_POLICY);
  const logLevel = parseLogLevel(env.LOG_LEVEL);
  const model = optional(env.CODEX_MODEL);

  return {
    telegramBotToken,
    allowedUserIds,
    workspaces,
    ...(model ? { model } : {}),
    defaultMode,
    enableWrite,
    approvalPolicy,
    logLevel,
    ...(envFile ? { envFile } : {}),
  };
}

export function createAllowedUserChecker(
  initialIds: ReadonlySet<number>,
  envFile?: string,
  reportError: (message: string) => void = console.warn,
): (userId: number) => boolean {
  let allowedIds = new Set(initialIds);
  let lastModified = -1;

  const refresh = (): void => {
    if (!envFile) return;
    try {
      const modified = statSync(envFile).mtimeMs;
      if (modified === lastModified) return;
      const values = parseEnv(readFileSync(envFile, "utf8"));
      allowedIds = new Set(parseNumericList(values.TELEGRAM_ALLOWED_USER_IDS));
      lastModified = modified;
    } catch (error) {
      reportError(`Could not reload TELEGRAM_ALLOWED_USER_IDS: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (userId: number): boolean => {
    refresh();
    return allowedIds.has(userId);
  };
}

function parseEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function parseNumericList(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];

  return raw.split(",").map((entry) => {
    const value = Number(entry.trim());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`TELEGRAM_ALLOWED_USER_IDS contains an invalid ID: ${entry.trim()}`);
    }
    return value;
  });
}

export function parseWorkspaces(raw: string | undefined): string[] {
  const candidates = raw?.trim() ? raw.split(",") : [process.cwd()];
  const unique = new Set<string>();

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate.trim());
    if (!existsSync(resolved)) {
      throw new Error(`Configured workspace does not exist: ${resolved}`);
    }
    unique.add(realpathSync(resolved));
  }

  if (unique.size === 0) throw new Error("CODEX_WORKSPACES must contain at least one path");
  return [...unique];
}

function parseMode(raw: string | undefined, enableWrite: boolean): SafeSandboxMode {
  const value = optional(raw) ?? "read-only";
  if (value !== "read-only" && value !== "workspace-write") {
    throw new Error("CODEX_DEFAULT_MODE must be read-only or workspace-write");
  }
  if (value === "workspace-write" && !enableWrite) {
    throw new Error("CODEX_DEFAULT_MODE=workspace-write requires CODEX_ENABLE_WRITE=true");
  }
  return value;
}

function parseApprovalPolicy(raw: string | undefined): ApprovalMode {
  const value = optional(raw) ?? "never";
  if (!(["never", "on-request", "on-failure", "untrusted"] as const).includes(value as ApprovalMode)) {
    throw new Error("CODEX_APPROVAL_POLICY is invalid");
  }
  return value as ApprovalMode;
}

function parseLogLevel(raw: string | undefined): LogLevel {
  const value = optional(raw) ?? "info";
  if (!(["debug", "info", "warn", "error"] as const).includes(value as LogLevel)) {
    throw new Error("LOG_LEVEL must be debug, info, warn, or error");
  }
  return value as LogLevel;
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  const value = optional(raw)?.toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = optional(env[name]);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
