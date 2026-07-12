import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "@openai/codex-sdk";
import { applyStreamEvent, createStreamState, renderStreamPreview } from "../src/streaming.js";

describe("Codex stream rendering", () => {
  it("streams accumulated agent text and compact activity", () => {
    const state = createStreamState();
    applyStreamEvent(state, event({
      type: "item.updated",
      item: { id: "a", type: "agent_message", text: "I am checking" },
    }));
    applyStreamEvent(state, event({
      type: "item.updated",
      item: { id: "a", type: "agent_message", text: "I am checking the tests." },
    }));

    const preview = renderStreamPreview(state, "brief");
    expect(preview).toContain("I am checking the tests.");
    expect(preview).toContain("Writing a response");
  });

  it("shows command output only in verbose mode", () => {
    const state = createStreamState();
    applyStreamEvent(state, event({
      type: "item.updated",
      item: {
        id: "c",
        type: "command_execution",
        command: "npm test",
        aggregated_output: "secret-looking test output",
        status: "in_progress",
      },
    }));

    expect(renderStreamPreview(state, "brief")).not.toContain("secret-looking");
    expect(renderStreamPreview(state, "verbose")).toContain("secret-looking test output");
  });

  it("renders todo progress without raw reasoning text", () => {
    const state = createStreamState();
    applyStreamEvent(state, event({
      type: "item.updated",
      item: { id: "r", type: "reasoning", text: "private reasoning contents" },
    }));
    applyStreamEvent(state, event({
      type: "item.updated",
      item: { id: "p", type: "todo_list", items: [
        { text: "Inspect", completed: true },
        { text: "Fix", completed: false },
      ] },
    }));

    const preview = renderStreamPreview(state, "verbose");
    expect(preview).toContain("☑ Inspect");
    expect(preview).toContain("☐ Fix");
    expect(preview).not.toContain("private reasoning contents");
  });
});

function event(value: ThreadEvent): ThreadEvent {
  return value;
}
