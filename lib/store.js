// Waitlist storage: one JSON line per signup in DATA_DIR/waitlist.jsonl.
// On Railway, attach a volume and set DATA_DIR to its mount path, or signups are lost on redeploy.
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "waitlist.jsonl");

fs.mkdirSync(DATA_DIR, { recursive: true });

// handle (lowercase) -> entry; last write wins so people can edit their details
const entries = new Map();
if (fs.existsSync(FILE)) {
  for (const line of fs.readFileSync(FILE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.handle) entries.set(e.handle.toLowerCase(), e);
    } catch {}
  }
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const POST_RE = /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}/i;
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

function addSignup(input) {
  const handle = String(input.handle || "").replace(/^@/, "").trim();
  const post = String(input.post || "").trim();
  const wallet = String(input.wallet || "").trim();
  const ref = String(input.ref || "").replace(/^@/, "").trim();
  if (!HANDLE_RE.test(handle)) return { error: "Enter a valid X handle." };
  if (!POST_RE.test(post)) return { error: "Paste the link to your post on X." };
  if (wallet && !WALLET_RE.test(wallet)) return { error: "That wallet address isn't valid." };
  const key = handle.toLowerCase();
  const prev = entries.get(key);
  const entry = {
    handle,
    post: post.slice(0, 200),
    wallet,
    ref: HANDLE_RE.test(ref) && ref.toLowerCase() !== key ? ref : prev ? prev.ref : "",
    ts: prev ? prev.ts : new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  entries.set(key, entry);
  fs.appendFileSync(FILE, JSON.stringify(entry) + "\n");
  return { ok: true, position: [...entries.keys()].indexOf(key) + 1, total: entries.size };
}

function referralCounts() {
  const counts = {};
  for (const e of entries.values()) if (e.ref) counts[e.ref.toLowerCase()] = (counts[e.ref.toLowerCase()] || 0) + 1;
  return counts;
}

function toCsv() {
  const counts = referralCounts();
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["joined", "handle", "post", "wallet", "referred_by", "referrals"]];
  for (const e of entries.values()) rows.push([e.ts, e.handle, e.post, e.wallet, e.ref, counts[e.handle.toLowerCase()] || 0]);
  return rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
}

module.exports = { addSignup, toCsv, count: () => entries.size, DATA_DIR };
