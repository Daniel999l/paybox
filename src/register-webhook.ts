/**
 * Optional manual helper. On Railway this is usually unnecessary —
 * the app auto-registers using RAILWAY_PUBLIC_DOMAIN on boot.
 *
 * Local/ngrok only if you set PUBLIC_URL yourself:
 *   PUBLIC_URL=https://xxxx.ngrok-free.app npm run register-webhook
 */
import { assertWalletLooksValid, config, webhookEndpointUrl } from "./config.js";
import { ensureHeliusWebhook } from "./helius.js";

async function main() {
  assertWalletLooksValid(config.depositWallet);

  const url = webhookEndpointUrl();
  if (!url) {
    throw new Error(
      "No public URL. On Railway, generate a domain for the service. Locally, set PUBLIC_URL=https://your-tunnel.",
    );
  }

  console.log("Manual Helius webhook ensure…");
  console.log("  wallet:", config.depositWallet);
  console.log("  url:   ", url);

  await ensureHeliusWebhook();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
