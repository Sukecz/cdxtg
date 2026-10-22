import { Codex, type Thread, type ThreadEvent } from "@openai/codex-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexSession } from "../src/codex-session.js";

afterEach(() => vi.restoreAllMocks());

function makeSession() {
  return new CodexSession({ workspace: process.cwd(), mode: "read-only", approvalPolicy: "never" });
}

function abortWait(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

function mockThread(first: (signal: AbortSignal) => AsyncGenerator<ThreadEvent>) {
  const inputs: string[] = [];
  const runStreamed = vi.fn(async (input: string, { signal }: { signal: AbortSignal }) => {
    inputs.push(input);
    return { events: inputs.length === 1 ? first(signal) : (async function* () {
      yield { type: "turn.started" as const };
      yield { type: "item.completed" as const, item: { id: "answer", type: "agent_message" as const, text: "Continued" } };
    })() };
  });
  const thread = { runStreamed } as unknown as Thread;
  const start = vi.spyOn(Codex.prototype, "startThread").mockReturnValue(thread);
  return { inputs, start };
}

describe("active task follow-ups", () => {
  it("continues the same thread with ordered follow-ups and remains busy until done", async () => {
    const { inputs, start } = mockThread(async function* (signal) {
      yield { type: "thread.started", thread_id: "existing-thread" };
      yield { type: "turn.started" };
      await abortWait(signal);
    });
    const session = makeSession();
    const run = session.run("Original task");
    await vi.waitFor(() => expect(session.info.threadId).toBe("existing-thread"));
    session.followUp("First answer");
    session.followUp("Second answer");
    expect(session.busy).toBe(true);
    expect(() => session.reset()).toThrow("/stop");
    await expect(run).resolves.toEqual({ text: "Continued", threadId: "existing-thread" });
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("User message 1:\nOriginal task\n\nUser message 2:\nFirst answer\n\nUser message 3:\nSecond answer");
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ sandboxMode: "read-only" }));
    expect(session.busy).toBe(false);
  });

  it("waits for the original turn to start before interrupting an early follow-up", async () => {
    const { inputs } = mockThread(async function* (signal) {
      expect(signal.aborted).toBe(false);
      yield { type: "thread.started", thread_id: "new-thread" };
      expect(signal.aborted).toBe(false);
      yield { type: "turn.started" };
      expect(signal.aborted).toBe(true);
      await abortWait(signal);
    });
    const session = makeSession();
    const run = session.run("Original task");
    session.followUp("Early answer");
    await expect(run).resolves.toMatchObject({ text: "Continued" });
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("User message 1:\nOriginal task\n\nUser message 2:\nEarly answer");
  });

  it("stop cancels pending follow-ups and rejects further input until stopped", async () => {
    const { inputs } = mockThread(async function* (signal) {
      yield { type: "thread.started", thread_id: "thread" };
      yield { type: "turn.started" };
      await abortWait(signal);
    });
    const session = makeSession();
    const run = session.run("Original task");
    await vi.waitFor(() => expect(session.info.threadId).toBe("thread"));
    session.followUp("Pending answer");
    expect(session.stop()).toBe(true);
    expect(() => session.followUp("Too late")).toThrow("stopping");
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(inputs).toEqual(["Original task"]);
    expect(session.busy).toBe(false);
  });

  it("propagates a real failure instead of resuming silently", async () => {
    const { inputs } = mockThread(async function* () {
      yield { type: "error", message: "Runtime failed" };
    });
    const session = makeSession();
    const run = session.run("Original task");
    session.followUp("Pending answer");
    await expect(run).rejects.toThrow("Runtime failed");
    expect(inputs).toEqual(["Original task"]);
    expect(session.busy).toBe(false);
  });
});
