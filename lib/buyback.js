// Buyback-and-burn bot.
//
// Helm's rebalance fees are paid in USDG to the treasury wallet. Every 15 minutes this bot
// checks the treasury, and once it holds at least MIN_USDG it buys $HELM through LiFi with
// the whole balance and has the $HELM delivered straight to the dead address. Buy and burn
// happen in one transaction, so every burn is public on the explorer.
//
// Turn it on by setting BUYBACK_PRIVATE_KEY to a fresh wallet that holds a little ETH for gas.
// That wallet is the treasury: its address is where users' fees go.
const { createPublicClient, createWalletClient, http, defineChain, erc20Abi } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { RPC_URL, CHAIN_ID } = require("./chain");
const { USDG } = require("./assets");
const { DEAD } = require("./burns");

const KEY = (process.env.BUYBACK_PRIVATE_KEY || "").trim();
const MIN_USDG = 10n * 1_000_000n; // don't bother below $10, gas and price impact eat small buys
const MIN_RETURN = 0.9; // skip if the buy would lose more than 10% to price impact
const INTERVAL_MS = 15 * 60 * 1000;
const MIN_GAS_WEI = 20_000_000_000_000n; // 0.00002 ETH

const chain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

let account = null;
if (KEY) {
  try {
    account = privateKeyToAccount(KEY.startsWith("0x") ? KEY : `0x${KEY}`);
  } catch {
    console.error("BUYBACK_PRIVATE_KEY is not a valid private key. Buybacks and fees are off.");
  }
}

const treasury = () => (account ? account.address : "");
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const walletClient = account ? createWalletClient({ account, chain, transport: http(RPC_URL) }) : null;

async function lifiQuote(helmCa, amount) {
  const q = new URLSearchParams({
    fromChain: String(CHAIN_ID),
    toChain: String(CHAIN_ID),
    fromToken: USDG.address,
    toToken: helmCa,
    fromAmount: amount.toString(),
    fromAddress: account.address,
    toAddress: DEAD,
    slippage: "0.03",
    integrator: "helm",
  });
  const headers = process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY.trim() } : {};
  const res = await fetch(`https://li.quest/v1/quote?${q}`, { headers, signal: AbortSignal.timeout(25000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.transactionRequest) throw new Error(`No buyback route: ${d.message || res.status}`);
  if (String(d.action && d.action.toAddress).toLowerCase() !== DEAD.toLowerCase()) throw new Error("Route doesn't deliver to the dead address");
  if (String(d.action && d.action.toToken && d.action.toToken.address).toLowerCase() !== helmCa.toLowerCase()) throw new Error("Route buys the wrong token");
  if (Number(d.transactionRequest.chainId) !== CHAIN_ID) throw new Error("Route is on the wrong chain");
  return d;
}

let running = false;
async function runOnce(helmCa, log = console.log) {
  if (!account || !helmCa || running) return { skipped: "not ready" };
  running = true;
  try {
    const [usdg, eth] = await Promise.all([
      publicClient.readContract({ address: USDG.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
      publicClient.getBalance({ address: account.address }),
    ]);
    if (usdg < MIN_USDG) return { skipped: `treasury holds ${Number(usdg) / 1e6} USDG, waiting for $10` };
    if (eth < MIN_GAS_WEI) {
      log(`Buyback: treasury ${account.address} needs ETH for gas.`);
      return { skipped: "no gas" };
    }

    // Use the whole balance, halving it until price impact is acceptable.
    let amount = usdg;
    let quote = null;
    while (amount >= MIN_USDG) {
      const q = await lifiQuote(helmCa, amount);
      const ratio = Number(q.estimate.toAmountUSD) / Number(q.estimate.fromAmountUSD);
      if (ratio >= MIN_RETURN) {
        quote = q;
        break;
      }
      log(`Buyback: $${Number(amount) / 1e6} would return ${(ratio * 100).toFixed(1)}%, trying a smaller buy.`);
      amount /= 2n;
    }
    if (!quote) return { skipped: "price impact too high" };

    const spender = quote.estimate.approvalAddress;
    const allowance = await publicClient.readContract({ address: USDG.address, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] });
    if (allowance < amount) {
      const approveHash = await walletClient.writeContract({ address: USDG.address, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
      const r = await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 180_000 });
      if (r.status !== "success") throw new Error(`Approve failed: ${approveHash}`);
    }

    const tx = quote.transactionRequest;
    const hash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || 0),
      gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`Buyback swap failed: ${hash}`);
    const helm = Number(BigInt(quote.estimate.toAmount) / 10n ** 12n) / 1e6;
    log(`Buyback: spent ${Number(amount) / 1e6} USDG, burned ~${helm.toLocaleString()} HELM. ${hash}`);
    return { ok: true, hash, usdg: Number(amount) / 1e6, helm };
  } finally {
    running = false;
  }
}

function start(helmCa, onBurn) {
  if (!account || !helmCa) return false;
  const tick = () =>
    runOnce(helmCa)
      .then((r) => r && r.ok && onBurn && onBurn(r))
      .catch((err) => console.error("Buyback error:", err.message));
  setTimeout(tick, 60_000);
  setInterval(tick, INTERVAL_MS).unref();
  return true;
}

module.exports = { start, runOnce, treasury, lifiQuote, MIN_USDG };
