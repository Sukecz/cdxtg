import { Codex, type Thread } from "@openai/codex-sdk";
import type { Update } from "grammy/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBot } from "../src/bot.js";
import { loadConfig } from "../src/config.js";

afterEach(() => vi.restoreAllMocks());

describe("/stop during a running turn", () => {
  it.each(["off", "brief", "verbose"])("accepts a reply during work with %s streaming and delivers the continued answer", async (mode) => {
    const inputs: string[] = [];
    const thread = {
      runStreamed: async (prompt: string, { signal }: { signal: AbortSignal }) => {
        inputs.push(prompt);
        const first = inputs.length === 1;
        return { events: (async function* () {
          yield { type: "thread.started" as const, thread_id: "same-thread" };
          yield { type: "turn.started" as const };
          if (first) {
            await new Promise<void>((_resolve, reject) => {
              const abort = () => reject(new DOMException("Aborted", "AbortError"));
              if (signal.aborted) abort();
              else signal.addEventListener("abort", abort, { once: true });
            });
          }
          yield { type: "item.completed" as const, item: { id: "reply", type: "agent_message" as const, text: "Answer incorporated" } };
        })() };
      },
    };
    vi.spyOn(Codex.prototype, "startThread").mockReturnValue(thread as unknown as Thread);
    const bot = createBot(loadConfig({
      TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_ALLOWED_USER_IDS: "123",
      CODEX_WORKSPACES: process.cwd(), TELEGRAM_STREAM_MODE: mode,
    }));
    const sent: string[] = [];
    const methods: string[] = [];
    bot.api.config.use((async (_previous, method, payload) => {
      methods.push(method);
      if (method === "getMe") return { ok: true, result: { id: 1, is_bot: true, first_name: "Test", username: "test_bot" } };
      if (method === "sendMessage" || method === "editMessageText") sent.push(String((payload as { text: string }).text));
      return { ok: true, result: { message_id: sent.length, chat: { id: 123, type: "private" }, date: 0 } };
    }) as Parameters<typeof bot.api.config.use>[0]);
    await bot.init();
    await bot.handleUpdate(message(1, "A long task"));
    await bot.handleUpdate(message(2, "My answer"));
    expect(sent.some((text) => text.startsWith("Follow-up received."))).toBe(true);
    await vi.waitFor(() => expect(sent).toContain("Answer incorporated"));
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toContain("My answer");
    expect(sent).not.toContain("The task was stopped.");
    expect(methods).not.toContain("sendMessageDraft");
  });

  it("processes the stop update while the SDK stream is still active", async () => {
    let aborted = false;
    const thread = {
      runStreamed: async (_prompt: string, options: { signal: AbortSignal }) => ({
        events: (async function* () {
          if (options.signal.aborted) {
            aborted = true;
            throw new DOMException("The task was aborted", "AbortError");
          }
          await new Promise<void>((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
              aborted = true;
              reject(new DOMException("The task was aborted", "AbortError"));
            }, { once: true });
          });
          yield { type: "turn.completed" as const };
        })(),
      }),
    };
    vi.spyOn(Codex.prototype, "startThread").mockReturnValue(thread as unknown as Thread);

    const bot = createBot(loadConfig({
      TELEGRAM_BOT_TOKEN: "test-token",
      TELEGRAM_ALLOWED_USER_IDS: "123",
      CODEX_WORKSPACES: process.cwd(),
      TELEGRAM_STREAM_MODE: "off",
    }));
    const sent: string[] = [];
    const fakeApi = async (_previous: unknown, method: string, payload: Record<string, unknown>) => {
      if (method === "getMe") return { ok: true, result: { id: 1, is_bot: true, first_name: "Test", username: "test_bot" } };
      if (method === "sendMessage" || method === "editMessageText") {
        sent.push(String("text" in payload ? payload.text : ""));
      }
      return { ok: true, result: { message_id: sent.length, chat: { id: 123, type: "private" }, date: 0 } };
    };
    bot.api.config.use(fakeApi as Parameters<typeof bot.api.config.use>[0]);
    await bot.init();

    await bot.handleUpdate(message(1, "A long task"));
    expect(aborted).toBe(false);

    await bot.handleUpdate(message(2, "/stop"));
    expect(sent).toContain("Stopping the running task…");
    await vi.waitFor(() => expect(aborted).toBe(true));
  });
});

function message(updateId: number, text: string): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: { id: 123, type: "private", first_name: "Test" },
      from: { id: 123, is_bot: false, first_name: "Test" },
      text,
      ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.length }] } : {}),
    },
  } as Update;
}
