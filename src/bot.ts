import { Bot, GrammyError, HttpError, type Context } from "grammy";
import type { ModelReasoningEffort } from "@openai/codex-sdk";
import { createAllowedUserChecker, createBooleanSettingProvider, createWorkspaceProvider, type AppConfig, type SafeSandboxMode } from "./config.js";
import { fullAccessKeyboard, modelKeyboard, parseResumeCallback, parseResumePageCallback, parseWorkspaceCallback, parseWorkspacePageCallback, reasoningKeyboard, resumeKeyboard, streamModeKeyboard, workspaceKeyboard } from "./bot-ui.js";
import { listCodexModels, listCodexThreads, listCodexWorkspaces, mergeWorkspaceLists, type CodexThreadSummary } from "./codex-state.js";
import { CodexSession } from "./codex-session.js";
import { formatModelSummary, formatNewSessionSummary, formatRateLimits, readCodexRuntimeStatus } from "./codex-status.js";
import { TelegramStreamPresenter } from "./telegram-stream.js";
import { errorMessage } from "./text.js";
import type { StreamMode } from "./streaming.js";
import pkg from "../package.json" with { type: "json" };

const HELP = `cdxtg commands:
/start – welcome and access status
/help – show this command reference
/id – show your Telegram user ID and chat ID
/new – choose a workspace and start a new Codex session
/resume – continue a recent local Codex session
/status – show the current session
/workspace – list allowed workspaces
/workspace 2 – switch to workspace number 2
/model – choose a model, then reasoning effort, for a new session
/reasoning – change only the reasoning effort for a new session
/stream – choose off, brief, or verbose streaming
/mode readonly – use read-only mode
/mode write – use write mode (requires local opt-in)
/mode full – use full host access (requires local opt-in and confirmation)
/stop – stop the running task
/version – show the cdxtg version

Send any regular text message to give Codex a task.`;

