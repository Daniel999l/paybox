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

Only wallets holding 100,000 $HELM or more can plan or quote.

Stock token addresses come from Robinhood's official assets API. USDG is `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` ("Global Dollar"). A token named "Paxos USDG" with a tiny supply also exists on the chain and is not used.

## Railway

Root Directory: leave empty.

Variables:

| Name | What it does |
|---|---|
| `HELM_CA` | $HELM contract address. Shows the CA, powers Buy buttons and the holder check. |
| `MONGO_URI` | MongoDB connection string. Waitlist signups go to the `waitlist` collection (database from the URI, or `helm`). |
| `DEEPSEEK_API_KEY` | Optional. Adds a short AI-written note to each rebalance plan. |
| `RPC_URL` | Optional. A faster Robinhood Chain RPC than the public one. |
| `LIFI_API_KEY` | Optional. Raises LiFi rate limits. |

The app requires holding 100,000 $HELM (set in `server.js`).

## Develop

```
npm test
npm install
PORT=3000 HELM_CA=0x... MONGO_URI=mongodb://... npm start
```

One dependency (the MongoDB driver). Node 20+.
