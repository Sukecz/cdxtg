import { Codex, type ApprovalMode, type ModelReasoningEffort, type SandboxMode, type Thread, type ThreadEvent } from "@openai/codex-sdk";

export interface SessionOptions {
  workspace: string;
  mode: Extract<SandboxMode, "read-only" | "workspace-write" | "danger-full-access">;
  approvalPolicy: ApprovalMode;
  model?: string;
  reasoningEffort?: ModelReasoningEffort;
}

export interface RunResult {
  text: string;
  threadId: string | null;
}

export class CodexSession {
  private readonly codex = new Codex();
  private thread: Thread | null = null;
  private abortController: AbortController | null = null;
  private options: SessionOptions;
  private currentThreadId: string | null = null;
  private pendingInputs: string[] = [];
  private turnStarted = false;
  private stopping = false;

  constructor(options: SessionOptions) {
    this.options = options;
  }

  get busy(): boolean {
    return this.abortController !== null;
  }

  get info(): Readonly<SessionOptions> & { threadId: string | null; busy: boolean } {
    return { ...this.options, threadId: this.currentThreadId, busy: this.busy };
  }

  reset(next?: Partial<Pick<SessionOptions, "workspace" | "mode" | "model" | "reasoningEffort">>): void {
    if (this.busy) throw new Error("Stop the running task with /stop first.");
    this.options = { ...this.options, ...next };
    this.thread = null;
    this.currentThreadId = null;
  }

  resume(threadId: string, workspace: string): void {
    if (this.busy) throw new Error("Stop the running task with /stop first.");
    if (!threadId) throw new Error("Cannot resume a session without a thread ID.");
    this.options = { ...this.options, workspace };
    this.thread = this.codex.resumeThread(threadId, this.resumeThreadOptions());
    this.currentThreadId = threadId;
  }

  stop(): boolean {
    if (!this.abortController) return false;
    this.stopping = true;
    this.pendingInputs = [];
    this.abortController.abort();
    return true;
  }

  followUp(prompt: string): void {
    if (!this.busy) throw new Error("No task is running in this chat.");
    if (this.stopping) throw new Error("The task is stopping. Send your message again once it stops.");
    this.pendingInputs.push(prompt);
    // Wait until the initial input has reached the thread before cancelling it.
    if (this.turnStarted) this.abortController!.abort();
  }

  async run(prompt: string, onEvent?: (event: ThreadEvent) => void): Promise<RunResult> {
    if (this.busy) throw new Error("A task is already running in this chat. Wait or use /stop.");
    if (!this.thread) this.thread = this.codex.startThread(this.threadOptions());

    const controller = new AbortController();
    this.abortController = controller;
    this.stopping = false;
    this.turnStarted = false;

    try {
      let input = prompt;
      const inputs = [prompt];
      while (true) {
        let text = "";
        const activeController = this.abortController!;
        try {
          const { events } = await this.thread.runStreamed(input, { signal: activeController.signal });
          for await (const event of events) {
            if (event.type === "thread.started") this.currentThreadId = event.thread_id;
            if (event.type === "turn.started") this.turnStarted = true;
            if (this.turnStarted && this.pendingInputs.length > 0) activeController.abort();
            // An interrupted turn is an implementation detail, not a task failure.
            if (!activeController.signal.aborted) onEvent?.(event);
            if (event.type === "item.completed" && event.item.type === "agent_message") {
              text = event.item.text;
            }
            if (event.type === "turn.failed") throw new Error(event.error.message);
            if (event.type === "error") throw new Error(event.message);
          }
        } catch (error) {
          if (this.stopping) throw new DOMException("The task was aborted", "AbortError");
          if (!activeController.signal.aborted || this.pendingInputs.length === 0) throw error;
        }
        if (this.stopping) throw new DOMException("The task was aborted", "AbortError");
        if (this.pendingInputs.length === 0) return { text, threadId: this.currentThreadId };
        // Exec can emit turn.started before the original user message is durably
        // saved. Carry all inputs across interruptions so early replies cannot
        // discard the task, even when the resumed history is still incomplete.
        inputs.push(...this.pendingInputs);
        input = "The previous SDK turn was interrupted. Continue the original task using the following user messages in chronological order:\n\n"
          + inputs.map((message, index) => `User message ${index + 1}:\n${message}`).join("\n\n");
        this.pendingInputs = [];
        this.turnStarted = false;
        this.abortController = new AbortController();
      }
    } finally {
      this.abortController = null;
      this.pendingInputs = [];
      this.turnStarted = false;
    }
  }

  private threadOptions(): {
    workingDirectory: string;
    sandboxMode: Extract<SandboxMode, "read-only" | "workspace-write" | "danger-full-access">;
    approvalPolicy: ApprovalMode;
    skipGitRepoCheck: true;
    model?: string;
    modelReasoningEffort?: ModelReasoningEffort;
  } {
    return {
      workingDirectory: this.options.workspace,
      sandboxMode: this.options.mode,
      approvalPolicy: this.options.approvalPolicy,
      skipGitRepoCheck: true,
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.reasoningEffort ? { modelReasoningEffort: this.options.reasoningEffort } : {}),
    };
  }

  private resumeThreadOptions(): {
    workingDirectory: string;
    sandboxMode: Extract<SandboxMode, "read-only" | "workspace-write" | "danger-full-access">;
    approvalPolicy: ApprovalMode;
    skipGitRepoCheck: true;
  } {
    return {
      workingDirectory: this.options.workspace,
      sandboxMode: this.options.mode,
      approvalPolicy: this.options.approvalPolicy,
      skipGitRepoCheck: true,
    };
  }
}
