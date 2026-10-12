// Public record of every $HELM burn, read straight from the chain:
// all Transfer events of the token to the dead address or the zero address.
const { rpcBatch } = require("./chain");

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const SINKS = [
  "0x000000000000000000000000000000000000000000000000000000000000dead",
  "0x0000000000000000000000000000000000000000000000000000000000000000",
];
const SUPPLY = 1_000_000_000;
const KNOWN_START = { "0x4b8b93f37fd9a3d121fde0723178139e0e36c4c5": 86335371 }; // block $HELM was minted
const MAX_SPAN = 9_900_000; // the public RPC allows 10M blocks per log query

let cache = { at: 0, data: null, ca: "" };

async function getBurns(ca) {
  if (!ca) return { totalBurned: 0, pctOfSupply: 0, count: 0, burns: [], dead: DEAD };
  if (cache.data && cache.ca === ca && Date.now() - cache.at < 60_000) return cache.data;

  const [headHex] = await rpcBatch([{ method: "eth_blockNumber", params: [] }]);
  const head = Number(BigInt(headHex));
  let from = KNOWN_START[ca.toLowerCase()] ?? Math.max(0, head - MAX_SPAN);

  const logs = [];
  while (from <= head) {
    const to = Math.min(head, from + MAX_SPAN);
    const [chunk] = await rpcBatch([
      {
        method: "eth_getLogs",
        params: [{ address: ca, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [TRANSFER, null, SINKS] }],
      },
    ]);
    logs.push(...chunk);
    from = to + 1;
  }

  // Skip the mint (from the zero address).
  const real = logs.filter((l) => !/^0x0{64}$/.test(l.topics[1]));
  const blocks = [...new Set(real.map((l) => l.blockNumber))].slice(-50);
  const times = {};
  if (blocks.length) {
    const res = await rpcBatch(blocks.map((b) => ({ method: "eth_getBlockByNumber", params: [b, false] })));
    blocks.forEach((b, i) => (times[b] = res[i] ? new Date(Number(BigInt(res[i].timestamp)) * 1000).toISOString() : null));
  }

  let total = 0n;
  const burns = real
    .map((l) => {
      const raw = BigInt(l.data);
      total += raw;
      return {
        tx: l.transactionHash,
        block: Number(BigInt(l.blockNumber)),
        time: times[l.blockNumber] || null,
        from: "0x" + l.topics[1].slice(26),
        amount: Number(raw / 10n ** 12n) / 1e6,
      };
    })
    .reverse();

  const totalBurned = Number(total / 10n ** 12n) / 1e6;
  const data = { totalBurned, pctOfSupply: (totalBurned / SUPPLY) * 100, count: burns.length, burns: burns.slice(0, 50), dead: DEAD };
  cache = { at: Date.now(), data, ca };
  return data;
}

module.exports = { getBurns, DEAD };
