import express from "express";
import { assertWalletLooksValid, config, webhookEndpointUrl } from "./config.js";
import { createBot } from "./bot.js";
import { mountWebhook } from "./webhook.js";
import { listSubscribers } from "./store.js";
import { ensureHeliusWebhook } from "./helius.js";

async function main() {
  assertWalletLooksValid(config.depositWallet);

  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const bot = createBot();
  mountWebhook(app, bot);

  await new Promise<void>((resolve) => {
    app.listen(config.port, () => {
      console.log(`HTTP listening on :${config.port}`);
      console.log(`  health  GET  /health`);
      console.log(`  webhook POST /webhooks/helius`);
      resolve();
    });
  });

  const endpoint = webhookEndpointUrl();
  if (endpoint) {
    console.log(`Public webhook URL (auto): ${endpoint}`);
  } else {
    console.log("Public domain: not detected yet");
  }

  // Register Helius → Railway domain automatically (no PUBLIC_URL env)
  try {
    await ensureHeliusWebhook();
  } catch (err) {
    console.error("Helius webhook auto-setup failed (app still runs):", err);
  }

  // Long-polling is simplest; works without Telegram webhook / public URL
  bot.launch().then(() => {
    console.log("Telegram bot started (long polling)");
    console.log(`Watching USDC deposits → ${config.depositWallet}`);
    console.log(`USDC mint: ${config.usdcMint}`);
    console.log(`Subscribers on disk: ${listSubscribers().length}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    bot.stop(signal);
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
