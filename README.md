# Helm

AI portfolio agent for tokenized stocks on Robinhood Chain. Live at https://helm.klin.lol.

- `/` landing page and waitlist
- `/app` the Helm app: connect a wallet, pick a course (Calm, Steady, Bold), see drift, plan a rebalance and run it. The user approves every trade in their own wallet. Helm never holds funds.

## How v1 works

1. Reads the wallet's USDG and stock token balances from Robinhood Chain (`lib/chain.js`).
2. Prices come from LiFi's token list, cached 60s (`lib/assets.js`).
3. `lib/plan.js` compares holdings with the course targets. A position more than 3 points off target triggers a plan. Trades under $5 are skipped. Sells run before buys, and buys are capped at the USDG the wallet will have.
4. `/api/quote` gets a LiFi route for one trade. Only USDG to stock (or back) on the allowlist is allowed.
5. The browser approves the exact amount and sends the swap from the user's wallet.

Anyone can use the app. What it does for a wallet depends on its $HELM tier, below.

Stock token addresses come from Robinhood's official assets API. USDG is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` ("Global Dollar"). A token named "Paxos USDG" with a tiny supply also exists on the chain and is not used.

## Railway

Root Directory: leave empty.

Variables:

| Name | What it does |
|---|---|
| `HELM_CA` | $HELM contract address. Tiers, Buy buttons and the burn tracker use it. |
| `MONGO_URI` | MongoDB connection string. Waitlist signups (`waitlist`) and custom courses (`courses`). |
| `BUYBACK_PRIVATE_KEY` | Private key of a fresh wallet used only as the treasury. Turns on rebalance fees (paid to this wallet in USDG) and the bot that spends them buying $HELM and burning it. Keep a little ETH in it for gas. Without it, fees are off. |
| `DEEPSEEK_API_KEY` | Optional. Adds a short AI-written note to each rebalance plan. |
| `RPC_URL` | Optional. A faster Robinhood Chain RPC than the public one. |
| `LIFI_API_KEY` | Optional. Raises LiFi rate limits. |

## $HELM utility

Tiers (`lib/tiers.js`), read from the wallet's $HELM balance:

| Tier | Holds | Courses | Custom courses | Rebalances past | Fee |
|---|---|---|---|---|---|
| Deckhand | any | Calm, Steady | 0 | 5 points of drift | 0.30% |
| Captain | 100,000+ | Calm, Steady, Bold | 1 | 3 points | 0.20% |
| Admiral | 1,000,000+ | Calm, Steady, Bold | 3 | 1.5 points | 0.10% |

Fees are charged on rebalance volume and paid in USDG to the treasury as one extra step in the user's wallet. Every 15 minutes the buyback bot (`lib/buyback.js`) checks the treasury. Once it holds $10+ of USDG, it buys $HELM through LiFi with the whole balance and has it delivered straight to `0x000000000000000000000000000000000000dEaD`, so buy and burn are one transaction. It skips if price impact would cost more than 10%.

Every burn (any Transfer of $HELM to the dead or zero address) is read from the chain and shown at `/api/burns`, on the landing page and in the app.

Custom courses are saved after the wallet signs a message (no gas), which proves the request comes from the owner.

## Develop

```
npm test
npm install
PORT=3000 HELM_CA=0x... MONGO_URI=mongodb://... npm start
```

Dependencies: the MongoDB driver and viem. Node 20+.
