import { randomInt } from "node:crypto";
import type { Context } from "grammy";
import type { ThreadEvent } from "@openai/codex-sdk";
import { splitTelegramText } from "./text.js";
import { applyStreamEvent, createStreamState, renderStreamPreview, type StreamMode } from "./streaming.js";

const FLUSH_INTERVAL_MS = 1_200;
const DRAFT_HEARTBEAT_MS = 20_000;

export class TelegramStreamPresenter {
  private readonly state = createStreamState();
  private readonly draftId = randomInt(1, 2_147_483_647);
  private readonly chatId: number;
  private useDraft: boolean;
  private placeholderMessageId: number | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastFlushAt = 0;
  private lastPreview = "";
  private closed = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly ctx: Context,
    private readonly mode: StreamMode,
  ) {
    if (!ctx.chat) throw new Error("Telegram stream requires a chat context");
    this.chatId = ctx.chat.id;
    this.useDraft = mode !== "off" && ctx.chat.type === "private";
  }

  async start(): Promise<void> {
    if (this.mode === "off") {
      await this.ensurePlaceholder("Task received. Working…");
      return;
    }

    if (this.useDraft) {
      try {
        await this.ctx.api.sendMessageDraft(this.chatId, this.draftId, "");
        this.heartbeat = setInterval(() => {
          if (this.useDraft && !this.closed) void this.flush(true);
        }, DRAFT_HEARTBEAT_MS);
        this.heartbeat.unref();
        return;
      } catch {
        this.useDraft = false;
      }
    }
    await this.ensurePlaceholder("⏳ Codex is starting…");
  }

  onEvent(event: ThreadEvent): void {
    if (this.closed || this.mode === "off") return;
    applyStreamEvent(this.state, event);
    this.scheduleFlush();
  }

  async complete(finalText: string): Promise<void> {
    await this.finalize(finalText || "Codex completed the task without a text response.");
  }

  async fail(message: string): Promise<void> {
    await this.finalize(`Codex could not complete the task: ${message}`);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const delay = Math.max(0, FLUSH_INTERVAL_MS - (Date.now() - this.lastFlushAt));
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush(false);
    }, delay);
    this.flushTimer.unref();
  }

  private async flush(force: boolean): Promise<void> {
    const run = this.inFlight.then(() => this.flushNow(force));
    this.inFlight = run.catch(() => undefined);
    await run;
  }

  private async flushNow(force: boolean): Promise<void> {
    if (this.closed || this.mode === "off") return;
    const preview = renderStreamPreview(this.state, this.mode) || "⏳ Codex is working…";
    if (!force && preview === this.lastPreview) return;

    if (this.useDraft) {
      try {
        await this.ctx.api.sendMessageDraft(this.chatId, this.draftId, preview);
        this.lastPreview = preview;
        this.lastFlushAt = Date.now();
        return;
      } catch {
        this.useDraft = false;
      }
    }

    await this.ensurePlaceholder(preview);
    if (this.placeholderMessageId !== null && preview !== this.lastPreview) {
      try {
        await this.ctx.api.editMessageText(this.chatId, this.placeholderMessageId, preview);
      } catch {
        // Keep streaming best-effort; the final response still uses normal messages.
      }
    }
    this.lastPreview = preview;
    this.lastFlushAt = Date.now();
  }

  private async ensurePlaceholder(text: string): Promise<void> {
    if (this.placeholderMessageId !== null) return;
    const message = await this.ctx.reply(text);
    this.placeholderMessageId = message.message_id;
  }

  private async finalize(text: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    await this.inFlight;

    const chunks = splitTelegramText(text);
    const [first, ...rest] = chunks;
    if (!first) return;

    if (this.placeholderMessageId !== null) {
      try {
        await this.ctx.api.editMessageText(this.chatId, this.placeholderMessageId, first);
      } catch {
        await this.ctx.reply(first);
      }
    } else {
      await this.ctx.reply(first);
    }
    for (const chunk of rest) await this.ctx.reply(chunk);
  }
}