export function createBot(config: AppConfig): Bot {
  const bot = new Bot(config.telegramBotToken);
  const sessions = new Map<number, CodexSession>();
  const streamModes = new Map<number, StreamMode>();
  const pendingModels = new Map<number, { slug: string; displayName: string }>();
  const resumeLists = new Map<number, readonly CodexThreadSummary[]>();
  const isAllowedUser = createAllowedUserChecker(config.allowedUserIds, config.envFile);
  const getConfiguredWorkspaces = createWorkspaceProvider(config.workspaces, config.envFile);
  const getWorkspaces = (): readonly string[] => mergeWorkspaceLists(
    getConfiguredWorkspaces(),
    listCodexWorkspaces(),
  );
  const isWriteEnabled = createBooleanSettingProvider("CODEX_ENABLE_WRITE", config.enableWrite, config.envFile);
  const isFullAccessEnabled = createBooleanSettingProvider("CODEX_ENABLE_FULL_ACCESS", config.enableFullAccess, config.envFile);
  const getStreamMode = (chatId: number): StreamMode => streamModes.get(chatId) ?? config.streamMode;

  const getSession = (chatId: number): CodexSession => {
    let session = sessions.get(chatId);
    if (!session) {
      session = new CodexSession({
        workspace: getWorkspaces()[0]!,
        mode: config.defaultMode,
        approvalPolicy: config.approvalPolicy,
        ...(config.model ? { model: config.model } : {}),
        ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
      });
      sessions.set(chatId, session);
    }
    return session;
  };

  const authorized = (ctx: Context): boolean => {
    const userId = ctx.from?.id;
    return userId !== undefined && isAllowedUser(userId);
  };

  bot.use(async (ctx, next) => {
    if (ctx.message?.text?.startsWith("/id")) return next();
    if (!authorized(ctx)) {
      const id = ctx.from?.id ?? "unknown";
      await ctx.reply(`Access denied. Your Telegram user ID is ${id}. Add it locally to TELEGRAM_ALLOWED_USER_IDS.`);
      return;
    }
    await next();
  });

  bot.command("id", async (ctx) => {
    await ctx.reply(`Telegram user ID: ${ctx.from?.id ?? "unknown"}\nChat ID: ${ctx.chat.id}`);
  });

  bot.command("start", async (ctx) => {
    const session = getSession(ctx.chat.id);
    await ctx.reply(`cdxtg ${displayVersion()} is ready.\nWorkspace: ${session.info.workspace}\nMode: ${session.info.mode}\n\n${HELP}`);
  });

  bot.command("help", async (ctx) => ctx.reply(HELP));
  bot.command("version", async (ctx) => ctx.reply(`cdxtg ${displayVersion()}`));

  bot.command("new", async (ctx) => {
    const info = getSession(ctx.chat.id).info;
    const runtime = await readCodexRuntimeStatus({
      workspace: info.workspace,
      ...(info.model ? { model: info.model } : {}),
      ...(info.reasoningEffort ? { reasoningEffort: info.reasoningEffort } : {}),
    });
    await ctx.reply(`Model: ${formatModelSummary(runtime)}\n\nChoose a workspace for the new Codex session:`, {
      reply_markup: workspaceKeyboard(getWorkspaces()),
    });
  });

  bot.command("resume", async (ctx) => {
    if (getSession(ctx.chat.id).busy) {
      await ctx.reply("Cannot resume another session while a task is running.");
      return;
    }
    const threads = listCodexThreads();
    if (threads.length === 0) {
      await ctx.reply("No resumable Codex sessions were found in local history.");
      return;
    }
    resumeLists.set(ctx.chat.id, threads);
    await ctx.reply("Choose a recent Codex session from any available workspace:", {
      reply_markup: resumeKeyboard(threads),
    });
  });

  bot.command("status", async (ctx) => {
    const info = getSession(ctx.chat.id).info;
    const runtime = await readCodexRuntimeStatus({
      workspace: info.workspace,
      ...(info.model ? { model: info.model } : {}),
      ...(info.reasoningEffort ? { reasoningEffort: info.reasoningEffort } : {}),
      includeRateLimits: true,
    });
    await ctx.reply([
      `Status: ${info.busy ? "working" : "ready"}`,
      `Model: ${formatModelSummary(runtime)}`,
      `Workspace: ${info.workspace}`,
      `Mode: ${info.mode}`,
      `Thread: ${info.threadId ?? "new – created with the first task"}`,
      `Streaming: ${getStreamMode(ctx.chat.id)}`,
      ...(runtime.rateLimits
        ? formatRateLimits(runtime.rateLimits)
        : ["Limits: unavailable"]),
    ].join("\n"));
  });

  bot.command("model", async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (session.busy) {
      await ctx.reply("Cannot change the model while a task is running.");
      return;
    }
    const models = listCodexModels();
    if (models.length === 0) {
      await ctx.reply("No models were found in the local Codex model cache.");
      return;
    }
    pendingModels.delete(ctx.chat.id);
    await ctx.reply(`Current model: ${session.info.model ?? "Codex default"}\n\nSelect a model for a new session:`, {
      reply_markup: modelKeyboard(models, session.info.model),
    });
  });

  bot.command(["reasoning", "effort"], async (ctx) => {
    const session = getSession(ctx.chat.id);
    if (session.busy) {
      await ctx.reply("Cannot change reasoning effort while a task is running.");
      return;
    }
    pendingModels.delete(ctx.chat.id);
    await ctx.reply(`Reasoning effort: ${session.info.reasoningEffort ?? "model default"}\n\nSelect reasoning effort for a new session:`, {
      reply_markup: reasoningKeyboard(session.info.reasoningEffort),
    });
  });

  bot.command("stream", async (ctx) => {
    const requested = ctx.match.trim().toLowerCase();
    if (requested === "off" || requested === "brief" || requested === "verbose") {
      streamModes.set(ctx.chat.id, requested);
      await ctx.reply(`Streaming mode: ${requested}`);
      return;
    }
    const current = getStreamMode(ctx.chat.id);
    await ctx.reply(`Streaming mode: ${current}\n\nSelect how Codex progress is shown:`, {
      reply_markup: streamModeKeyboard(current),
    });
  });

  bot.command("workspace", async (ctx) => {
    const raw = ctx.match.trim();
    const session = getSession(ctx.chat.id);
    const workspaces = getWorkspaces();
    if (!raw) {
      await ctx.reply("Choose a workspace:", {
        reply_markup: workspaceKeyboard(workspaces),
      });
      return;
    }

    const index = Number(raw) - 1;
    const workspace = Number.isInteger(index) ? workspaces[index] : undefined;
    if (!workspace) {
      await ctx.reply("Invalid workspace number. Use /workspace to see the list.");
      return;
    }
    session.reset({ workspace });
    const info = session.info;
    const runtime = await readCodexRuntimeStatus({
      workspace: info.workspace,
      ...(info.model ? { model: info.model } : {}),
      ...(info.reasoningEffort ? { reasoningEffort: info.reasoningEffort } : {}),
    });
    await ctx.reply(formatNewSessionSummary(workspace, runtime));
  });

  bot.on("callback_query:data", async (ctx, next) => {
    if (ctx.callbackQuery.data === "workspace-page:noop") {
      await ctx.answerCallbackQuery();
      return;
    }
    const page = parseWorkspacePageCallback(ctx.callbackQuery.data);
    if (page !== null) {
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup({ reply_markup: workspaceKeyboard(getWorkspaces(), page) });
      return;
    }
    const index = parseWorkspaceCallback(ctx.callbackQuery.data);
    if (index === null) return next();
    if (!ctx.chat) {
      await ctx.answerCallbackQuery({ text: "This picker is not attached to a chat.", show_alert: true });
      return;
    }
    const workspace = getWorkspaces()[index];
    if (!workspace) {
      await ctx.answerCallbackQuery({ text: "This workspace is no longer available.", show_alert: true });
      return;
    }

    try {
      const session = getSession(ctx.chat.id);
      session.reset({ workspace });
      const info = session.info;
      const runtime = await readCodexRuntimeStatus({
        workspace: info.workspace,
        ...(info.model ? { model: info.model } : {}),
        ...(info.reasoningEffort ? { reasoningEffort: info.reasoningEffort } : {}),
      });
      await ctx.answerCallbackQuery({ text: "Workspace selected" });
      await ctx.editMessageText(formatNewSessionSummary(workspace, runtime));
    } catch (error) {
      await ctx.answerCallbackQuery({ text: errorMessage(error), show_alert: true });
    }
  });

  bot.command("mode", async (ctx) => {
    const requested = ctx.match.trim().toLowerCase();
    const mode: SafeSandboxMode | undefined = requested === "readonly" || requested === "read-only"
      ? "read-only"
      : requested === "write" || requested === "workspace-write"
        ? "workspace-write"
        : requested === "full" || requested === "danger-full-access"
          ? "danger-full-access"
        : undefined;

    if (!mode) {
      await ctx.reply("Usage: /mode readonly, /mode write, or /mode full");
      return;
    }
    if (mode === "workspace-write" && !isWriteEnabled()) {
      await ctx.reply("Write mode is disabled locally. The administrator must set CODEX_ENABLE_WRITE=true.");
      return;
    }
    if (mode === "danger-full-access") {
      if (!isFullAccessEnabled()) {
        await ctx.reply("Full Access is disabled locally. The administrator must set CODEX_ENABLE_FULL_ACCESS=true.");
        return;
      }
      await ctx.reply(
        "Full Access disables the Codex filesystem sandbox and can modify files anywhere the service user can access. Continue?",
        { reply_markup: fullAccessKeyboard() },
      );
      return;
    }
    getSession(ctx.chat.id).reset({ mode });
    await ctx.reply(`New mode: ${mode}. Started a new Codex session.`);
  });

  bot.callbackQuery("resume-page:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^resume-page:(\d+)$/, async (ctx) => {
    if (!ctx.chat) return;
    const threads = resumeLists.get(ctx.chat.id);
    const page = parseResumePageCallback(ctx.callbackQuery.data);
    if (!threads || page === null) {
      await ctx.answerCallbackQuery({ text: "This session list expired. Use /resume again.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: resumeKeyboard(threads, page) });
  });

  bot.callbackQuery(/^resume:(\d+)$/, async (ctx) => {
    if (!ctx.chat) return;
    const threads = resumeLists.get(ctx.chat.id);
    const index = parseResumeCallback(ctx.callbackQuery.data);
    const selected = index === null ? undefined : threads?.[index];
    if (!selected) {
      await ctx.answerCallbackQuery({ text: "This session list expired. Use /resume again.", show_alert: true });
      return;
    }
    const current = listCodexThreads().find((thread) => thread.id === selected.id && thread.workspace === selected.workspace);
    if (!current) {
      await ctx.answerCallbackQuery({ text: "This Codex session is no longer available.", show_alert: true });
      return;
    }
    try {
      getSession(ctx.chat.id).resume(current.id, current.workspace);
      resumeLists.delete(ctx.chat.id);
      await ctx.answerCallbackQuery({ text: "Session resumed" });
      await ctx.editMessageText([
        "Resumed Codex session.",
        `Title: ${current.title}`,
        `Workspace: ${current.workspace}`,
        "Send a message to continue.",
      ].join("\n"));
    } catch (error) {
      await ctx.answerCallbackQuery({ text: errorMessage(error), show_alert: true });
    }
  });

  bot.callbackQuery("mode:full:confirm", async (ctx) => {
    if (!isFullAccessEnabled()) {
      await ctx.answerCallbackQuery({ text: "Full Access is disabled locally.", show_alert: true });
      return;
    }
    if (!ctx.chat) {
      await ctx.answerCallbackQuery({ text: "This confirmation is not attached to a chat.", show_alert: true });
      return;
    }
    try {
      getSession(ctx.chat.id).reset({ mode: "danger-full-access" });
      await ctx.answerCallbackQuery({ text: "Full Access enabled" });
      await ctx.editMessageText("Mode: danger-full-access\nStarted a new Codex session.");
    } catch (error) {
      await ctx.answerCallbackQuery({ text: errorMessage(error), show_alert: true });
    }
  });

  bot.callbackQuery("mode:full:cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    await ctx.editMessageText("Full Access was not enabled.");
  });

  bot.callbackQuery(/^model-page:(\d+)$/, async (ctx) => {
    if (!ctx.chat) return;
    const page = Number(ctx.match[1]);
    const session = getSession(ctx.chat.id);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({
      reply_markup: modelKeyboard(listCodexModels(), session.info.model, page),
    });
  });

  bot.callbackQuery("model-page:noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^model:(\d+)$/, async (ctx) => {
    if (!ctx.chat) return;
    const model = listCodexModels()[Number(ctx.match[1])];
    if (!model) {
      await ctx.answerCallbackQuery({ text: "This model is no longer available.", show_alert: true });
      return;
    }
    try {
      pendingModels.set(ctx.chat.id, model);
      await ctx.answerCallbackQuery({ text: `Model selected: ${model.displayName}` });
      await ctx.editMessageText(
        `Model: ${model.displayName} (${model.slug})\n\nNow select reasoning effort:`,
        { reply_markup: reasoningKeyboard(getSession(ctx.chat.id).info.reasoningEffort) },
      );
    } catch (error) {
      await ctx.answerCallbackQuery({ text: errorMessage(error), show_alert: true });
    }
  });

  bot.callbackQuery(/^reasoning:(minimal|low|medium|high|xhigh)$/, async (ctx) => {
    if (!ctx.chat) return;
    const effort = ctx.match[1] as ModelReasoningEffort;
    try {
      const pendingModel = pendingModels.get(ctx.chat.id);
      getSession(ctx.chat.id).reset({
        ...(pendingModel ? { model: pendingModel.slug } : {}),
        reasoningEffort: effort,
      });
      pendingModels.delete(ctx.chat.id);
      await ctx.answerCallbackQuery({ text: `Reasoning set to ${effort}` });
      await ctx.editMessageText([
        ...(pendingModel ? [`Model: ${pendingModel.displayName} (${pendingModel.slug})`] : []),
        `Reasoning effort: ${effort}`,
        "Started a new Codex session.",
      ].join("\n"));
    } catch (error) {
      await ctx.answerCallbackQuery({ text: errorMessage(error), show_alert: true });
    }
  });

  bot.callbackQuery(/^stream:(off|brief|verbose)$/, async (ctx) => {
    if (!ctx.chat) return;
    const mode = ctx.match[1] as StreamMode;
    streamModes.set(ctx.chat.id, mode);
    await ctx.answerCallbackQuery({ text: `Streaming set to ${mode}` });
    await ctx.editMessageText(`Streaming mode: ${mode}`);
  });

  bot.command("stop", async (ctx) => {
    const stopped = getSession(ctx.chat.id).stop();
    await ctx.reply(stopped ? "Stopping the running task…" : "No task is running in this chat.");
  });

  bot.on("message:text", async (ctx) => {
    const prompt = ctx.message.text.trim();
    if (!prompt || prompt.startsWith("/")) return;
    const session = getSession(ctx.chat.id);
    const presenter = new TelegramStreamPresenter(ctx, getStreamMode(ctx.chat.id));

    const typing = setInterval(() => {
      void ctx.replyWithChatAction("typing").catch(() => undefined);
    }, 4_000);
    typing.unref();

    try {
      await presenter.start();
      await ctx.replyWithChatAction("typing");
      const result = await session.run(prompt, (event) => presenter.onEvent(event));
      await presenter.complete(result.text);
    } catch (error) {
      const message = errorMessage(error);
      if (/abort/i.test(message)) await presenter.fail("The task was stopped.");
      else await presenter.fail(message.slice(0, 3500));
    } finally {
      clearInterval(typing);
    }
  });

  bot.catch(({ error, ctx }) => {
    if (error instanceof GrammyError) console.error("Telegram API error", error.description);
    else if (error instanceof HttpError) console.error("Telegram network error", error.message);
    else console.error(`Bot error for update ${ctx.update.update_id}`, error);
  });

  return bot;
}

function displayVersion(): string {
  return pkg.version.replace(/\.0$/, "");
}
