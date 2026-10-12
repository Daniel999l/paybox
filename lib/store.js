// Waitlist storage in MongoDB, collection "waitlist", one document per X handle.
// Connection string comes from MONGO_URI (or MONGODB_URI / MONGO_URL, whichever is set).
const { MongoClient } = require("mongodb");

const URI = (process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || "").trim();
// Database: MONGO_DB if set, else the one named in the URI, else "helm".
let DB_NAME = (process.env.MONGO_DB || "").trim();

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const POST_RE = /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}/i;
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

let collectionPromise = null;
function waitlist() {
  if (!URI) return Promise.reject(new Error("MONGO_URI is not set"));
  if (!collectionPromise) {
    const client = new MongoClient(URI, { serverSelectionTimeoutMS: 8000 });
    collectionPromise = client
      .connect()
      .then(async () => {
        if (!DB_NAME) DB_NAME = client.options.dbName && client.options.dbName !== "test" ? client.options.dbName : "helm";
        const col = client.db(DB_NAME).collection("waitlist");
        await col.createIndex({ handleLower: 1 }, { unique: true });
        await col.createIndex({ ref: 1 });
        return col;
      })
      .catch((err) => {
        collectionPromise = null; // retry on the next request
        throw err;
      });
  }
  return collectionPromise;
}

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
  const col = await waitlist();
  const now = new Date();
  const update = { $set: { handle: v.handle, post: v.post, wallet: v.wallet, updatedAt: now }, $setOnInsert: { createdAt: now } };
  // Keep whoever referred them first; a later visit without a ref doesn't erase it.
  if (v.ref) update.$setOnInsert.ref = v.ref;
  await col.updateOne({ handleLower: v.handleLower }, update, { upsert: true });
  const total = await col.estimatedDocumentCount();
  return { ok: true, total };
}

module.exports = { addSignup, validate, configured: () => Boolean(URI) };
