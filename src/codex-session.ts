import { Codex, type ApprovalMode, type SandboxMode, type Thread } from "@openai/codex-sdk";

export interface SessionOptions {
  workspace: string;
  mode: Extract<SandboxMode, "read-only" | "workspace-write">;
  approvalPolicy: ApprovalMode;
  model?: string;
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

  constructor(options: SessionOptions) {
    this.options = options;
  }

  get busy(): boolean {
    return this.abortController !== null;
  }

  get info(): Readonly<SessionOptions> & { threadId: string | null; busy: boolean } {
    return { ...this.options, threadId: this.currentThreadId, busy: this.busy };
  }

  reset(next?: Partial<Pick<SessionOptions, "workspace" | "mode">>): void {
    if (this.busy) throw new Error("Nejdřív zastavte běžící úlohu pomocí /stop.");
    this.options = { ...this.options, ...next };
    this.thread = null;
    this.currentThreadId = null;
  }

  stop(): boolean {
    if (!this.abortController) return false;
    this.abortController.abort();
    return true;
  }

  async run(prompt: string): Promise<RunResult> {
    if (this.busy) throw new Error("V tomto chatu už jedna úloha běží. Použijte /stop nebo počkejte.");
    if (!this.thread) this.thread = this.codex.startThread(this.threadOptions());

    const controller = new AbortController();
    this.abortController = controller;
    let text = "";

    try {
      const { events } = await this.thread.runStreamed(prompt, { signal: controller.signal });
      for await (const event of events) {
        if (event.type === "thread.started") this.currentThreadId = event.thread_id;
        if (event.type === "item.completed" && event.item.type === "agent_message") {
          text = event.item.text;
        }
        if (event.type === "turn.failed") throw new Error(event.error.message);
        if (event.type === "error") throw new Error(event.message);
      }
      return { text, threadId: this.currentThreadId };
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  private threadOptions(): {
    workingDirectory: string;
    sandboxMode: Extract<SandboxMode, "read-only" | "workspace-write">;
    approvalPolicy: ApprovalMode;
    skipGitRepoCheck: true;
    model?: string;
  } {
    return {
      workingDirectory: this.options.workspace,
      sandboxMode: this.options.mode,
      approvalPolicy: this.options.approvalPolicy,
      skipGitRepoCheck: true,
      ...(this.options.model ? { model: this.options.model } : {}),
    };
  }
}
