// Robinhood Chain access: raw JSON-RPC, no dependencies.
const CHAIN_ID = 4663;
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

const SEL = {
  balanceOf: "0x70a08231",
};

function pad32(hex) {
  return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

function isAddress(a) {
  return typeof a === "string" && /^0x[a-fA-F0-9]{40}$/.test(a);
}

async function rpcBatch(calls) {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, method: c.method, params: c.params }));
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const out = await res.json();
  if (!Array.isArray(out)) throw new Error(out && out.error ? out.error.message : "RPC returned no batch");
  const byId = new Map(out.map((r) => [r.id, r]));
  return calls.map((_, i) => {
    const r = byId.get(i);
    if (!r || r.error) throw new Error(r && r.error ? r.error.message : `RPC call ${i} missing`);
    return r.result;
  });
}

// Returns { eth: bigint, tokens: { [address]: bigint } } for one owner.
async function getBalances(owner, tokenAddresses) {
  const calls = [{ method: "eth_getBalance", params: [owner, "latest"] }].concat(
    tokenAddresses.map((t) => ({
      method: "eth_call",
      params: [{ to: t, data: SEL.balanceOf + pad32(owner) }, "latest"],
    }))
  );
  const results = await rpcBatch(calls);
  const tokens = {};
  tokenAddresses.forEach((t, i) => {
    const r = results[i + 1];
    tokens[t] = r && r !== "0x" ? BigInt(r) : 0n;
  });
  return { eth: BigInt(results[0]), tokens };
}

module.exports = { CHAIN_ID, RPC_URL, isAddress, getBalances, rpcBatch, pad32 };
