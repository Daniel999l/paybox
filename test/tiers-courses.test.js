const test = require("node:test");
const assert = require("node:assert");
const { privateKeyToAccount } = require("viem/accounts");
const { tierFor, nextTier, TIERS } = require("../lib/tiers");
const { validateCourse, checkSignature, signMessage } = require("../lib/courses");

test("tiers by $HELM held", () => {
  assert.strictEqual(tierFor(0).key, "deckhand");
  assert.strictEqual(tierFor(99_999).key, "deckhand");
  assert.strictEqual(tierFor(100_000).key, "captain");
  assert.strictEqual(tierFor(999_999).key, "captain");
  assert.strictEqual(tierFor(1_000_000).key, "admiral");
  assert.strictEqual(nextTier(5).key, "captain");
  assert.strictEqual(nextTier(2_000_000), null);
});

test("bigger tiers get more: tighter band, lower fee, more custom courses", () => {
  const [admiral, captain, deckhand] = TIERS;
  assert.ok(admiral.driftBand < captain.driftBand && captain.driftBand < deckhand.driftBand);
  assert.ok(admiral.feeBps < captain.feeBps && captain.feeBps < deckhand.feeBps);
  assert.ok(admiral.custom > captain.custom && captain.custom > deckhand.custom);
  assert.ok(!deckhand.courses.includes("bold") && captain.courses.includes("bold"));
});

test("custom course rules", () => {
  assert.deepStrictEqual(validateCourse({ name: "Tech", weights: { NVDA: 40, MSFT: 30, USDG: 30 } }).weights, { NVDA: 0.4, MSFT: 0.3, USDG: 0.3 });
  assert.match(validateCourse({ weights: { NVDA: 50, USDG: 40 } }).error, /add up to 90%/);
  assert.match(validateCourse({ weights: { NVDA: 70, USDG: 30 } }).error, /60% or less/);
  assert.match(validateCourse({ weights: { DOGE: 50, USDG: 50 } }).error, /isn't a Helm asset/);
  assert.match(validateCourse({ weights: { USDG: 100 } }).error, /at least two/);
  assert.match(validateCourse({ weights: { NVDA: 33.5, USDG: 66.5 } }).error, /whole percents/);
  assert.strictEqual(validateCourse({ weights: { SPY: 60, USDG: 40 } }).name, "My course");
});

test("signature proves wallet ownership", async () => {
  const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
  const time = new Date().toISOString();
  const signature = await acct.signMessage({ message: signMessage(acct.address, time) });
  assert.strictEqual(await checkSignature({ address: acct.address, time, signature }), "");
  // someone else's address with this signature is rejected
  assert.match(await checkSignature({ address: "0x000000000000000000000000000000000000dEaD", time, signature }), /doesn't match/);
  // old signatures expire
  const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const oldSig = await acct.signMessage({ message: signMessage(acct.address, old) });
  assert.match(await checkSignature({ address: acct.address, time: old, signature: oldSig }), /expired/);
});
