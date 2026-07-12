import { Bot, GrammyError, HttpError, type Context } from "grammy";
import type { AppConfig, SafeSandboxMode } from "./config.js";
import { CodexSession } from "./codex-session.js";
import { errorMessage, splitTelegramText } from "./text.js";
import pkg from "../package.json" with { type: "json" };

const HELP = `Příkazy cdxtg:
/start – úvod a stav přístupu
/help – tento přehled
/id – vaše Telegram user ID a chat ID
/new – nová Codex relace
/status – stav relace
/workspace – povolené pracovní složky
/workspace 2 – přepnutí na workspace č. 2
/mode readonly – režim pouze pro čtení
/mode write – zapisovací režim (vyžaduje lokální povolení)
/stop – zastavení běžící úlohy
/version – verze služby

Obyčejnou zprávu pošlu Codexu jako úkol.`;

export function createBot(config: AppConfig): Bot {
  const bot = new Bot(config.telegramBotToken);
  const sessions = new Map<number, CodexSession>();

  const getSession = (chatId: number): CodexSession => {
    let session = sessions.get(chatId);
    if (!session) {
      session = new CodexSession({
        workspace: config.workspaces[0]!,
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
    return userId !== undefined && config.allowedUserIds.has(userId);
  };

  bot.use(async (ctx, next) => {
    if (ctx.message?.text?.startsWith("/id")) return next();
    if (!authorized(ctx)) {
      const id = ctx.from?.id ?? "neznámé";
      await ctx.reply(`Přístup není povolen. Vaše Telegram user ID je ${id}. Přidejte ho lokálně do TELEGRAM_ALLOWED_USER_IDS.`);
      return;
    }
    await next();
  });

  bot.command("id", async (ctx) => {
    await ctx.reply(`Telegram user ID: ${ctx.from?.id ?? "neznámé"}\nChat ID: ${ctx.chat.id}`);
  });

  bot.command("start", async (ctx) => {
    const session = getSession(ctx.chat.id);
    await ctx.reply(`cdxtg ${displayVersion()} je připraven.\nWorkspace: ${session.info.workspace}\nRežim: ${session.info.mode}\n\n${HELP}`);
  });

  bot.command("help", async (ctx) => ctx.reply(HELP));
  bot.command("version", async (ctx) => ctx.reply(`cdxtg ${displayVersion()}`));

  bot.command("new", async (ctx) => {
    getSession(ctx.chat.id).reset();
    await ctx.reply("Založena nová Codex relace.");
  });

  bot.command("status", async (ctx) => {
    const info = getSession(ctx.chat.id).info;
    await ctx.reply([
      `Stav: ${info.busy ? "pracuji" : "připraven"}`,
      `Workspace: ${info.workspace}`,
      `Režim: ${info.mode}`,
      `Vlákno: ${info.threadId ?? "nové – vznikne s prvním úkolem"}`,
      `Model: ${info.model ?? "výchozí Codex"}`,
    ].join("\n"));
  });

  bot.command("workspace", async (ctx) => {
    const raw = ctx.match.trim();
    const session = getSession(ctx.chat.id);
    if (!raw) {
      const lines = config.workspaces.map((workspace, index) => `${index + 1}. ${workspace}${workspace === session.info.workspace ? " ← aktivní" : ""}`);
      await ctx.reply(`Povolené workspace:\n${lines.join("\n")}\n\nPřepnutí: /workspace 2`);
      return;
    }

    const index = Number(raw) - 1;
    const workspace = Number.isInteger(index) ? config.workspaces[index] : undefined;
    if (!workspace) {
      await ctx.reply("Neplatné číslo workspace. Použijte /workspace pro seznam.");
      return;
    }
    session.reset({ workspace });
    await ctx.reply(`Aktivní workspace: ${workspace}\nByla založena nová Codex relace.`);
  });

  bot.command("mode", async (ctx) => {
    const requested = ctx.match.trim().toLowerCase();
    const mode: SafeSandboxMode | undefined = requested === "readonly" || requested === "read-only"
      ? "read-only"
      : requested === "write" || requested === "workspace-write"
        ? "workspace-write"
        : undefined;

    if (!mode) {
      await ctx.reply("Použití: /mode readonly nebo /mode write");
      return;
    }
    if (mode === "workspace-write" && !config.enableWrite) {
      await ctx.reply("Zapisovací režim je lokálně vypnutý. Správce musí nastavit CODEX_ENABLE_WRITE=true.");
      return;
    }
    getSession(ctx.chat.id).reset({ mode });
    await ctx.reply(`Nový režim: ${mode}. Byla založena nová Codex relace.`);
  });

  bot.command("stop", async (ctx) => {
    const stopped = getSession(ctx.chat.id).stop();
    await ctx.reply(stopped ? "Zastavuji běžící úlohu…" : "V tomto chatu žádná úloha neběží.");
  });

  bot.on("message:text", async (ctx) => {
    const prompt = ctx.message.text.trim();
    if (!prompt || prompt.startsWith("/")) return;
    const session = getSession(ctx.chat.id);
    await ctx.reply("Úkol přijat. Pracuji…");

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
      if (/abort/i.test(message)) await ctx.reply("Úloha byla zastavena.");
      else await ctx.reply(`Codex úlohu nedokončil: ${message.slice(0, 3500)}`);
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
