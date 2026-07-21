import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import type { ModelReasoningEffort } from "@openai/codex-sdk";

const STATUS_TIMEOUT_MS = 8_000;

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface RateLimitSnapshot {
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}

interface CodexModel {
  id: string;
  model: string;
  defaultReasoningEffort: string;
  isDefault: boolean;
}

interface AppServerSnapshot {
  configModel: string | null;
  configReasoningEffort: string | null;
  models: CodexModel[];
  rateLimits: RateLimitSnapshot | null;
}

export interface CodexRuntimeStatus {
  model: string;
  reasoningEffort: string;
  rateLimits: RateLimitSnapshot | null;
  rateLimitsAvailable: boolean;
}

interface RuntimeStatusOptions {
  workspace: string;
  model?: string;
  reasoningEffort?: ModelReasoningEffort;
  includeRateLimits?: boolean;
}

type SpawnAppServer = () => ChildProcessWithoutNullStreams;
const require = createRequire(import.meta.url);

export async function readCodexRuntimeStatus(options: RuntimeStatusOptions): Promise<CodexRuntimeStatus> {
  const fallback = resolveRuntimeStatus(options);

  try {
    const snapshot = await queryAppServer(options.workspace, options.includeRateLimits ?? false);
    return resolveRuntimeStatus(options, snapshot);
  } catch {
    return fallback;
  }
}

export function resolveRuntimeStatus(
  options: Pick<RuntimeStatusOptions, "model" | "reasoningEffort">,
  snapshot?: AppServerSnapshot,
): CodexRuntimeStatus {
  const configuredModel = options.model ?? snapshot?.configModel ?? undefined;
  const selectedModel = snapshot?.models.find((model) => model.model === configuredModel || model.id === configuredModel)
    ?? snapshot?.models.find((model) => model.isDefault);

  return {
    model: configuredModel ?? selectedModel?.model ?? "Codex default",
    reasoningEffort: options.reasoningEffort
      ?? snapshot?.configReasoningEffort
      ?? selectedModel?.defaultReasoningEffort
      ?? "model default",
    rateLimits: snapshot?.rateLimits ?? null,
    rateLimitsAvailable: snapshot !== undefined && snapshot.rateLimits !== null,
  };
}

export function formatModelSummary(status: Pick<CodexRuntimeStatus, "model" | "reasoningEffort">): string {
  return `${status.model} · ${status.reasoningEffort}`;
}

export function formatNewSessionSummary(
  workspace: string,
  status: Pick<CodexRuntimeStatus, "model" | "reasoningEffort">,
): string {
  return `Active workspace: ${workspace}\nModel: ${formatModelSummary(status)}\nStarted a new Codex session.`;
}

export function formatRateLimits(snapshot: RateLimitSnapshot, locale = "en-GB"): string[] {
  return [snapshot.primary, snapshot.secondary]
    .filter((window): window is RateLimitWindow => window !== null)
    .map((window) => {
      const left = Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
      const reset = window.resetsAt === null
        ? ""
        : ` · resets ${new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(window.resetsAt * 1_000))}`;
      return `${rateLimitLabel(window.windowDurationMins)}: ${left}% left${reset}`;
    });
}

export function rateLimitLabel(durationMins: number | null): string {
  if (durationMins === null) return "Limit";
  if (durationMins === 10_080) return "Weekly limit";
  if (durationMins === 1_440) return "Daily limit";
  if (durationMins % 1_440 === 0) return `${durationMins / 1_440}d limit`;
  if (durationMins % 60 === 0) return `${durationMins / 60}h limit`;
  return `${durationMins}m limit`;
}

async function queryAppServer(
  workspace: string,
  includeRateLimits: boolean,
  spawnAppServer: SpawnAppServer = spawnBundledAppServer,
): Promise<AppServerSnapshot> {
  const child = spawnAppServer();
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });

  return new Promise((resolve, reject) => {
    let settled = false;
    let initialized = false;
    let configModel: string | null = null;
    let configReasoningEffort: string | null = null;
    let models: CodexModel[] = [];
    let rateLimits: RateLimitSnapshot | null = null;
    const pending = new Set(includeRateLimits ? [2, 3, 4] : [2, 3]);

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.kill();
      if (error) reject(error);
      else resolve({ configModel, configReasoningEffort, models, rateLimits });
    };

    const send = (message: unknown): void => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const timer = setTimeout(() => finish(new Error("Codex status request timed out.")), STATUS_TIMEOUT_MS);
    timer.unref();

    child.once("error", () => finish(new Error("Could not start Codex app server.")));
    child.stdin.once("error", () => finish(new Error("Could not communicate with Codex app server.")));
    child.once("exit", () => {
      if (!settled) finish(new Error("Codex app server exited before returning status."));
    });

    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }

      if (message.id === 1 && !initialized) {
        if (message.error) {
          finish(new Error("Codex app server initialization failed."));
          return;
        }
        initialized = true;
        send({ method: "initialized" });
        send({ id: 2, method: "config/read", params: { cwd: workspace, includeLayers: false } });
        send({ id: 3, method: "model/list", params: { limit: 100, includeHidden: false } });
        if (includeRateLimits) send({ id: 4, method: "account/rateLimits/read" });
        return;
      }

      if (typeof message.id !== "number" || !pending.has(message.id)) return;
      pending.delete(message.id);

      const result = asRecord(message.result);
      if (message.id === 2) {
        const config = asRecord(result?.config);
        configModel = asNullableString(config?.model);
        configReasoningEffort = asNullableString(config?.model_reasoning_effort);
      } else if (message.id === 3) {
        models = parseModels(result?.data);
      } else if (message.id === 4) {
        rateLimits = parseRateLimitSnapshot(result?.rateLimits);
      }

      if (pending.size === 0) finish();
    });

    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "cdxtg", title: "cdxtg", version: "0.3" },
        capabilities: { experimentalApi: false, requestAttestation: false },
      },
    });
  });
}

function spawnBundledAppServer(): ChildProcessWithoutNullStreams {
  const codexEntrypoint = require.resolve("@openai/codex/bin/codex.js");
  return spawn(process.execPath, [codexEntrypoint, "app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function parseModels(value: unknown): CodexModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const model = asRecord(entry);
    if (!model || typeof model.model !== "string" || typeof model.id !== "string") return [];
    return [{
      id: model.id,
      model: model.model,
      defaultReasoningEffort: typeof model.defaultReasoningEffort === "string"
        ? model.defaultReasoningEffort
        : "model default",
      isDefault: model.isDefault === true,
    }];
  });
}

function parseRateLimitSnapshot(value: unknown): RateLimitSnapshot | null {
  const snapshot = asRecord(value);
  if (!snapshot) return null;
  const primary = parseRateLimitWindow(snapshot.primary);
  const secondary = parseRateLimitWindow(snapshot.secondary);
  return primary || secondary ? { primary, secondary } : null;
}

function parseRateLimitWindow(value: unknown): RateLimitWindow | null {
  const window = asRecord(value);
  if (!window || typeof window.usedPercent !== "number") return null;
  return {
    usedPercent: window.usedPercent,
    windowDurationMins: typeof window.windowDurationMins === "number" ? window.windowDurationMins : null,
    resetsAt: typeof window.resetsAt === "number" ? window.resetsAt : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
