import { connectAsync, type MqttClient } from "mqtt";
import type { MqttConfig, RateLimitMonitorConfig } from "./config.js";
import { rateLimitLabel, type RateLimitSnapshot, type RateLimitWindow } from "./codex-status.js";

type WindowName = "primary" | "secondary";

export interface RateLimitReset {
  window: WindowName;
  previous: RateLimitWindow;
  current: RateLimitWindow;
}

export interface RateLimitPublisher {
  publish(snapshot: RateLimitSnapshot, observedAt: Date): Promise<void>;
  close(): Promise<void>;
}

interface RateLimitMonitorOptions {
  config: RateLimitMonitorConfig;
  read: () => Promise<RateLimitSnapshot | null>;
  notify: (message: string) => Promise<void>;
  publisher?: RateLimitPublisher;
  now?: () => Date;
  reportError?: (message: string) => void;
}

export class RateLimitMonitor {
  private timer: NodeJS.Timeout | undefined;
  private previous: RateLimitSnapshot | null = null;
  private stopped = true;

  constructor(private readonly options: RateLimitMonitorOptions) {}

  start(): void {
    if (this.options.config.intervalMs <= 0 || !this.stopped) return;
    this.stopped = false;
    void this.poll();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.options.publisher?.close();
  }

  async pollOnce(): Promise<void> {
    const snapshot = await this.options.read();
    if (!snapshot) return;
    const observedAt = (this.options.now ?? (() => new Date()))();

    if (this.previous) {
      const resets = findRateLimitResets(
        this.previous,
        snapshot,
        this.options.config.resetDropPercent,
        observedAt.getTime() / 1_000,
      );
      const deliveries = resets.map(async (reset) => this.options.notify(formatResetNotification(reset, observedAt)));
      if (this.options.publisher) deliveries.push(this.options.publisher.publish(snapshot, observedAt));
      this.previous = snapshot;
      const outcomes = await Promise.allSettled(deliveries);
      for (const outcome of outcomes) {
        if (outcome.status === "rejected") this.reportError(outcome.reason);
      }
      return;
    }

    this.previous = snapshot;
    await this.options.publisher?.publish(snapshot, observedAt);
  }

  private async poll(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (error) {
      this.reportError(error);
    } finally {
      if (!this.stopped) {
        this.timer = setTimeout(() => void this.poll(), this.options.config.intervalMs);
        this.timer.unref();
      }
    }
  }

  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    (this.options.reportError ?? console.warn)(`Rate-limit monitor: ${message}`);
  }
}

export function findRateLimitResets(
  previous: RateLimitSnapshot,
  current: RateLimitSnapshot,
  minimumDropPercent: number,
  observedAtSeconds = Date.now() / 1_000,
): RateLimitReset[] {
  return (["primary", "secondary"] as const).flatMap((window) => {
    const before = previous[window];
    const after = current[window];
    if (!before || !after) return [];
    const cycleAdvanced = before.resetsAt !== null
      && after.resetsAt !== null
      && after.resetsAt > before.resetsAt
      && observedAtSeconds >= before.resetsAt;
    const usageDropped = before.usedPercent - after.usedPercent >= minimumDropPercent;
    return cycleAdvanced || usageDropped ? [{ window, previous: before, current: after }] : [];
  });
}

export function formatResetNotification(reset: RateLimitReset, observedAt = new Date()): string {
  const left = Math.max(0, Math.min(100, Math.round(100 - reset.current.usedPercent)));
  const nextReset = reset.current.resetsAt === null
    ? ""
    : ` Next reset: ${new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(reset.current.resetsAt * 1_000))}.`;
  return `Codex ${rateLimitLabel(reset.current.windowDurationMins).toLowerCase()} reset detected. ${left}% left.${nextReset}\nChecked: ${observedAt.toISOString()}`;
}

export function createMqttPayload(snapshot: RateLimitSnapshot, observedAt: Date): string {
  const serialize = (window: RateLimitWindow | null): Record<string, unknown> | null => window && ({
    usedPercent: window.usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
    windowDurationMinutes: window.windowDurationMins,
    resetsAt: window.resetsAt === null ? null : new Date(window.resetsAt * 1_000).toISOString(),
  });
  return JSON.stringify({
    source: "cdxtg",
    observedAt: observedAt.toISOString(),
    limits: {
      primary: serialize(snapshot.primary),
      secondary: serialize(snapshot.secondary),
    },
  });
}

export class MqttRateLimitPublisher implements RateLimitPublisher {
  private client: MqttClient | undefined;

  constructor(private readonly config: MqttConfig) {}

  async publish(snapshot: RateLimitSnapshot, observedAt: Date): Promise<void> {
    const client = await this.getClient();
    await client.publishAsync(this.config.topic, createMqttPayload(snapshot, observedAt), {
      qos: this.config.qos,
      retain: this.config.retain,
    });
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client) await client.endAsync();
  }

  private async getClient(): Promise<MqttClient> {
    if (this.client) return this.client;
    this.client = await connectAsync(this.config.url, {
      ...(this.config.username ? { username: this.config.username } : {}),
      ...(this.config.password ? { password: this.config.password } : {}),
      reconnectPeriod: 5_000,
      connectTimeout: 10_000,
    });
    return this.client;
  }

}
