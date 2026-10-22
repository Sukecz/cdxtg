import { randomBytes } from "node:crypto";
import type { ApprovalMode, ModelReasoningEffort, SandboxMode, ThreadEvent } from "@openai/codex-sdk";
import { AppServerClient, RpcError, record, type AppServerConnection, type RpcNotification, type RpcRequest } from "./app-server.js";
import { previewEvent } from "./app-server-events.js";

export interface SessionOptions {
  workspace: string;
  mode: Extract<SandboxMode, "read-only" | "workspace-write" | "danger-full-access">;
  approvalPolicy: ApprovalMode;
  model?: string;
  reasoningEffort?: ModelReasoningEffort;
}
export interface RunResult { text: string; threadId: string | null }
export interface QuestionPrompt {
  token: string;
  kind: "answer" | "follow-up";
  title: string;
  options: readonly { label: string; description: string }[];
}
interface PendingQuestion {
  requestId: number | string;
  questions: Record<string, unknown>[];
  index: number;
  prompt: QuestionPrompt;
  answers: Record<string, { answers: string[] }>;
  result: Deferred<unknown>;
}
interface ActiveRun {
  client: AppServerConnection;
  ready: Deferred<void>;
  completion: Deferred<Record<string, unknown>>;
  turnId: string | null;
  ended: boolean;
  stopping: boolean;
  tail: Promise<void>;
  stopTimer?: NodeJS.Timeout;
  text: Map<string, string>;
  answers: Map<string, { text: string; phase: unknown }>;
  finishedTurns: Set<string>;
  onEvent?: (event: ThreadEvent) => void;
  onQuestion?: (question: QuestionPrompt) => void;
}
interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"], reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
const aborted = (): Error => new DOMException("The task was aborted", "AbortError");
const input = (text: string) => [{ type: "text", text, text_elements: [] }];

export class CodexSession {
  private active: ActiveRun | null = null;
  private currentThreadId: string | null = null;
  private pendingQuestion: PendingQuestion | null = null;

  constructor(private options: SessionOptions, private readonly connect: () => AppServerConnection = () => new AppServerClient()) {}

  get busy(): boolean { return this.active !== null; }
  get question(): QuestionPrompt | null { return this.pendingQuestion?.prompt ?? null; }
  get info(): Readonly<SessionOptions> & { threadId: string | null; busy: boolean } {
    return { ...this.options, threadId: this.currentThreadId, busy: this.busy };
  }
  reset(next?: Partial<Pick<SessionOptions, "workspace" | "mode" | "model" | "reasoningEffort">>): void {
    if (this.busy) throw new Error("Stop the running task with /stop first.");
    this.options = { ...this.options, ...next };
    this.currentThreadId = null;
  }
  resume(threadId: string, workspace: string): void {
    if (this.busy) throw new Error("Stop the running task with /stop first.");
    if (!threadId) throw new Error("Cannot resume a session without a thread ID.");
    this.options = { ...this.options, workspace };
    this.currentThreadId = threadId;
  }

  stop(): boolean {
    const run = this.active;
    if (!run) return false;
    if (run.stopping) return true;
    run.stopping = true;
    this.clearQuestion();
    if (run.turnId && !run.ended) {
      void run.client.request("turn/interrupt", { threadId: this.currentThreadId, turnId: run.turnId })
        .catch(() => run.completion.reject(aborted()));
    }
    // Also bounds cancellation while initialization or turn/start is in flight.
    run.stopTimer = setTimeout(() => {
      run.ready.reject(aborted());
      run.completion.reject(aborted());
      run.client.close();
    }, 8_000);
    run.stopTimer.unref();
    return true;
  }

  followUp(prompt: string): Promise<void> {
    const run = this.active;
    if (!run) return Promise.reject(new Error("No task is running in this chat."));
    if (run.stopping) return Promise.reject(new Error("The task is stopping. Send your message again once it stops."));
    const delivery = run.tail.then(async () => {
      await run.ready.promise;
      if (run.stopping) throw aborted();
      if (run.ended) { await this.startTurn(run, prompt); return; }
      const turnId = run.turnId;
      try {
        const result = await run.client.request("turn/steer", { threadId: this.currentThreadId, expectedTurnId: turnId, input: input(prompt) });
        if (result.turnId !== turnId) throw new Error("Follow-up acknowledgement is uncertain. Check the session before retrying.");
      } catch (error) {
        // Only a definite rejection plus observed completion permits a new turn.
        // Never replay input after a transport error or lost acknowledgement.
        if (error instanceof RpcError && run.ended && !run.stopping) await this.startTurn(run, prompt);
        else throw error;
      }
    });
    run.tail = delivery.catch(() => undefined);
    return delivery;
  }

