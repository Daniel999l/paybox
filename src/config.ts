import "dotenv/config";
import { createHash } from "node:crypto";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/** Mainnet USDC (Circle) */
export const DEFAULT_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * Public base URL of this server (no trailing slash).
 * Prefer Railway-injected domain vars — no PUBLIC_URL env needed.
 */
function resolvePublicUrl(): string | undefined {
  const fromEnv = process.env.PUBLIC_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  // Railway sets these once a public domain is generated for the service
  const railwayDomain =
    process.env.RAILWAY_PUBLIC_DOMAIN?.trim() ||
    process.env.RAILWAY_STATIC_URL?.trim() ||
    process.env.RAILWAY_SERVICE_PAYBOX_URL?.trim();

  if (railwayDomain) {
    const host = railwayDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}`;
  }

  return undefined;
}

function resolveWebhookAuthSecret(heliusApiKey: string, depositWallet: string): string {
  const fromEnv = process.env.WEBHOOK_AUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;

  // Stable secret so Helius auth survives restarts without another env var
  return createHash("sha256")
    .update(`paybox-webhook:${heliusApiKey}:${depositWallet}`)
    .digest("hex")
    .slice(0, 32);
}

const heliusApiKey = required("HELIUS_API_KEY");
const depositWallet = required("DEPOSIT_WALLET");

export const config = {
  depositWallet,
  heliusApiKey,
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  port: Number(process.env.PORT ?? "3000"),
  webhookAuthSecret: resolveWebhookAuthSecret(heliusApiKey, depositWallet),
  publicUrl: resolvePublicUrl(),
  heliusNetwork: (process.env.HELIUS_NETWORK?.trim() || "mainnet-beta") as
    | "mainnet-beta"
    | "devnet",
  usdcMint: process.env.USDC_MINT?.trim() || DEFAULT_USDC_MINT,
  // On Railway, mount a volume at /data so subscribers survive deploys
  dataDir:
    process.env.DATA_DIR?.trim() ||
    (process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
      ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH.replace(/\/$/, "")}/paybox`
      : "data"),
  /** When true (default), register/update Helius webhook if we know our public URL */
  autoRegisterWebhook: process.env.AUTO_REGISTER_WEBHOOK?.trim() !== "false",
};

export function webhookEndpointUrl(): string | undefined {
  if (!config.publicUrl) return undefined;
  return `${config.publicUrl}/webhooks/helius`;
}

export function assertWalletLooksValid(wallet: string): void {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    throw new Error(`DEPOSIT_WALLET does not look like a Solana address: ${wallet}`);
  }
}
