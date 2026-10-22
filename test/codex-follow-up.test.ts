import { describe, expect, it, vi } from "vitest";
import { RpcError } from "../src/app-server.js";
import { CodexSession, type QuestionPrompt } from "../src/codex-session.js";
import { FakeAppServer } from "./helpers/app-server.js";

function setup() {
  const server = new FakeAppServer();
  const session = new CodexSession({ workspace: process.cwd(), mode: "read-only", approvalPolicy: "never", model: "chosen", reasoningEffort: "low" }, () => server);
  return { session, server };
}
async function started(server: FakeAppServer) {
  await vi.waitFor(() => expect(server.request).toHaveBeenCalledWith("turn/start", expect.anything()));
}

describe("App Server session", () => {
  it("steers the same turn in order without cancelling or replaying the original input", async () => {
    const { session, server } = setup();
    const run = session.run("Original task");
    await started(server);
    await Promise.all([session.followUp("First answer"), session.followUp("Second answer")]);
    expect(session.busy).toBe(true);
    expect(() => session.reset()).toThrow("/stop");
    const calls = server.request.mock.calls;
    expect(calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
    expect(calls.filter(([method]) => method === "turn/interrupt")).toHaveLength(0);
    expect(calls.filter(([method]) => method === "turn/steer").map(([, params]) => params)).toEqual([
      { threadId: "thread-1", expectedTurnId: "turn-1", input: [{ type: "text", text: "First answer", text_elements: [] }] },
      { threadId: "thread-1", expectedTurnId: "turn-1", input: [{ type: "text", text: "Second answer", text_elements: [] }] },
    ]);
    expect(calls[0]).toEqual(["thread/start", expect.objectContaining({ sandbox: "read-only", approvalPolicy: "never", model: "chosen", config: { model_reasoning_effort: "low" } })]);
    server.complete();
    await expect(run).resolves.toEqual({ text: "Final answer", threadId: "thread-1" });
    expect(session.busy).toBe(false);
    expect(server.close).toHaveBeenCalledOnce();
  });

  it("holds an early follow-up until the initial turn has an ID", async () => {
    const { session, server } = setup();
    let ready!: () => void;
    server.initialize.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const run = session.run("Original task");
    const delivered = session.followUp("Early answer");
    expect(server.request).not.toHaveBeenCalled();
    ready();
    await delivered;
    expect(server.request.mock.calls.map(([method]) => method)).toEqual(["thread/start", "turn/start", "turn/steer"]);
    server.complete();
    await run;
  });

  it("starts a next turn only after definite steering rejection and observed completion", async () => {
    const { session, server } = setup();
    const standard = server.request.getMockImplementation()!;
    server.request.mockImplementation(async (method, params) => {
      if (method === "turn/steer") {
        server.complete("Old answer");
        server.turnId = "turn-2";
        throw new RpcError(-32600, "No active turn");
      }
      if (method === "turn/start" && server.turnId === "turn-2") {
        server.onNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "failed" } } });
      }
      return standard(method, params);
    });
    const run = session.run("Original");
    await started(server);
    await session.followUp("New input");
    server.complete("New answer");
    await expect(run).resolves.toMatchObject({ text: "New answer" });
    expect(server.request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(2);
  });

  it("never replays a follow-up whose acknowledgement was lost", async () => {
    const { session, server } = setup();
    const standard = server.request.getMockImplementation()!;
    server.request.mockImplementation(async (method, params) => {
      if (method === "turn/steer") { server.complete(); throw new Error("Delivery is uncertain"); }
      return standard(method, params);
    });
    const run = session.run("Original");
    await started(server);
    await expect(session.followUp("Possibly delivered")).rejects.toThrow("uncertain");
    await run;
    expect(server.request.mock.calls.filter(([method]) => method === "turn/start")).toHaveLength(1);
  });

  it("interrupts via the protocol and rejects new follow-ups while stopping", async () => {
    const { session, server } = setup();
    const run = session.run("Original");
    await started(server);
    expect(session.stop()).toBe(true);
    await expect(session.followUp("Too late")).rejects.toThrow("stopping");
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(server.request).toHaveBeenCalledWith("turn/interrupt", { threadId: "thread-1", turnId: "turn-1" });
  });

  it("answers sequential native questions through their original request, without steering", async () => {
    const { session, server } = setup();
    const questions: QuestionPrompt[] = [];
    const run = session.run("Original", undefined, (q) => questions.push(q));
    await started(server);
    const result = server.ask("request", [{ id: "first", question: "First?", options: [] }, { id: "second", question: "Second?", options: [] }]);
    session.answerQuestion(questions[0]!.token, "One");
    expect(() => session.answerQuestion(questions[0]!.token, "Duplicate")).toThrow("expired");
    session.answerQuestion(questions[1]!.token, "Two");
    await expect(result).resolves.toEqual({ answers: { first: { answers: ["One"] }, second: { answers: ["Two"] } } });
    expect(server.request.mock.calls.some(([method]) => method === "turn/steer")).toBe(false);
    server.complete();
    await run;
  });

  it("expires a pending question when Codex resolves or cancels it", async () => {
    const { session, server } = setup();
    const run = session.run("Original", undefined, () => {});
    await started(server);
    const result = server.ask(42);
    const token = session.question!.token;
    server.emit("serverRequest/resolved", { requestId: 42 });
    await expect(result).rejects.toThrow("expired");
    expect(() => session.answerQuestion(token, "Late")).toThrow("expired");
    server.complete();
    await run;
  });

  it("never converts question answers into permission grants", async () => {
    const { session, server } = setup();
    const run = session.run("Original", undefined, () => {});
    await started(server);
    await expect(server.onRequest({ id: 1, method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1" } })).resolves.toEqual({ decision: "decline" });
    await expect(server.ask(2, [{ id: "secret", question: "Password?", isSecret: true }])).rejects.toThrow("Secret");
    server.complete();
    await run;
  });

  it("fails safely if a fallback turn cannot start instead of leaving the task busy", async () => {
    const { session, server } = setup();
    const standard = server.request.getMockImplementation()!;
    let starts = 0;
    server.request.mockImplementation(async (method, params) => {
      if (method === "turn/steer") { server.complete(); throw new RpcError(-32600, "No active turn"); }
      if (method === "turn/start" && ++starts > 1) throw new RpcError(-32600, "Start rejected");
      return standard(method, params);
    });
    const run = session.run("Original");
    await started(server);
    await expect(session.followUp("New input")).rejects.toThrow("Start rejected");
    await expect(run).rejects.toThrow("Start rejected");
    expect(session.busy).toBe(false);
  });

  it("refuses to start work if the runtime returns broader permissions", async () => {
    const { session, server } = setup();
    server.request.mockResolvedValue({ thread: { id: "thread-1" }, sandbox: { type: "dangerFullAccess" }, approvalPolicy: "never" });
    await expect(session.run("Original")).rejects.toThrow("did not honor");
    expect(server.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    expect(session.busy).toBe(false);
  });

  it("cancels during startup before creating a thread", async () => {
    const { session, server } = setup();
    let initialize!: () => void;
    server.initialize.mockImplementation(() => new Promise<void>((resolve) => { initialize = resolve; }));
    const run = session.run("Original");
    session.stop();
    initialize();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(server.request).not.toHaveBeenCalled();
    expect(session.busy).toBe(false);
  });

  it("cleans up on runtime failure and can resume the saved thread next time", async () => {
    const { session, server } = setup();
    const run = session.run("Original");
    await started(server);
    server.onFailure(new Error("Runtime failed"));
    await expect(run).rejects.toThrow("Runtime failed");
    expect(session.busy).toBe(false);
    server.request.mockClear();
    const resumed = session.run("Continue");
    await started(server);
    expect(server.request.mock.calls[0]).toEqual(["thread/resume", expect.objectContaining({ threadId: "thread-1", sandbox: "read-only" })]);
    expect(server.request.mock.calls[0]![1]).not.toHaveProperty("model");
    server.complete();
    await resumed;
  });
});