  answerQuestion(token: string, answer: string): void {
    const pending = this.pendingQuestion;
    if (!pending || pending.prompt.token !== token || this.active?.stopping) throw new Error("This question has expired.");
    const question = pending.questions[pending.index]!;
    pending.answers[String(question.id)] = { answers: [answer] };
    pending.index++;
    if (pending.index === pending.questions.length) {
      this.pendingQuestion = null;
      pending.result.resolve({ answers: pending.answers });
    } else {
      pending.prompt = this.questionPrompt(pending.questions[pending.index]!);
      this.active?.onQuestion?.(pending.prompt);
    }
  }

  async run(prompt: string, onEvent?: (event: ThreadEvent) => void, onQuestion?: (question: QuestionPrompt) => void): Promise<RunResult> {
    if (this.busy) throw new Error("A task is already running in this chat.");
    const run: ActiveRun = {
      client: this.connect(), ready: deferred(), completion: deferred(), turnId: null,
      ended: true, stopping: false, tail: Promise.resolve(), text: new Map(), answers: new Map(), finishedTurns: new Set(),
      ...(onEvent ? { onEvent } : {}), ...(onQuestion ? { onQuestion } : {}),
    };
    this.active = run;
    run.client.onNotification = (event) => this.notify(run, event);
    run.client.onRequest = (request) => this.requestUser(run, request);
    run.client.onFailure = (error) => { run.ready.reject(error); run.completion.reject(error); this.clearQuestion(); };
    try {
      await run.client.initialize();
      if (run.stopping) throw aborted();
      const resuming = this.currentThreadId !== null;
      const response = await run.client.request(resuming ? "thread/resume" : "thread/start", {
        ...(resuming ? { threadId: this.currentThreadId } : {}),
        cwd: this.options.workspace, sandbox: this.options.mode, approvalPolicy: this.options.approvalPolicy,
        // Preserve a resumed session's effective model and effort.
        ...(!resuming && this.options.model ? { model: this.options.model } : {}),
        ...(!resuming && this.options.reasoningEffort ? { config: { model_reasoning_effort: this.options.reasoningEffort } } : {}),
      });
      const thread = record(response.thread);
      if (typeof thread.id !== "string") throw new Error("Codex returned no thread ID.");
      const expectedSandbox = { "read-only": "readOnly", "workspace-write": "workspaceWrite", "danger-full-access": "dangerFullAccess" }[this.options.mode];
      if (record(response.sandbox).type !== expectedSandbox || response.approvalPolicy !== this.options.approvalPolicy) {
        throw new Error("Codex did not honor the requested sandbox and approval policy.");
      }
      this.currentThreadId = thread.id;
      if (typeof response.model === "string") this.options.model = response.model;
      if (typeof response.reasoningEffort === "string") this.options.reasoningEffort = response.reasoningEffort as ModelReasoningEffort;
      onEvent?.({ type: "thread.started", thread_id: thread.id });
      if (run.stopping) throw aborted();
      await this.startTurn(run, prompt);
      run.ready.resolve();
      while (true) {
        const completion = run.completion;
        const turn = await completion.promise;
        // Hold the connection until every accepted inbound delivery has settled.
        while (true) {
          const tail = run.tail;
          await tail;
          if (tail === run.tail) break;
        }
        if (run.stopping || turn.status === "interrupted") throw aborted();
        if (completion !== run.completion) continue;
        if (turn.status === "failed") throw new Error(String(record(turn.error).message ?? "Codex turn failed."));
        const messages = [...run.answers.values()];
        const finals = messages.filter((message) => message.phase === "final_answer");
        const text = (finals.length ? finals : messages).map((message) => message.text).filter(Boolean).join("\n\n");
        return { text, threadId: this.currentThreadId };
      }
    } catch (error) {
      run.ready.reject(error instanceof Error ? error : new Error("Codex task failed."));
      throw run.stopping ? aborted() : error;
    } finally {
      if (run.stopTimer) clearTimeout(run.stopTimer);
      this.clearQuestion();
      run.client.close();
      if (this.active === run) this.active = null;
    }
  }

