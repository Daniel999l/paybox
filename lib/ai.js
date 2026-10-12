// Optional AI summary of a rebalance plan via DeepSeek (OpenAI-compatible API).
// Set DEEPSEEK_API_KEY to turn it on. Without it, or if the call fails, the app
// shows the rule-based reasons on each trade and nothing breaks.
const KEY = (process.env.DEEPSEEK_API_KEY || "").trim();
const MODEL = (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();
const BASE = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").trim().replace(/\/$/, "");

const cache = new Map(); // same plan -> same note for 10 minutes

async function explainPlan({ courseName, totalUsd, holdings, trades }) {
  if (!KEY || !trades.length) return "";
  const facts = {
    course: courseName,
    portfolio_usd: Math.round(totalUsd * 100) / 100,
    positions: holdings.map((h) => ({ symbol: h.symbol, now: +(h.weight * 100).toFixed(1), target: +(h.target * 100).toFixed(1) })),
    trades: trades.map((t) => ({ side: t.side, asset: t.side === "sell" ? t.from : t.to, usd: Math.round(t.valueUsd * 100) / 100 })),
  };
  const key = JSON.stringify(facts);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.text;

  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      signal: AbortSignal.timeout(12000),
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 160,
        messages: [
          {
            role: "system",
            content:
              "You are Helm, a portfolio rebalancing agent. In 2 or 3 short plain sentences, explain to the user why these trades bring their portfolio back to its target course. Use only the numbers given. No predictions, no price targets, no advice beyond the plan, no emojis.",
          },
          { role: "user", content: key },
        ],
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
    const d = await res.json();
    const text = String((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "").trim().slice(0, 600);
    cache.set(key, { at: Date.now(), text });
    return text;
  } catch (err) {
    console.warn("AI note skipped:", err.message);
    return "";
  }
}

module.exports = { explainPlan, enabled: () => Boolean(KEY) };
