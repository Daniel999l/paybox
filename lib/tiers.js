// Holder tiers. The more $HELM a wallet holds, the more Helm does for it.
//   driftBand: how far a position may drift (in percentage points) before Helm plans a rebalance.
//              Smaller means Helm reacts sooner, i.e. faster rebalancing.
//   feeBps:    Helm's fee on rebalance volume, in basis points. It funds $HELM buybacks and burns.
//   courses:   built-in courses the tier can use.
//   custom:    how many custom courses (your own rules) the wallet can save.
const TIERS = [
  { key: "admiral", name: "Admiral", min: 1_000_000, driftBand: 0.015, feeBps: 10, courses: ["calm", "steady", "bold"], custom: 3 },
  { key: "captain", name: "Captain", min: 100_000, driftBand: 0.03, feeBps: 20, courses: ["calm", "steady", "bold"], custom: 1 },
  { key: "deckhand", name: "Deckhand", min: 0, driftBand: 0.05, feeBps: 30, courses: ["calm", "steady"], custom: 0 },
];

function tierFor(helm) {
  return TIERS.find((t) => helm >= t.min);
}

function nextTier(helm) {
  const reached = tierFor(helm);
  const i = TIERS.indexOf(reached);
  return i > 0 ? TIERS[i - 1] : null;
}

function publicTiers() {
  return TIERS.slice().reverse().map(({ key, name, min, driftBand, feeBps, courses, custom }) => ({ key, name, min, driftBand, feeBps, courses, custom }));
}

module.exports = { TIERS, tierFor, nextTier, publicTiers };
