// Rebalancing engine. Pure functions, no network.
//
// Given what a wallet holds, live prices and a course (target weights), work out the
// trades that bring the portfolio back to target. Sells always run before buys, and all
// trades go through USDG, so buys are paid for by the sells before them.

const DEFAULTS = {
  minTradeUsd: 5, // skip trades smaller than this, they cost more in fees than they fix
  driftBand: 0.03, // a position may sit 3 percentage points off target before we act
  minPortfolioUsd: 20,
  feeBuffer: 0.01, // keep 1% of sale proceeds back for swap costs
  feeBps: 0, // Helm's fee on traded volume, paid in USDG, funds $HELM buybacks
};

function toUnits(raw, decimals) {
  // bigint raw -> float units, precise enough for display and weights
  const s = raw.toString().padStart(decimals + 1, "0");
  return Number(s.slice(0, -decimals) + "." + s.slice(-decimals));
}

function fmtUnits(raw, decimals, maxFrac = 6) {
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).slice(0, maxFrac).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function pct(x) {
  return `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

function usd(x) {
  return `$${x.toFixed(2)}`;
}

/**
 * @param {object} args
 * @param {Array<{symbol,decimals,kind}>} args.assets managed assets (USDG first)
 * @param {Record<string, bigint>} args.balances raw balances by symbol
 * @param {Record<string, number>} args.prices USD prices by symbol
 * @param {Record<string, number>} args.weights target weights by symbol, sums to 1
 */
function buildPlan({ assets, balances, prices, weights, options = {} }) {
  const opt = { ...DEFAULTS, ...options };
  const holdings = [];
  let total = 0;

  for (const a of assets) {
    const raw = balances[a.symbol] || 0n;
    const price = prices[a.symbol];
    const units = toUnits(raw, a.decimals);
    const value = price ? units * price : 0;
    total += value;
    holdings.push({
      symbol: a.symbol,
      kind: a.kind,
      decimals: a.decimals,
      raw,
      amount: fmtUnits(raw, a.decimals),
      price: price || null,
      value,
      target: weights[a.symbol] || 0,
    });
  }

  for (const h of holdings) h.weight = total > 0 ? h.value / total : 0;

  const result = {
    totalUsd: total,
    holdings: holdings
      .filter((h) => h.raw > 0n || h.target > 0)
      .map((h) => ({
        symbol: h.symbol,
        amount: h.amount,
        price: h.price,
        valueUsd: h.value,
        weight: h.weight,
        target: h.target,
        drift: h.weight - h.target,
      })),
    maxDrift: 0,
    fee: null,
    onCourse: true,
    trades: [],
    message: "",
  };

  result.maxDrift = holdings.reduce((m, h) => Math.max(m, Math.abs(h.weight - h.target)), 0);

  if (total < opt.minPortfolioUsd) {
    result.onCourse = false;
    result.message = `Your wallet has ${usd(total)} in Helm assets. Add at least ${usd(opt.minPortfolioUsd)} of USDG to start.`;
    return result;
  }

  const missingPrice = holdings.find((h) => h.raw > 0n && !h.price);
  if (missingPrice) {
    result.message = `No live price for ${missingPrice.symbol} right now. Try again in a minute.`;
    result.onCourse = false;
    return result;
  }

  const needsAction = holdings.some(
    (h) => Math.abs(h.weight - h.target) > opt.driftBand || (h.target === 0 && h.kind === "stock" && h.value >= opt.minTradeUsd)
  );
  if (!needsAction) {
    result.message = `On course. Every position is within ${pct(opt.driftBand)} of its target.`;
    return result;
  }
  result.onCourse = false;

  const sells = [];
  const buys = [];
  for (const h of holdings) {
    if (h.kind === "cash") continue;
    const targetValue = h.target * total;
    const diff = targetValue - h.value;
    if (Math.abs(diff) < opt.minTradeUsd) continue;

    if (diff < 0) {
      const sellValue = -diff;
      const sellAll = h.target === 0 || sellValue >= h.value * 0.995;
      const rawAmount = sellAll ? h.raw : (h.raw * BigInt(Math.floor((sellValue / h.value) * 1e6))) / 1_000_000n;
      if (rawAmount <= 0n) continue;
      const reason =
        h.target === 0
          ? `${h.symbol} isn't part of this course. Selling it to USDG.`
          : `${h.symbol} is ${pct(h.weight)} of your portfolio, target is ${pct(h.target)}. Trimming ${usd(sellValue)}.`;
      sells.push({
        side: "sell",
        from: h.symbol,
        to: "USDG",
        amountRaw: rawAmount.toString(),
        amount: fmtUnits(rawAmount, h.decimals),
        valueUsd: sellAll ? h.value : sellValue,
        reason,
      });
    } else {
      buys.push({
        side: "buy",
        from: "USDG",
        to: h.symbol,
        valueUsd: diff,
        reason:
          h.value === 0
            ? `Opening a ${pct(h.target)} position in ${h.symbol}.`
            : `${h.symbol} is ${pct(h.weight)} of your portfolio, target is ${pct(h.target)}. Adding ${usd(diff)}.`,
      });
    }
  }

  // Buys can't spend more USDG than the wallet will have after the sells.
  const cash = holdings.find((h) => h.kind === "cash");
  const sellProceeds = sells.reduce((s, t) => s + t.valueUsd, 0);
  const available = cash.value + sellProceeds * (1 - opt.feeBuffer);
  const wanted = buys.reduce((s, t) => s + t.valueUsd, 0);
  // Leave room for Helm's fee, worst case charged on every sell and buy at full size.
  const feeReserve = ((sellProceeds + wanted) * opt.feeBps) / 10_000;
  const budget = Math.max(0, available - feeReserve);
  const scale = wanted > budget ? budget / wanted : 1;

  for (const b of buys) {
    b.valueUsd *= scale;
    if (b.valueUsd < opt.minTradeUsd) continue;
    const raw = BigInt(Math.floor(b.valueUsd * 1e6)); // USDG has 6 decimals
    b.amountRaw = raw.toString();
    b.amount = fmtUnits(raw, 6, 2);
    result.trades.push(b);
  }
  result.trades = sells.concat(result.trades);

  const volume = result.trades.reduce((s, t) => s + t.valueUsd, 0);
  const feeRaw = BigInt(Math.floor(((volume * opt.feeBps) / 10_000) * 1e6)); // USDG, 6 decimals
  result.fee = feeRaw > 0n ? { bps: opt.feeBps, usd: Number(feeRaw) / 1e6, amountRaw: feeRaw.toString(), volumeUsd: volume } : null;

  result.message = result.trades.length
    ? `${result.trades.length} trade${result.trades.length > 1 ? "s" : ""} to get back on course.`
    : "Slightly off course, but every fix is under the minimum trade size. Nothing to do yet.";
  return result;
}

module.exports = { buildPlan, toUnits, fmtUnits, DEFAULTS };
