import type { Update } from "grammy/types";
import { describe, expect, it, vi } from "vitest";
import { createBot } from "../src/bot.js";
import { loadConfig } from "../src/config.js";
import { CodexSession } from "../src/codex-session.js";
import { FakeAppServer } from "./helpers/app-server.js";

async function setup(mode = "off") {
  const server = new FakeAppServer();
  const bot = createBot(loadConfig({ TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_ALLOWED_USER_IDS: "123,456", CODEX_WORKSPACES: process.cwd(), TELEGRAM_STREAM_MODE: mode }), (options) => new CodexSession(options, () => server));
  const sent: string[] = [];
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  bot.api.config.use((async (_previous, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "getMe") return { ok: true, result: { id: 1, is_bot: true, first_name: "Test", username: "test_bot" } };
    if (method === "sendMessage" || method === "editMessageText") sent.push(String((payload as { text: string }).text));
    return { ok: true, result: { message_id: sent.length, chat: { id: 123, type: "private" }, date: 0 } };
  }) as Parameters<typeof bot.api.config.use>[0]);
  await bot.init();
  await bot.handleUpdate(message(1, "A long task"));
  await vi.waitFor(() => expect(server.request).toHaveBeenCalledWith("turn/start", expect.anything()));
  return { bot, server, sent, calls };
}

describe("live Telegram task controls", () => {
  it.each(["off", "brief", "verbose"])("steers during %s streaming without drafts or interruption", async (mode) => {
    const { bot, server, sent, calls } = await setup(mode);
    await bot.handleUpdate(message(2, "My answer"));
    await vi.waitFor(() => expect(sent).toContain("Follow-up delivered to Codex."));
    expect(server.request).toHaveBeenCalledWith("turn/steer", expect.objectContaining({ expectedTurnId: "turn-1" }));
    expect(server.request.mock.calls.some(([method]) => method === "turn/interrupt")).toBe(false);
    server.complete("Answer incorporated");
    await vi.waitFor(() => expect(sent).toContain("Answer incorporated"));
    expect(calls.some(({ method }) => method === "sendMessageDraft")).toBe(false);
  });

  it("processes /stop without waiting for Codex to finish", async () => {
    const { bot, server, sent } = await setup();
    await bot.handleUpdate(message(2, "/stop"));
    expect(sent).toContain("Stopping the running task…");
    await vi.waitFor(() => expect(sent).toContain("The task was stopped."));
    expect(server.request).toHaveBeenCalledWith("turn/interrupt", expect.anything());
  });

  it("returns to polling while steering acknowledgement is pending so /stop still works", async () => {
    const { bot, server, sent } = await setup();
    const standard = server.request.getMockImplementation()!;
    let rejectSteer!: (error: Error) => void;
    server.request.mockImplementation((method, params) => method === "turn/steer"
      ? new Promise((_resolve, reject) => { rejectSteer = reject; }) : standard(method, params));
    await bot.handleUpdate(message(2, "More context"));
    await vi.waitFor(() => expect(rejectSteer).toBeTypeOf("function"));
    await bot.handleUpdate(message(3, "/stop"));
    expect(sent).toContain("Stopping the running task…");
    rejectSteer(new Error("Stopped before delivery"));
    await vi.waitFor(() => expect(sent).toContain("The task was stopped."));
  });

  it("shows a native question even with streaming off and accepts text only from its owner", async () => {
    const { bot, server, sent } = await setup();
    const answer = server.ask();
    await vi.waitFor(() => expect(sent.some((text) => text.includes("Which target?"))).toBe(true));
    await bot.handleUpdate(message(2, "Wrong owner", 456));
    expect(sent).toContain("This question belongs to the user who started the task.");
    await bot.handleUpdate(message(3, "Custom answer"));
    await expect(answer).resolves.toEqual({ answers: { q1: { answers: ["Custom answer"] } } });
    expect(server.request.mock.calls.some(([method]) => method === "turn/steer")).toBe(false);
    server.complete();
    await vi.waitFor(() => expect(sent).toContain("Final answer"));
  });

  it("accepts an inline answer and rejects an expired duplicate", async () => {
    const { bot, server, sent, calls } = await setup();
    const answer = server.ask();
    await vi.waitFor(() => expect(sent.some((text) => text.includes("Which target?"))).toBe(true));
    const question = calls.find(({ method, payload }) => method === "sendMessage" && String(payload.text).includes("Which target?"))!;
    const markup = question.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    const data = markup.inline_keyboard[1]![0]!.callback_data;
    await bot.handleUpdate(callback(2, data));
    await expect(answer).resolves.toEqual({ answers: { q1: { answers: ["B"] } } });
    await bot.handleUpdate(callback(3, data));
    expect(calls.some(({ method, payload }) => method === "answerCallbackQuery" && String(payload.text).includes("expired"))).toBe(true);
    server.complete();
    await vi.waitFor(() => expect(sent).toContain("Final answer"));
  });

  it("turns a structured asynchronous question button into a normal follow-up", async () => {
    const { bot, server, sent, calls } = await setup();
    server.emit("item/completed", { item: { id: "async", type: "agentMessage", text: "", delivery: "async", questions: [{ title: "Pick a target", options: ["A", "B"] }] } });
    await vi.waitFor(() => expect(sent.some((text) => text.includes("Pick a target"))).toBe(true));
    const question = calls.find(({ method, payload }) => method === "sendMessage" && String(payload.text).includes("Pick a target"))!;
    const markup = question.payload.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    await bot.handleUpdate(callback(2, markup.inline_keyboard[0]![0]!.callback_data));
    await vi.waitFor(() => expect(server.request).toHaveBeenCalledWith("turn/steer", expect.objectContaining({ input: [{ type: "text", text: "Pick a target\nAnswer: A", text_elements: [] }] })));
    server.complete();
    await vi.waitFor(() => expect(sent).toContain("Final answer"));
  });
});

function message(updateId: number, text: string, userId = 123): Update {
  return { update_id: updateId, message: { message_id: updateId, date: 0, chat: { id: 123, type: "private", first_name: "Test" }, from: { id: userId, is_bot: false, first_name: "Test" }, text,
    ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.length }] } : {}) } } as Update;
}
function callback(id: number, data: string): Update {
  return { update_id: id, callback_query: { id: String(id), from: { id: 123, is_bot: false, first_name: "Test" }, chat_instance: "test", data,
    message: { message_id: 10, date: 0, chat: { id: 123, type: "private", first_name: "Test" } } } } as Update;
}
