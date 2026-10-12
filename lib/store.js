// Waitlist storage: MongoDB collection "waitlist", one document per X handle.
const { getDb, configured } = require("./db");

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const POST_RE = /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}/i;
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

function validate(input) {
  const handle = String(input.handle || "").replace(/^@/, "").trim();
  const post = String(input.post || "").trim();
  const wallet = String(input.wallet || "").trim();
  const ref = String(input.ref || "").replace(/^@/, "").trim();
  if (!HANDLE_RE.test(handle)) return { error: "Enter a valid X handle." };
  if (!POST_RE.test(post)) return { error: "Paste the link to your post on X." };
  if (wallet && !WALLET_RE.test(wallet)) return { error: "That wallet address isn't valid." };
  return {
    handle,
    handleLower: handle.toLowerCase(),
    post: post.slice(0, 200),
    wallet,
    ref: HANDLE_RE.test(ref) && ref.toLowerCase() !== handle.toLowerCase() ? ref.toLowerCase() : "",
  };
}

async function addSignup(input) {
  const v = validate(input);
  if (v.error) return v;
  const col = (await getDb()).collection("waitlist");
  const now = new Date();
  const update = { $set: { handle: v.handle, post: v.post, wallet: v.wallet, updatedAt: now }, $setOnInsert: { createdAt: now } };
  // Keep whoever referred them first; a later visit without a ref doesn't erase it.
  if (v.ref) update.$setOnInsert.ref = v.ref;
  await col.updateOne({ handleLower: v.handleLower }, update, { upsert: true });
  const total = await col.estimatedDocumentCount();
  return { ok: true, total };
}

module.exports = { addSignup, validate, configured };
