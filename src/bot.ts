import { Bot, GrammyError, HttpError, type Context } from "grammy";
import { createAllowedUserChecker, createBooleanSettingProvider, createWorkspaceProvider, type AppConfig, type SafeSandboxMode } from "./config.js";
import { fullAccessKeyboard, parseWorkspaceCallback, workspaceKeyboard } from "./bot-ui.js";
import { CodexSession } from "./codex-session.js";
import { errorMessage, splitTelegramText } from "./text.js";
import pkg from "../package.json" with { type: "json" };

const HELP = `cdxtg commands:
/start – welcome and access status
/help – show this command reference
/id – show your Telegram user ID and chat ID
/new – choose a workspace and start a new Codex session
/status – show the current session
/workspace – list allowed workspaces
/workspace 2 – switch to workspace number 2
/mode readonly – use read-only mode
/mode write – use write mode (requires local opt-in)
/mode full – use full host access (requires local opt-in and confirmation)
/stop – stop the running task
/version – show the cdxtg version

Send any regular text message to give Codex a task.`;

export function createBot(config: AppConfig): Bot {
  const bot = new Bot(config.telegramBotToken);
  const sessions = new Map<number, CodexSession>();
  const isAllowedUser = createAllowedUserChecker(config.allowedUserIds, config.envFile);
  const getWorkspaces = createWorkspaceProvider(config.workspaces, config.envFile);
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
    ].join("\n"));
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
