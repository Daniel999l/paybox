const test = require("node:test");
const assert = require("node:assert");
const { buildPlan, fmtUnits } = require("../lib/plan");
const { MANAGED, COURSES } = require("../lib/assets");

const prices = { USDG: 1, SPY: 500, NVDA: 200, AAPL: 250, MSFT: 400, TSLA: 300, PLTR: 100, QQQ: 450, GOOGL: 180, AMZN: 200, META: 600 };
const e18 = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const e6 = (n) => BigInt(Math.round(n * 1e6));

function plan(balances, course = "steady", options) {
  return buildPlan({ assets: MANAGED, balances, prices, weights: COURSES[course].weights, options });
}

test("course weights sum to 1", () => {
  for (const [k, c] of Object.entries(COURSES)) {
    const sum = Object.values(c.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, k);
  }
});

test("all USDG wallet buys every stock in the course and keeps the cash target", () => {
  const p = plan({ USDG: e6(1000) });
  assert.strictEqual(p.onCourse, false);
  assert.deepStrictEqual(p.trades.map((t) => t.to).sort(), ["AAPL", "MSFT", "NVDA", "SPY"]);
  assert.ok(p.trades.every((t) => t.side === "buy" && t.from === "USDG"));
  const spent = p.trades.reduce((s, t) => s + Number(t.amountRaw) / 1e6, 0);
  assert.ok(Math.abs(spent - 800) < 0.01, `spent ${spent}`);
});

test("on-target portfolio needs no trades", () => {
  const p = plan({ USDG: e6(200), SPY: e18(300 / 500), NVDA: e18(200 / 200), AAPL: e18(150 / 250), MSFT: e18(150 / 400) });
  assert.strictEqual(p.onCourse, true);
  assert.strictEqual(p.trades.length, 0);
});

test("overweight position is trimmed, and sells come before buys", () => {
  // NVDA at 40% instead of 20%, SPY at 10% instead of 30%
  const p = plan({ USDG: e6(200), SPY: e18(100 / 500), NVDA: e18(400 / 200), AAPL: e18(150 / 250), MSFT: e18(150 / 400) });
  assert.strictEqual(p.trades[0].side, "sell");
  assert.strictEqual(p.trades[0].from, "NVDA");
  assert.ok(Math.abs(p.trades[0].valueUsd - 200) < 0.5);
  assert.strictEqual(p.trades[1].to, "SPY");
  // buys never exceed cash + sale proceeds minus the fee buffer
  const buys = p.trades.filter((t) => t.side === "buy").reduce((s, t) => s + t.valueUsd, 0);
  assert.ok(buys <= 200 + 200 * 0.99 + 1e-6);
});

test("stock outside the course is sold in full", () => {
  const meta = e18(0.5);
  const p = plan({ USDG: e6(700), META: meta });
  const sell = p.trades.find((t) => t.from === "META");
  assert.ok(sell);
  assert.strictEqual(sell.amountRaw, meta.toString());
  assert.match(sell.reason, /isn't part of this course/);
});

test("tiny wallet is told to add funds", () => {
  const p = plan({ USDG: e6(5) });
  assert.strictEqual(p.trades.length, 0);
  assert.match(p.message, /Add at least/);
});

test("missing price blocks the plan instead of guessing", () => {
  const p = buildPlan({ assets: MANAGED, balances: { USDG: e6(100), NVDA: e18(1) }, prices: { USDG: 1 }, weights: COURSES.bold.weights });
  assert.strictEqual(p.trades.length, 0);
  assert.match(p.message, /No live price for NVDA/);
});

test("fmtUnits", () => {
  assert.strictEqual(fmtUnits(1500000n, 6), "1.5");
  assert.strictEqual(fmtUnits(10n ** 18n, 18), "1");
  assert.strictEqual(fmtUnits(0n, 18), "0");
});

test("fee is charged on traded volume and buys leave room to pay it", () => {
  const p = plan({ USDG: e6(1000) }, "steady", { feeBps: 30 });
  const buys = p.trades.reduce((s, t) => s + Number(t.amountRaw) / 1e6, 0);
  assert.ok(p.fee);
  assert.ok(Math.abs(p.fee.usd - buys * 0.003) < 0.01, `fee ${p.fee.usd}`);
  assert.ok(buys + p.fee.usd <= 1000, "buys plus fee fit in the wallet");
});

test("no trades means no fee", () => {
  const p = plan({ USDG: e6(200), SPY: e18(300 / 500), NVDA: e18(200 / 200), AAPL: e18(150 / 250), MSFT: e18(150 / 400) }, "steady", { feeBps: 30 });
  assert.strictEqual(p.fee, null);
});

test("tighter drift band reacts sooner", () => {
  // SPY 2 points over target: ignored at 3 pts, acted on at 1.5 pts
  const bal = { USDG: e6(200), SPY: e18(320 / 500), NVDA: e18(180 / 200), AAPL: e18(150 / 250), MSFT: e18(150 / 400) };
  assert.strictEqual(plan(bal, "steady", { driftBand: 0.03 }).onCourse, true);
  assert.strictEqual(plan(bal, "steady", { driftBand: 0.015 }).onCourse, false);
});
