// Helm server: landing page, the Helm app, and its API.
//
// Env vars:
//   HELM_CA              $HELM contract address. Tiers, Buy buttons and the burn tracker use it.
//   MONGO_URI            MongoDB connection string (waitlist, custom courses).
//   BUYBACK_PRIVATE_KEY  key of a fresh treasury wallet. Turns on rebalance fees (paid to it)
//                        and the bot that spends them buying and burning $HELM.
//   DEEPSEEK_API_KEY     optional, adds an AI-written note to each rebalance plan.
//   RPC_URL              optional, Robinhood Chain RPC (defaults to the public one).
//   LIFI_API_KEY         optional, raises LiFi rate limits.
//   PORT                 set by Railway.
const http = require("http");
const fs = require("fs");
const path = require("path");
const chain = require("./lib/chain");
const assets = require("./lib/assets");
const { buildPlan } = require("./lib/plan");
const store = require("./lib/store");
const ai = require("./lib/ai");
const tiers = require("./lib/tiers");
const courses = require("./lib/courses");
const burns = require("./lib/burns");
const buyback = require("./lib/buyback");

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const env = (k) => (process.env[k] || "").trim();
const HELM_CA = ADDR_RE.test(env("HELM_CA")) ? env("HELM_CA") : "";
const LIFI_API_KEY = env("LIFI_API_KEY");
const TREASURY = buyback.treasury(); // fees go here; empty means fees are off

const PUBLIC = path.join(__dirname, "public");
const landing = fs
  .readFileSync(path.join(PUBLIC, "index.html"), "utf8")
  .replace("__HELM_CA__", HELM_CA)
  .replace("__WAITLIST_URL__", "");
const appPage = fs.readFileSync(path.join(PUBLIC, "app.html"), "utf8");

const STATIC = { ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Simple per-IP rate limit for API routes.
const hits = new Map();
function rateLimited(req, max = 60) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const now = Date.now();
  const h = hits.get(ip) || { n: 0, reset: now + 60_000 };
  if (now > h.reset) {
    h.n = 0;
    h.reset = now + 60_000;
  }
  h.n++;
  hits.set(ip, h);
  return h.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 60_000).unref();

// Wallet snapshot: balances of every managed asset plus $HELM, ETH for gas, live prices and tier.
async function snapshot(address) {
  const tokenAddrs = assets.MANAGED.map((a) => a.address).concat(HELM_CA ? [HELM_CA] : []);
  const [bal, prices] = await Promise.all([chain.getBalances(address, tokenAddrs), assets.getPrices()]);
  const balances = {};
  for (const a of assets.MANAGED) balances[a.symbol] = bal.tokens[a.address];
  const helmRaw = HELM_CA ? bal.tokens[HELM_CA] : 0n;
  const helm = Number(helmRaw / 10n ** 12n) / 1e6;
  return { balances, prices, ethRaw: bal.eth, helm, tier: tiers.tierFor(helm), next: tiers.nextTier(helm) };
}

// Resolve a course key for a wallet's tier. Returns { course } or { error, status }.
async function resolveCourse(address, key, tier) {
  if (assets.COURSES[key]) {
    if (!tier.courses.includes(key)) {
      const unlock = tiers.TIERS.slice().reverse().find((t) => t.courses.includes(key));
      return { status: 403, error: `${assets.COURSES[key].name} unlocks at ${unlock.min.toLocaleString()} $HELM.` };
    }
    return { course: { key, ...assets.COURSES[key] } };
  }
  const m = /^custom-(\d)$/.exec(key || "");
  if (m) {
    const slot = Number(m[1]);
    if (slot >= tier.custom) return { status: 403, error: "Custom courses unlock at 100,000 $HELM." };
    const c = await courses.getCourse(address, slot);
    if (!c) return { status: 404, error: "That custom course doesn't exist anymore." };
    return { course: { key, name: c.name, weights: c.weights, desc: "Your own course.", rebalance: "when it drifts" } };
  }
  return { status: 400, error: "Unknown course." };
}

function tierInfo(snap) {
  return {
    helm: snap.helm,
    tier: { key: snap.tier.key, name: snap.tier.name, driftBand: snap.tier.driftBand, feeBps: TREASURY ? snap.tier.feeBps : 0, courses: snap.tier.courses, custom: snap.tier.custom },
    next: snap.next ? { name: snap.next.name, min: snap.next.min } : null,
  };
}

