import { Codex, type Thread } from "@openai/codex-sdk";
import type { Update } from "grammy/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBot } from "../src/bot.js";
import { loadConfig } from "../src/config.js";

afterEach(() => vi.restoreAllMocks());

describe("/stop during a running turn", () => {
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
