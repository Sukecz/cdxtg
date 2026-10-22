import { vi } from "vitest";
import type { AppServerConnection, RpcNotification, RpcRequest } from "../../src/app-server.js";

export class FakeAppServer implements AppServerConnection {
  onNotification: (message: RpcNotification) => void = () => {};
  onRequest: (message: RpcRequest) => Promise<unknown> = async () => ({});
  onFailure: (error: Error) => void = () => {};
  initialize = vi.fn(async () => {});
  close = vi.fn();
  turnId = "turn-1";
  request = vi.fn(async (method: string, _params?: unknown): Promise<Record<string, unknown>> => {
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "thread-1" }, model: "test-model", sandbox: { type: "readOnly" }, approvalPolicy: "never" };
    if (method === "turn/start") {
      this.emit("turn/started", { turn: { id: this.turnId, status: "inProgress" } });
      return { turn: { id: this.turnId, status: "inProgress" } };
    }
    if (method === "turn/steer") return { turnId: this.turnId };
    if (method === "turn/interrupt") { this.complete("", "interrupted"); return {}; }
    return {};
  });
  emit(method: string, params: Record<string, unknown> = {}): void {
    this.onNotification({ method, params: { threadId: "thread-1", turnId: this.turnId, ...params } });
  }
  complete(text = "Final answer", status = "completed"): void {
    if (text) this.emit("item/completed", { item: { type: "agentMessage", id: "final", text, phase: "final_answer" } });
    this.emit("turn/completed", { turn: { id: this.turnId, status, items: [] } });
  }
  ask(id: number | string = "question-1", questions: unknown[] = [{ id: "q1", question: "Which target?", options: [{ label: "A", description: "First" }, { label: "B", description: "Second" }] }]): Promise<unknown> {
    return this.onRequest({ id, method: "item/tool/requestUserInput", params: { threadId: "thread-1", turnId: this.turnId, questions } });
  }
}