async function api(req, res, url) {
  const p = url.pathname;

  if (p === "/api/config") {
    return send(res, 200, {
      chainId: chain.CHAIN_ID,
      rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
      explorer: "https://robinhoodchain.blockscout.com",
      helmCa: HELM_CA,
      buyUrl: HELM_CA ? `https://ponsfamily.com/launchpad/${HELM_CA}` : "https://ponsfamily.com/launchpad",
      treasury: TREASURY,
      feesOn: Boolean(TREASURY),
      tiers: tiers.publicTiers().map((t) => ({ ...t, feeBps: TREASURY ? t.feeBps : 0 })),
      courses: assets.COURSES,
      maxSingleStock: courses.MAX_SINGLE_STOCK,
      assets: assets.MANAGED.map(({ symbol, name, address, decimals, kind }) => ({ symbol, name, address, decimals, kind })),
    });
  }

  if (rateLimited(req)) return send(res, 429, { error: "Too many requests. Wait a minute and try again." });

  if (p === "/api/burns") {
    return send(res, 200, await burns.getBurns(HELM_CA));
  }

  if (p === "/api/waitlist" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "Invalid request." });
    }
    let r;
    try {
      r = await store.addSignup(body || {});
    } catch (err) {
      console.error("Waitlist save failed:", err.message);
      return send(res, 503, { error: "We couldn't save your spot right now. Try again in a minute." });
    }
    return send(res, r.error ? 400 : 200, r);
  }

  if (p === "/api/courses" && req.method === "GET") {
    const address = url.searchParams.get("address") || "";
    if (!ADDR_RE.test(address)) return send(res, 400, { error: "Connect a wallet first." });
    let list = [];
    try {
      list = await courses.listCourses(address);
    } catch (err) {
      console.error("Courses read failed:", err.message);
    }
    return send(res, 200, { courses: list });
  }

  if (p === "/api/courses" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "Invalid request." });
    }
    const address = String(body.address || "");
    if (!ADDR_RE.test(address)) return send(res, 400, { error: "Connect a wallet first." });
    const sigErr = await courses.checkSignature(body);
    if (sigErr) return send(res, 401, { error: sigErr });
    const snap = await snapshot(address);
    const slot = Number(body.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= snap.tier.custom) {
      return send(res, 403, { error: snap.tier.custom ? `Your tier can save ${snap.tier.custom} custom course${snap.tier.custom > 1 ? "s" : ""}.` : "Custom courses unlock at 100,000 $HELM." });
    }
    try {
      if (body.action === "delete") {
        await courses.deleteCourse(address, slot);
        return send(res, 200, { ok: true });
      }
      const v = courses.validateCourse(body);
      if (v.error) return send(res, 400, v);
      await courses.saveCourse(address, slot, v);
      return send(res, 200, { ok: true, course: { id: `custom-${slot}`, slot, ...v } });
    } catch (err) {
      console.error("Course save failed:", err.message);
      return send(res, 503, { error: "Couldn't save your course right now. Try again in a minute." });
    }
  }

  if (p === "/api/portfolio" || p === "/api/plan") {
    const address = url.searchParams.get("address") || "";
    if (!ADDR_RE.test(address)) return send(res, 400, { error: "Connect a wallet first." });
    const snap = await snapshot(address);
    const r = await resolveCourse(address, url.searchParams.get("course") || "steady", snap.tier);
    if (r.error) return send(res, r.status, { ...tierInfo(snap), error: r.error });
    const course = r.course;
    const plan = buildPlan({
      assets: assets.MANAGED,
      balances: snap.balances,
      prices: snap.prices,
      weights: course.weights,
      options: { driftBand: snap.tier.driftBand, feeBps: TREASURY ? snap.tier.feeBps : 0 },
    });
    const out = {
      address,
      ...tierInfo(snap),
      ethForGas: Number(snap.ethRaw / 10n ** 12n) / 1e6,
      course: course.key,
      courseName: course.name,
      totalUsd: plan.totalUsd,
      holdings: plan.holdings,
      maxDrift: plan.maxDrift,
      onCourse: plan.onCourse,
      message: plan.message,
    };
    if (p === "/api/plan") {
      out.trades = plan.trades;
      out.fee = plan.fee ? { ...plan.fee, to: TREASURY } : null;
      out.note = await ai.explainPlan({ courseName: course.name, totalUsd: plan.totalUsd, holdings: plan.holdings, trades: plan.trades });
    }
    return send(res, 200, out);
  }

  if (p === "/api/quote") {
    const address = url.searchParams.get("address") || "";
    const from = assets.BY_SYMBOL[url.searchParams.get("from") || ""];
    const to = assets.BY_SYMBOL[url.searchParams.get("to") || ""];
    const amount = url.searchParams.get("amount") || "";
    if (!ADDR_RE.test(address)) return send(res, 400, { error: "Connect a wallet first." });
    // Only USDG <-> stock swaps on the allowlist. Never a generic proxy.
    if (!from || !to || from === to || (from.kind !== "cash" && to.kind !== "cash")) return send(res, 400, { error: "That trade isn't allowed." });
    if (!/^[1-9][0-9]{0,40}$/.test(amount)) return send(res, 400, { error: "Invalid amount." });

    const snap = await snapshot(address);
    if (BigInt(amount) > (snap.balances[from.symbol] || 0n)) return send(res, 400, { error: `Not enough ${from.symbol} in your wallet for this trade.` });

    const q = new URLSearchParams({
      fromChain: "4663",
      toChain: "4663",
      fromToken: from.address,
      toToken: to.address,
      fromAmount: amount,
      fromAddress: address,
      toAddress: address,
      slippage: "0.005",
      integrator: "helm",
    });
    const r = await fetch(`https://li.quest/v1/quote?${q}`, {
      headers: LIFI_API_KEY ? { "x-lifi-api-key": LIFI_API_KEY } : {},
      signal: AbortSignal.timeout(25000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.transactionRequest) {
      return send(res, 502, { error: `No route for ${from.symbol} to ${to.symbol} right now. ${d.message ? "(" + d.message + ")" : ""}`.trim() });
    }
    const tx = d.transactionRequest;
    if (Number(tx.chainId) !== chain.CHAIN_ID || !ADDR_RE.test(tx.to)) return send(res, 502, { error: "Got an invalid route. Try again." });
    return send(res, 200, {
      from: from.symbol,
      to: to.symbol,
      fromAmount: d.estimate.fromAmount,
      toAmount: d.estimate.toAmount,
      toAmountMin: d.estimate.toAmountMin,
      fromAmountUSD: d.estimate.fromAmountUSD,
      toAmountUSD: d.estimate.toAmountUSD,
      approvalAddress: d.estimate.approvalAddress,
      venue: d.toolDetails ? d.toolDetails.name : d.tool,
      tx: { to: tx.to, data: tx.data, value: tx.value || "0x0", gasLimit: tx.gasLimit },
    });
  }

  return send(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  try {
    if (url.pathname === "/health") return send(res, 200, "ok");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);

    const ext = path.extname(url.pathname);
    if (STATIC[ext]) {
      const file = path.join(PUBLIC, path.basename(url.pathname));
      return fs.readFile(file, (err, buf) => {
        if (err) return send(res, 404, "Not found");
        res.writeHead(200, { "Content-Type": STATIC[ext], "Cache-Control": "public, max-age=86400" });
        res.end(buf);
      });
    }
    const html = url.pathname === "/app" || url.pathname === "/app/" ? appPage : landing;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(html);
  } catch (err) {
    console.error(req.method, url.pathname, err);
    if (res.headersSent) return;
    const upstream = /fetch failed|timeout|RPC|Price source/i.test(String(err && (err.message || err.name)));
    send(res, upstream ? 502 : 500, { error: upstream ? "Couldn't reach Robinhood Chain or the price feed. Try again in a moment." : "Something went wrong on our side. Try again." });
  }
});

server.listen(process.env.PORT || 3000, () => {
  const bot = buyback.start(HELM_CA, () => {});
  console.log(
    `Helm on port ${process.env.PORT || 3000}` +
      ` | CA ${HELM_CA || "not set"}` +
      ` | fees ${TREASURY ? "on, treasury " + TREASURY : "off (set BUYBACK_PRIVATE_KEY)"}` +
      ` | buyback bot ${bot ? "on" : "off"}` +
      ` | AI notes ${ai.enabled() ? "on" : "off"}` +
      ` | MongoDB ${store.configured() ? "on" : "NOT SET (MONGO_URI)"}`
  );
});
