import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { TelegramStreamPresenter } from "../src/telegram-stream.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("TelegramStreamPresenter", () => {
  it("uses ephemeral Telegram drafts in private chats and persists the final answer", async () => {
    vi.useFakeTimers();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 10 });
    const ctx = {
      chat: { id: 123, type: "private" },
      api: { sendMessageDraft, editMessageText: vi.fn() },
      reply,
    } as unknown as Context;
    const presenter = new TelegramStreamPresenter(ctx, "brief");

    await presenter.start();
    presenter.onEvent({
      type: "item.updated",
      item: { id: "a", type: "agent_message", text: "Streaming answer" },
    });
    await vi.advanceTimersByTimeAsync(1_300);

    expect(sendMessageDraft).toHaveBeenCalledWith(123, expect.any(Number), "");
    expect(sendMessageDraft).toHaveBeenLastCalledWith(123, expect.any(Number), expect.stringContaining("Streaming answer"));

    await presenter.complete("Final answer");
    expect(reply).toHaveBeenCalledWith("Final answer");
  });

  it("falls back to editing one placeholder outside private chats", async () => {
    vi.useFakeTimers();
    const editMessageText = vi.fn().mockResolvedValue({});
    const reply = vi.fn().mockResolvedValue({ message_id: 44 });
    const ctx = {
      chat: { id: -100, type: "group" },
      api: { sendMessageDraft: vi.fn(), editMessageText },
      reply,
    } as unknown as Context;
    const presenter = new TelegramStreamPresenter(ctx, "brief");

    await presenter.start();
    presenter.onEvent({ type: "turn.started" });
    await vi.advanceTimersByTimeAsync(1_300);
    await presenter.complete("Done");

    expect(reply).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenLastCalledWith(-100, 44, "Done");
  });
});
