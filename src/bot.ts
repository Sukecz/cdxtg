import { Bot, GrammyError, HttpError, type Context } from "grammy";
import type { ModelReasoningEffort } from "@openai/codex-sdk";
import { timingSafeEqual } from "node:crypto";
import { createAllowedUserChecker, createBooleanSettingProvider, createWorkspaceProvider, persistAllowedUser, type AppConfig, type SafeSandboxMode } from "./config.js";
import { fullAccessKeyboard, modelKeyboard, parseWorkspaceCallback, parseWorkspacePageCallback, reasoningKeyboard, workspaceKeyboard } from "./bot-ui.js";
import { listCodexModels, listCodexWorkspaces, mergeWorkspaceLists } from "./codex-state.js";
import { CodexSession } from "./codex-session.js";
import { errorMessage, splitTelegramText } from "./text.js";
import pkg from "../package.json" with { type: "json" };

const HELP = `cdxtg commands:
/start – welcome and access status
/help – show this command reference
/id – show your Telegram user ID and chat ID
/pair CODE – securely authorize the first Telegram user
/new – choose a workspace and start a new Codex session
/status – show the current session
/workspace – list allowed workspaces
/workspace 2 – switch to workspace number 2
/model – choose a model for a new session
/reasoning – choose reasoning effort for a new session
/mode readonly – use read-only mode
/mode write – use write mode (requires local opt-in)
/mode full – use full host access (requires local opt-in and confirmation)
/stop – stop the running task
/version – show the cdxtg version

Send any regular text message to give Codex a task.`;

export function createBot(config: AppConfig, initialPairingCode?: string): Bot {
  const bot = new Bot(config.telegramBotToken);
  let pairingCode = initialPairingCode;
  const sessions = new Map<number, CodexSession>();
  const isAllowedUser = createAllowedUserChecker(config.allowedUserIds, config.envFile);
  const getConfiguredWorkspaces = createWorkspaceProvider(config.workspaces, config.envFile);
  const getWorkspaces = (): readonly string[] => mergeWorkspaceLists(
    getConfiguredWorkspaces(),
    listCodexWorkspaces(),
  );
  const isWriteEnabled = createBooleanSettingProvider("CODEX_ENABLE_WRITE", config.enableWrite, config.envFile);
  const isFullAccessEnabled = createBooleanSettingProvider("CODEX_ENABLE_FULL_ACCESS", config.enableFullAccess, config.envFile);

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
    if (isCommand(ctx.message?.text, "id") || isCommand(ctx.message?.text, "pair")) return next();
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

  bot.command("pair", async (ctx) => {
    if (!pairingCode || !config.envFile) {
      await ctx.reply("Pairing is not available. This bot may already have an authorized user.");
      return;
    }
    if (!ctx.from) {
      await ctx.reply("Pairing requires a Telegram user identity.");
      return;
    }
    if (ctx.chat.type !== "private" || ctx.chat.id !== ctx.from.id) {
      await ctx.reply("Pairing is available only in a private chat with the bot.");
      return;
    }
    const suppliedCode = ctx.match.trim().toUpperCase();
    if (!secureCodeMatch(suppliedCode, pairingCode)) {
      await ctx.reply("Invalid pairing code.");
      return;
    }

    try {
      persistAllowedUser(config.envFile, ctx.from.id);
      pairingCode = undefined;
      await ctx.reply("Pairing complete. Your Telegram account is now authorized.");
    } catch (error) {
      await ctx.reply(`Pairing failed: ${errorMessage(error)}`);
    }
  });

  bot.command("start", async (ctx) => {
    const session = getSession(ctx.chat.id);
    await ctx.reply(`cdxtg ${displayVersion()} is ready.\nWorkspace: ${session.info.workspace}\nMode: ${session.info.mode}\n\n${HELP}`);
  });

  bot.command("help", async (ctx) => ctx.reply(HELP));
  bot.command("version", async (ctx) => ctx.reply(`cdxtg ${displayVersion()}`));

  bot.command("new", async (ctx) => {
    await ctx.reply("Choose a workspace for the new Codex session:", {
      reply_markup: workspaceKeyboard(getWorkspaces()),
    });
  });

  bot.command("status", async (ctx) => {
    const info = getSession(ctx.chat.id).info;
    await ctx.reply([
      `Status: ${info.busy ? "working" : "ready"}`,
      `Workspace: ${info.workspace}`,
      `Mode: ${info.mode}`,
      `Thread: ${info.threadId ?? "new – created with the first task"}`,
      `Model: ${info.model ?? "Codex default"}`,
      `Reasoning: ${info.reasoningEffort ?? "model default"}`,
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
    await ctx.reply(`Reasoning effort: ${session.info.reasoningEffort ?? "model default"}\n\nSelect reasoning effort for a new session:`, {
      reply_markup: reasoningKeyboard(session.info.reasoningEffort),
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
    await ctx.reply(`Active workspace: ${workspace}\nStarted a new Codex session.`);
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
      getSession(ctx.chat.id).reset({ workspace });
      await ctx.answerCallbackQuery({ text: "Workspace selected" });
      await ctx.editMessageText(`Active workspace: ${workspace}\nStarted a new Codex session.`);
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
      getSession(ctx.chat.id).reset({ model: model.slug });
      await ctx.answerCallbackQuery({ text: `Model set to ${model.displayName}` });
      await ctx.editMessageText(`Model: ${model.displayName} (${model.slug})\nStarted a new Codex session.`);
    } catch (error) {
      await ctx.answerCallbackQuery({ text: errorMessage(error), show_alert: true });
    }
  });

  bot.callbackQuery(/^reasoning:(minimal|low|medium|high|xhigh)$/, async (ctx) => {
    if (!ctx.chat) return;
    const effort = ctx.match[1] as ModelReasoningEffort;
    try {
      getSession(ctx.chat.id).reset({ reasoningEffort: effort });
      await ctx.answerCallbackQuery({ text: `Reasoning set to ${effort}` });
      await ctx.editMessageText(`Reasoning effort: ${effort}\nStarted a new Codex session.`);
    } catch (error) {
      await ctx.answerCallbackQuery({ text: errorMessage(error), show_alert: true });
    }
  });

  bot.command("stop", async (ctx) => {
    const stopped = getSession(ctx.chat.id).stop();
    await ctx.reply(stopped ? "Stopping the running task…" : "No task is running in this chat.");
  });

  bot.on("message:text", async (ctx) => {
    const prompt = ctx.message.text.trim();
    if (!prompt || prompt.startsWith("/")) return;
    const session = getSession(ctx.chat.id);
    await ctx.reply("Task received. Working…");

    const typing = setInterval(() => {
      void ctx.replyWithChatAction("typing").catch(() => undefined);
    }, 4_000);
    typing.unref();

    try {
      await ctx.replyWithChatAction("typing");
      const result = await session.run(prompt);
      for (const chunk of splitTelegramText(result.text)) await ctx.reply(chunk);
    } catch (error) {
      const message = errorMessage(error);
      if (/abort/i.test(message)) await ctx.reply("The task was stopped.");
      else await ctx.reply(`Codex could not complete the task: ${message.slice(0, 3500)}`);
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

function isCommand(text: string | undefined, command: string): boolean {
  return new RegExp(`^/${command}(?:@[A-Za-z0-9_]+)?(?:\\s|$)`, "i").test(text ?? "");
}

function secureCodeMatch(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}
