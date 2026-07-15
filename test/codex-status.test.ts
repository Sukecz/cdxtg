import { describe, expect, it } from "vitest";
import { formatModelSummary, formatRateLimits, resolveRuntimeStatus } from "../src/codex-status.js";

describe("Codex status", () => {
  it("resolves the effective configured model and reasoning effort", () => {
    const status = resolveRuntimeStatus({}, {
      configModel: "gpt-example",
      configReasoningEffort: "high",
      models: [{
        id: "gpt-example",
        model: "gpt-example",
        defaultReasoningEffort: "medium",
        isDefault: false,
      }],
      rateLimits: null,
    });

    expect(formatModelSummary(status)).toBe("gpt-example · high");
  });

  it("uses explicit session settings before Codex configuration", () => {
    const status = resolveRuntimeStatus({ model: "session-model", reasoningEffort: "low" }, {
      configModel: "configured-model",
      configReasoningEffort: "high",
      models: [],
      rateLimits: null,
    });

    expect(status.model).toBe("session-model");
    expect(status.reasoningEffort).toBe("low");
  });

  it("falls back safely when app-server status is unavailable", () => {
    expect(resolveRuntimeStatus({})).toEqual({
      model: "Codex default",
      reasoningEffort: "model default",
      rateLimits: null,
      rateLimitsAvailable: false,
    });
  });

  it("formats arbitrary rate-limit windows compactly", () => {
    const lines = formatRateLimits({
      primary: { usedPercent: 11, windowDurationMins: 10_080, resetsAt: null },
      secondary: { usedPercent: 30.4, windowDurationMins: 300, resetsAt: null },
    });

    expect(lines).toEqual([
      "Weekly limit: 89% left",
      "5h limit: 70% left",
    ]);
  });
});
