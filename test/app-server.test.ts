import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerClient, RpcError } from "../src/app-server.js";

function setup() {
  const messages: Record<string, unknown>[] = [];
  const child = new EventEmitter() as EventEmitter & { stdin: Writable; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
  child.stdin = new Writable({ write(chunk, _encoding, callback) { messages.push(JSON.parse(String(chunk))); callback(); } });
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  const client = new AppServerClient(child as unknown as ChildProcessWithoutNullStreams);
  const send = (value: unknown) => child.stdout.write(JSON.stringify(value) + "\n");
  return { client, child, messages, send };
}
afterEach(() => vi.useRealTimers());

describe("Codex JSON-RPC connection", () => {
  it("initializes once and correlates responses independently of server notifications", async () => {
    const { client, messages, send } = setup();
    const initialized = client.initialize();
    expect(messages[0]).toMatchObject({ method: "initialize", params: { capabilities: { experimentalApi: true } } });
    send({ id: messages[0]!.id, result: {} });
    await initialized;
    expect(messages[1]).toEqual({ method: "initialized" });
    const notify = vi.fn();
    client.onNotification = notify;
    const first = client.request("thread/start", { cwd: "/workspace" });
    const second = client.request("model/list");
    send({ method: "turn/started", params: { threadId: "thread" } });
    send({ id: messages[3]!.id, result: { data: [] } });
    send({ id: messages[2]!.id, result: { thread: { id: "thread" } } });
    await expect(first).resolves.toMatchObject({ thread: { id: "thread" } });
    await expect(second).resolves.toEqual({ data: [] });
    expect(notify).toHaveBeenCalledOnce();
    client.close();
  });

  it("returns a server-request answer with the original request ID", async () => {
    const { client, messages, send } = setup();
    client.onRequest = async () => ({ answers: { q: { answers: ["B"] } } });
    send({ id: "question-42", method: "item/tool/requestUserInput", params: {} });
    await vi.waitFor(() => expect(messages).toContainEqual({ id: "question-42", result: { answers: { q: { answers: ["B"] } } } }));
    client.close();
  });

  it("distinguishes explicit rejection from an uncertain timeout", async () => {
    vi.useFakeTimers();
    const { client, messages, send } = setup();
    const rejected = client.request("turn/steer");
    send({ id: messages[0]!.id, error: { code: -32600, message: "No active turn" } });
    await expect(rejected).rejects.toBeInstanceOf(RpcError);
    const timedOut = client.request("turn/steer");
    const assertion = expect(timedOut).rejects.toThrow("Delivery is uncertain");
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    client.close();
  });

  it("rejects outstanding requests and reports process failure without exposing stderr", async () => {
    const { client, child } = setup();
    const failed = vi.fn();
    client.onFailure = failed;
    const pending = client.request("thread/start");
    child.stderr.write("sensitive diagnostics");
    child.emit("exit", 1);
    await expect(pending).rejects.toThrow("connection is closed");
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "Codex app server exited unexpectedly." }));
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