  private async startTurn(run: ActiveRun, prompt: string): Promise<void> {
    if (run.stopping) throw aborted();
    run.completion = deferred();
    run.ended = false;
    run.turnId = null;
    run.text.clear();
    run.answers.clear();
    try {
      const response = await run.client.request("turn/start", { threadId: this.currentThreadId, input: input(prompt) });
      const turn = record(response.turn);
      if (typeof turn.id !== "string") throw new Error("Codex returned no turn ID.");
      run.turnId = turn.id;
      if (["completed", "failed", "interrupted"].includes(String(turn.status))) this.completeTurn(run, turn);
      if (run.stopping && !run.ended) {
        await run.client.request("turn/interrupt", { threadId: this.currentThreadId, turnId: run.turnId });
      }
    } catch (error) {
      run.ended = true;
      run.completion.reject(error instanceof Error ? error : new Error("Could not start Codex turn."));
      throw error;
    }
  }

  private notify(run: ActiveRun, notification: RpcNotification): void {
    const { method, params } = notification;
    if (params.threadId !== this.currentThreadId) return;
    const eventTurnId = params.turnId ?? record(params.turn).id;
    if (typeof eventTurnId === "string" && run.finishedTurns.has(eventTurnId)) return;
    if (run.turnId && eventTurnId && eventTurnId !== run.turnId) return;
    if (method === "turn/started") {
      run.turnId = String(record(params.turn).id);
      run.onEvent?.({ type: "turn.started" });
    }
    if (method === "serverRequest/resolved" && params.requestId === this.pendingQuestion?.requestId) this.clearQuestion();
    if (method === "item/completed") {
      const item = record(params.item);
      if (item.type === "agentMessage") {
        run.answers.set(String(item.id), { text: String(item.text ?? ""), phase: item.phase });
        if (Array.isArray(item.questions)) {
          for (const question of item.questions) {
            const q = record(question);
            run.onQuestion?.({ token: randomBytes(8).toString("hex"), kind: "follow-up", title: String(q.title ?? "Codex question"), options: Array.isArray(q.options) ? q.options.map((option) => ({ label: String(option), description: "" })) : [] });
          }
        }
      }
    }
    const preview = previewEvent(notification, run.text);
    if (preview) run.onEvent?.(preview);
    if (method === "turn/completed") this.completeTurn(run, record(params.turn));
    if (method === "error" && params.willRetry !== true) run.completion.reject(new Error(String(record(params.error).message ?? "Codex runtime failed.")));
  }

  private completeTurn(run: ActiveRun, turn: Record<string, unknown>): void {
    if (Array.isArray(turn.items)) {
      for (const raw of turn.items) {
        const item = record(raw);
        if (item.type === "agentMessage") run.answers.set(String(item.id), { text: String(item.text ?? ""), phase: item.phase });
      }
    }
    run.ended = true;
    if (typeof turn.id === "string") run.finishedTurns.add(turn.id);
    this.clearQuestion();
    run.completion.resolve(turn);
  }

  private async requestUser(run: ActiveRun, request: RpcRequest): Promise<unknown> {
    const params = request.params;
    if (params.threadId !== this.currentThreadId || (run.turnId && params.turnId && params.turnId !== run.turnId) || run.stopping) throw new Error("Stale Codex request.");
    // Telegram question answers never grant command, file, or network permissions.
    if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") return { decision: "decline" };
    if (request.method === "item/permissions/requestApproval") return { permissions: {}, scope: "turn" };
    if (request.method === "mcpServer/elicitation/request") return { action: "decline", content: null };
    if (request.method !== "item/tool/requestUserInput" || !run.onQuestion) throw new RpcError(-32601, "Unsupported client request.");
    if (!Array.isArray(params.questions) || !params.questions.length) throw new Error("Invalid Codex question.");
    const questions = params.questions.map(record);
    if (questions.some((q) => q.isSecret || typeof q.id !== "string" || typeof q.question !== "string")) throw new Error("Secret or invalid questions cannot be answered through Telegram.");
    if (this.pendingQuestion) throw new Error("Another question is already pending.");
    const result = deferred<unknown>();
    const pending: PendingQuestion = { requestId: request.id, questions, index: 0, prompt: this.questionPrompt(questions[0]!), answers: {}, result };
    this.pendingQuestion = pending;
    try { run.onQuestion(pending.prompt); return await result.promise; }
    finally { if (this.pendingQuestion === pending) this.pendingQuestion = null; }
  }

  private questionPrompt(question: Record<string, unknown>): QuestionPrompt {
    return { token: randomBytes(8).toString("hex"), kind: "answer", title: String(question.question), options: Array.isArray(question.options) ? question.options.map((option) => ({ label: String(record(option).label ?? ""), description: String(record(option).description ?? "") })) : [] };
  }
  private clearQuestion(): void {
    this.pendingQuestion?.result.reject(new Error("The question has expired."));
    this.pendingQuestion = null;
  }
}
