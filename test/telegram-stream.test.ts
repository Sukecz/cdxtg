import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { TelegramStreamPresenter } from "../src/telegram-stream.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("TelegramStreamPresenter", () => {
  it.each(["brief", "verbose"] as const)("uses an ordinary private-chat message in %s mode without native drafts", async (mode) => {
    vi.useFakeTimers();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 10 });
    const editMessageText = vi.fn().mockResolvedValue({});
    const ctx = {
      chat: { id: 123, type: "private" },
      api: { sendMessageDraft, editMessageText },
      reply,
    } as unknown as Context;
    const presenter = new TelegramStreamPresenter(ctx, mode);

    await presenter.start();
    presenter.onEvent({
      type: "item.updated",
      item: { id: "a", type: "agent_message", text: "Streaming answer" },
    });
    await vi.advanceTimersByTimeAsync(1_300);

    expect(reply).toHaveBeenCalledWith("⏳ Codex is starting…");
    expect(editMessageText).toHaveBeenLastCalledWith(123, 10, expect.stringContaining("Streaming answer"));
    await vi.advanceTimersByTimeAsync(25_000);
    expect(sendMessageDraft).not.toHaveBeenCalled();

    await presenter.complete("Final answer");
    expect(editMessageText).toHaveBeenLastCalledWith(123, 10, "Final answer");
    expect(reply).toHaveBeenCalledTimes(1);
    expect(sendMessageDraft).not.toHaveBeenCalled();
  });

  it("edits one placeholder in group chats", async () => {
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
