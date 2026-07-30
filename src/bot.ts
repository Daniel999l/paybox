import { Telegraf } from "telegraf";
import { config } from "./config.js";
import { addSubscriber, listSubscribers, removeSubscriber } from "./store.js";

export function createBot() {
  const bot = new Telegraf(config.telegramBotToken);

  bot.start(async (ctx) => {
    const chatId = ctx.chat.id;
    const { isNew } = addSubscriber({
      chatId,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      joinedAt: new Date().toISOString(),
    });

    const msg = isNew
      ? [
          "You've subscribed to listening for USDC deposits on the paybox withdrawal wallet:",
          "",
          `\`${config.depositWallet}\``,
          "",
          "You will be notified when USDC is sent to this wallet.",
          "",
          "Commands: /stop to unsubscribe · /status for info",
        ].join("\n")
      : [
          "You're already subscribed to USDC deposit alerts on the paybox withdrawal wallet:",
          "",
          `\`${config.depositWallet}\``,
          "",
          "You will be notified when USDC is sent to this wallet.",
          "",
          "Commands: /stop to unsubscribe · /status for info",
        ].join("\n");

    await ctx.reply(msg, { parse_mode: "Markdown" });

    // Notify admin on every /start (+1 usage signal)
    await notifyAdminStart(bot, {
      chatId,
      isNew,
      username: ctx.from?.username,
      firstName: ctx.from?.first_name,
      userId: ctx.from?.id,
    });
  });

  bot.command("stop", async (ctx) => {
    const removed = removeSubscriber(ctx.chat.id);
    await ctx.reply(
      removed
        ? "Unsubscribed. You won't get deposit alerts. /start to rejoin."
        : "You weren't subscribed. /start to join.",
    );
  });

  bot.command("status", async (ctx) => {
    const subs = listSubscribers();
    const me = subs.some((s) => s.chatId === ctx.chat.id);
    await ctx.reply(
      [
        me ? "Status: subscribed ✅" : "Status: not subscribed ❌",
        `Wallet: ${config.depositWallet}`,
        `USDC mint: ${config.usdcMint}`,
        `Total subscribers: ${subs.length}`,
      ].join("\n"),
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Commands:",
        "/start — subscribe to USDC deposit alerts",
        "/stop — unsubscribe",
        "/status — subscription + wallet info",
        "/help — this message",
      ].join("\n"),
    );
  });

  bot.catch((err, ctx) => {
    console.error("Telegram bot error", ctx.updateType, err);
  });

  return bot;
}

async function notifyAdminStart(
  bot: Telegraf,
  info: {
    chatId: number;
    isNew: boolean;
    username?: string;
    firstName?: string;
    userId?: number;
  },
): Promise<void> {
  const adminId = config.adminChatId;
  if (!Number.isFinite(adminId) || adminId <= 0) return;

  // Don't spam yourself if you press /start on the same account
  if (info.chatId === adminId || info.userId === adminId) return;

  const total = listSubscribers().length;
  const who =
    info.username != null
      ? `@${info.username}`
      : info.firstName || `id:${info.userId ?? info.chatId}`;

  const text = [
    "+1",
    `Start: ${who}`,
    `chat_id: ${info.chatId}`,
    info.isNew ? "new subscriber" : "already subscribed (re-/start)",
    `total subscribers: ${total}`,
  ].join("\n");

  try {
    await bot.telegram.sendMessage(adminId, text);
  } catch (err) {
    console.error(`Failed to notify admin ${adminId} about /start`, err);
  }
}

export async function broadcast(bot: Telegraf, text: string): Promise<void> {
  const subs = listSubscribers();
  if (subs.length === 0) {
    console.log("No Telegram subscribers to notify");
    return;
  }

  console.log(`Broadcasting to ${subs.length} subscriber(s)`);

  for (const sub of subs) {
    try {
      await bot.telegram.sendMessage(sub.chatId, text, {
        parse_mode: "Markdown",
        // @ts-expect-error telegraf types lag Bot API field renames
        disable_web_page_preview: true,
      });
    } catch (err) {
      console.error(`Failed to message chat ${sub.chatId}`, err);
      // Auto-drop blocked / gone chats
      const msg = String(err);
      if (
        msg.includes("bot was blocked") ||
        msg.includes("chat not found") ||
        msg.includes("user is deactivated") ||
        msg.includes("403")
      ) {
        removeSubscriber(sub.chatId);
        console.log(`Removed dead subscriber ${sub.chatId}`);
      }
    }
  }
}
