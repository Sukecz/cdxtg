import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";

export interface RpcNotification { method: string; params: Record<string, unknown> }
export interface RpcRequest extends RpcNotification { id: number | string }
export class RpcError extends Error {
  constructor(public readonly code: number, message: string) { super(message); }
}
export interface AppServerConnection {
  request(method: string, params?: unknown): Promise<Record<string, unknown>>;
  initialize(): Promise<void>;
  close(): void;
  onNotification: (message: RpcNotification) => void;
  onRequest: (message: RpcRequest) => Promise<unknown>;
  onFailure: (error: Error) => void;
}
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A private stdio connection to the Codex runtime bundled with the official SDK. */
export class AppServerClient implements AppServerConnection {
  onNotification: AppServerConnection["onNotification"] = () => {};
  onRequest: AppServerConnection["onRequest"] = async () => { throw new RpcError(-32601, "Unsupported client request."); };
  onFailure: AppServerConnection["onFailure"] = () => {};
  private nextId = 0;
  private closed = false;
  private readonly pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly lines;

  constructor(private readonly child: ChildProcessWithoutNullStreams = spawnBundledAppServer()) {
    child.stderr.resume(); // Diagnostics may contain local data; never forward them to Telegram.
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    child.on("error", () => this.fail(new Error("Could not start Codex app server.")));
    child.stdin.on("error", () => this.fail(new Error("Could not communicate with Codex app server.")));
    child.on("exit", () => this.fail(new Error("Codex app server exited unexpectedly.")));
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "cdxtg", title: "cdxtg", version: "1.2" },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized" });
  }

  request(method: string, params?: unknown): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("Codex connection is closed."));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A timeout is ambiguous: callers must never automatically replay input.
        reject(new Error(`Codex ${method} acknowledgement timed out. Delivery is uncertain; check the session before retrying.`));
      }, 30_000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, ...(params === undefined ? {} : { params }) });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex connection is closed."));
    }
    this.pending.clear();
    this.child.stdin.end();
    this.child.kill();
  }

  private send(message: unknown): void {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private receive(line: string): void {
    let message: Record<string, unknown>;
    try { message = record(JSON.parse(line)); }
    catch { this.fail(new Error("Codex returned invalid protocol data.")); return; }
    if (typeof message.method === "string") {
      const notification = { method: message.method, params: record(message.params) };
      if (typeof message.id === "number" || typeof message.id === "string") {
        const id = message.id;
        void Promise.resolve().then(() => this.onRequest({ ...notification, id })).then(
          (result) => this.send({ id, result }),
          (error: unknown) => this.send({ id, error: { code: error instanceof RpcError ? error.code : -32603, message: "Client could not answer this request." } }),
        );
      } else {
        try { this.onNotification(notification); }
        catch { this.fail(new Error("Could not process Codex notification.")); }
      }
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    const error = record(message.error);
    if (typeof error.code === "number") pending.reject(new RpcError(error.code, typeof error.message === "string" ? error.message : "Codex request failed."));
    else pending.resolve(record(message.result));
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.close();
    this.onFailure(error);
  }
}

function spawnBundledAppServer(): ChildProcessWithoutNullStreams {
  const require = createRequire(import.meta.url);
  return spawn(process.execPath, [require.resolve("@openai/codex/bin/codex.js"), "app-server", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
}
