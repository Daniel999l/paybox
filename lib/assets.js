// The tokens Helm is allowed to trade, and their live prices.
// Stock token addresses come from Robinhood's official assets API (api.robinhood.com/rhj/assets).

// Real USDG ("Global Dollar", ~694M supply). A different token named "Paxos USDG" exists
// on the chain with a tiny supply; never use it.
const USDG = { symbol: "USDG", name: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", decimals: 6, kind: "cash" };

const STOCKS = [
  { symbol: "SPY", name: "S&P 500 ETF", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68" },
  { symbol: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { symbol: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { symbol: "MSFT", name: "Microsoft", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
  { symbol: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { symbol: "PLTR", name: "Palantir", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A" },
  { symbol: "GOOGL", name: "Alphabet", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  { symbol: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
  { symbol: "META", name: "Meta", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
].map((s) => ({ ...s, decimals: 18, kind: "stock" }));

const MANAGED = [USDG].concat(STOCKS);
const BY_SYMBOL = Object.fromEntries(MANAGED.map((a) => [a.symbol, a]));

const COURSES = {
  calm: {
    name: "Calm",
    rebalance: "monthly",
    desc: "Mostly broad market and cash. Smaller swings.",
    weights: { SPY: 0.45, MSFT: 0.15, AAPL: 0.1, USDG: 0.3 },
  },
  steady: {
    name: "Steady",
    rebalance: "every 2 weeks",
    desc: "A balance of the market and a few strong names.",
    weights: { SPY: 0.3, NVDA: 0.2, AAPL: 0.15, MSFT: 0.15, USDG: 0.2 },
  },
  bold: {
    name: "Bold",
    rebalance: "weekly",
    desc: "Heavier on growth stocks. Bigger moves both ways.",
    weights: { NVDA: 0.3, SPY: 0.25, TSLA: 0.2, PLTR: 0.15, USDG: 0.1 },
  },
};

// Prices from LiFi's token list, cached for 60 seconds.
let priceCache = { at: 0, prices: null };
async function getPrices() {
  if (priceCache.prices && Date.now() - priceCache.at < 60_000) return priceCache.prices;
  const res = await fetch("https://li.quest/v1/tokens?chains=4663", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Price source HTTP ${res.status}`);
  const list = ((await res.json()).tokens || {})["4663"] || [];
  const byAddr = new Map(list.map((t) => [t.address.toLowerCase(), Number(t.priceUSD)]));
  const prices = {};
  for (const a of MANAGED) {
    const p = byAddr.get(a.address.toLowerCase());
    if (p && isFinite(p) && p > 0) prices[a.symbol] = p;
  }
  if (!prices.USDG) prices.USDG = 1;
  priceCache = { at: Date.now(), prices };
  return prices;
}

module.exports = { USDG, STOCKS, MANAGED, BY_SYMBOL, COURSES, getPrices };
