import type { Express, Request, Response } from "express";
import type { Telegraf } from "telegraf";
import { config } from "./config.js";
import { extractUsdcDeposits, formatDepositMessage } from "./helius.js";
import { broadcast } from "./bot.js";
import { markSignatureSeen } from "./store.js";

function authOk(req: Request): boolean {
  const header = req.header("authorization") ?? req.header("Authorization") ?? "";
  // Helius sends whatever we registered as authHeader
  if (header === config.webhookAuthSecret) return true;
  if (header === `Bearer ${config.webhookAuthSecret}`) return true;
  return false;
}

export function mountWebhook(app: Express, bot: Telegraf): void {
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      wallet: config.depositWallet,
      usdcMint: config.usdcMint,
    });
  });

  app.post("/webhooks/helius", async (req: Request, res: Response) => {
    // Ack quickly so Helius doesn't retry on slow Telegram fanout
    if (!authOk(req)) {
      console.warn("Rejected webhook: bad Authorization");
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    res.status(200).json({ ok: true });

    try {
      const deposits = extractUsdcDeposits(req.body);
      if (deposits.length === 0) {
        console.log("Webhook: no matching USDC deposits");
        return;
      }

      for (const d of deposits) {
        const isNew = markSignatureSeen(d.signature);
        if (!isNew) {
          console.log(`Skip duplicate signature ${d.signature}`);
          continue;
        }

        console.log(
          `USDC deposit +${d.amount} from ${d.from} sig=${d.signature}`,
        );
        await broadcast(bot, formatDepositMessage(d));
      }
    } catch (err) {
      console.error("Webhook processing error", err);
    }
  });
}
