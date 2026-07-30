import { config, webhookEndpointUrl } from "./config.js";

/** Subset of Helius enhanced webhook transaction payload */
export type HeliusTokenTransfer = {
  mint?: string;
  tokenAmount?: number;
  fromUserAccount?: string | null;
  toUserAccount?: string | null;
  fromTokenAccount?: string | null;
  toTokenAccount?: string | null;
  tokenStandard?: string;
};

export type HeliusEnhancedTx = {
  signature?: string;
  type?: string;
  source?: string;
  timestamp?: number;
  description?: string;
  feePayer?: string;
  tokenTransfers?: HeliusTokenTransfer[];
  nativeTransfers?: unknown[];
};

export type UsdcDeposit = {
  signature: string;
  amount: number;
  from: string;
  to: string;
  timestamp?: number;
  description?: string;
};

type HeliusWebhook = {
  webhookID?: string;
  webhookURL?: string;
  accountAddresses?: string[];
  transactionTypes?: string[];
  webhookType?: string;
  authHeader?: string;
};

function heliusApiBase(): string {
  return config.heliusNetwork === "devnet"
    ? "https://api-devnet.helius-rpc.com"
    : "https://api-mainnet.helius-rpc.com";
}

function apiKeyQs(): string {
  return `api-key=${config.heliusApiKey}`;
}

export function extractUsdcDeposits(payload: unknown): UsdcDeposit[] {
  const txs: HeliusEnhancedTx[] = Array.isArray(payload)
    ? (payload as HeliusEnhancedTx[])
    : payload && typeof payload === "object"
      ? [payload as HeliusEnhancedTx]
      : [];

  const deposits: UsdcDeposit[] = [];
  const wallet = config.depositWallet;

  for (const tx of txs) {
    const signature = tx.signature;
    if (!signature) continue;

    for (const t of tx.tokenTransfers ?? []) {
      if (!t.mint || t.mint !== config.usdcMint) continue;
      if (t.toUserAccount !== wallet) continue;

      const amount = Number(t.tokenAmount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      deposits.push({
        signature,
        amount,
        from: t.fromUserAccount || "unknown",
        to: t.toUserAccount,
        timestamp: tx.timestamp,
        description: tx.description,
      });
    }
  }

  return deposits;
}

export function formatDepositMessage(d: UsdcDeposit): string {
  const when = d.timestamp
    ? new Date(d.timestamp * 1000).toISOString()
    : new Date().toISOString();

  const explorer = `https://solscan.io/tx/${d.signature}`;

  return [
    "💰 *USDC deposit received*",
    "",
    `Amount: *${formatAmount(d.amount)} USDC*`,
    `From: \`${escapeMd(d.from)}\``,
    `To: \`${escapeMd(d.to)}\``,
    `Time: ${escapeMd(when)}`,
    `Tx: [Solscan](${explorer})`,
  ].join("\n");
}

function formatAmount(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}

function webhookBody(webhookUrl: string) {
  return {
    webhookURL: webhookUrl,
    transactionTypes: ["Any"],
    accountAddresses: [config.depositWallet],
    webhookType: "enhanced",
    txnStatus: "success",
    authHeader: config.webhookAuthSecret,
  };
}

async function listWebhooks(): Promise<HeliusWebhook[]> {
  const res = await fetch(`${heliusApiBase()}/v0/webhooks?${apiKeyQs()}`);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Helius list webhooks failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text) as HeliusWebhook[] | { webhooks?: HeliusWebhook[] };
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.webhooks)) return json.webhooks;
  return [];
}

export async function createHeliusWebhook(opts: {
  webhookUrl: string;
  authHeader?: string;
}): Promise<unknown> {
  const body = {
    ...webhookBody(opts.webhookUrl),
    ...(opts.authHeader !== undefined ? { authHeader: opts.authHeader } : {}),
  };

  const res = await fetch(`${heliusApiBase()}/v0/webhooks?${apiKeyQs()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Helius webhook create failed (${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function updateHeliusWebhook(webhookId: string, webhookUrl: string): Promise<unknown> {
  const res = await fetch(`${heliusApiBase()}/v0/webhooks/${webhookId}?${apiKeyQs()}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(webhookBody(webhookUrl)),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Helius webhook update failed (${res.status}): ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Ensure a Helius enhanced webhook points at this service's /webhooks/helius.
 * Uses Railway public domain when available — no PUBLIC_URL env required.
 */
export async function ensureHeliusWebhook(): Promise<void> {
  if (!config.autoRegisterWebhook) {
    console.log("AUTO_REGISTER_WEBHOOK=false — skipping Helius webhook setup");
    return;
  }

  const url = webhookEndpointUrl();
  if (!url) {
    console.log(
      "No public domain detected (Railway domain not ready / not local with PUBLIC_URL). Skipping Helius auto-register.",
    );
    console.log(
      "On Railway: open the service → Settings → Networking → Generate Domain, then redeploy.",
    );
    return;
  }

  console.log(`Ensuring Helius webhook → ${url}`);
  console.log(`  account: ${config.depositWallet}`);

  const existing = await listWebhooks();
  const match =
    existing.find((w) => w.webhookURL === url) ||
    existing.find(
      (w) =>
        Array.isArray(w.accountAddresses) &&
        w.accountAddresses.includes(config.depositWallet) &&
        (w.webhookURL?.includes("/webhooks/helius") ?? false),
    ) ||
    existing.find(
      (w) =>
        Array.isArray(w.accountAddresses) &&
        w.accountAddresses.includes(config.depositWallet),
    );

  if (match?.webhookID) {
    if (
      match.webhookURL === url &&
      match.accountAddresses?.includes(config.depositWallet)
    ) {
      console.log(`Helius webhook already configured (${match.webhookID})`);
      return;
    }
    await updateHeliusWebhook(match.webhookID, url);
    console.log(`Updated Helius webhook ${match.webhookID}`);
    return;
  }

  const created = (await createHeliusWebhook({ webhookUrl: url })) as HeliusWebhook;
  console.log(
    `Created Helius webhook${created.webhookID ? ` ${created.webhookID}` : ""}`,
  );
}
