import { describe, expect, it, vi } from "vitest";
import {
  createMqttPayload,
  findRateLimitResets,
  RateLimitMonitor,
  type RateLimitPublisher,
} from "../src/rate-limit-monitor.js";
import type { RateLimitSnapshot } from "../src/codex-status.js";

const initial: RateLimitSnapshot = {
  primary: { usedPercent: 75, windowDurationMins: 300, resetsAt: 1_700_000_000 },
  secondary: { usedPercent: 30, windowDurationMins: 10_080, resetsAt: 1_700_500_000 },
};

describe("findRateLimitResets", () => {
  it("detects a new reset cycle", () => {
    const current: RateLimitSnapshot = {
      primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1_700_018_000 },
      secondary: initial.secondary,
    };

    expect(findRateLimitResets(initial, current, 5)).toEqual([{
      window: "primary",
      previous: initial.primary,
      current: current.primary,
    }]);
  });

  it("detects an unscheduled reset from a meaningful usage drop", () => {
    const current: RateLimitSnapshot = {
      primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: initial.primary!.resetsAt },
      secondary: initial.secondary,
    };

    expect(findRateLimitResets(initial, current, 5)).toHaveLength(1);
  });

  it("ignores normal usage growth and small fluctuations", () => {
    const current: RateLimitSnapshot = {
      primary: { usedPercent: 72, windowDurationMins: 300, resetsAt: initial.primary!.resetsAt },
      secondary: { usedPercent: 31, windowDurationMins: 10_080, resetsAt: initial.secondary!.resetsAt },
    };

    expect(findRateLimitResets(initial, current, 5)).toEqual([]);
  });

  it("does not announce a reset-time change before the previous cycle ends", () => {
    const current: RateLimitSnapshot = {
      primary: { usedPercent: 76, windowDurationMins: 300, resetsAt: 1_700_018_000 },
      secondary: initial.secondary,
    };

    expect(findRateLimitResets(initial, current, 5, 1_699_999_000)).toEqual([]);
  });
});

describe("RateLimitMonitor", () => {
  it("publishes every snapshot but does not notify on its initial baseline", async () => {
    const notify = vi.fn(async () => undefined);
    const publisher: RateLimitPublisher = {
      publish: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const monitor = new RateLimitMonitor({
      config: {
        intervalMs: 60_000,
        resetDropPercent: 5,
        telegramNotifications: true,
        telegramChatIds: [123],
      },
      read: async () => initial,
      notify,
      publisher,
    });

    await monitor.pollOnce();

    expect(notify).not.toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it("notifies after a reset and continues MQTT publishing", async () => {
    const reset: RateLimitSnapshot = {
      primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1_700_018_000 },
      secondary: initial.secondary,
    };
    const snapshots = [initial, reset];
    const notify = vi.fn(async () => undefined);
    const publisher: RateLimitPublisher = {
      publish: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const monitor = new RateLimitMonitor({
      config: {
        intervalMs: 60_000,
        resetDropPercent: 5,
        telegramNotifications: true,
        telegramChatIds: [123],
      },
      read: async () => snapshots.shift() ?? null,
      notify,
      publisher,
      now: () => new Date("2026-07-21T12:00:00.000Z"),
    });

    await monitor.pollOnce();
    await monitor.pollOnce();

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("5h limit reset detected"));
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });
});

describe("createMqttPayload", () => {
  it("creates a stable JSON snapshot with remaining usage and reset time", () => {
    const payload = JSON.parse(createMqttPayload(initial, new Date("2026-07-21T12:00:00.000Z"))) as Record<string, any>;

    expect(payload).toMatchObject({
      source: "cdxtg",
      observedAt: "2026-07-21T12:00:00.000Z",
      limits: {
        primary: {
          usedPercent: 75,
          remainingPercent: 25,
          windowDurationMinutes: 300,
        },
      },
    });
    expect(payload.limits.primary.resetsAt).toBe("2023-11-14T22:13:20.000Z");
  });
});
