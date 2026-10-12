// Custom courses: a holder's own target weights, saved per wallet in MongoDB ("courses").
const { recoverMessageAddress } = require("viem");
const { getDb } = require("./db");
const { BY_SYMBOL } = require("./assets");

const MAX_SINGLE_STOCK = 60; // percent
const SIGN_WINDOW_MS = 10 * 60 * 1000;

function signMessage(address, iso) {
  return `Helm: save my custom courses\nWallet: ${address.toLowerCase()}\nTime: ${iso}`;
}

// Proves the request comes from the wallet owner. Returns an error string or "".
async function checkSignature({ address, time, signature }) {
  const t = Date.parse(time);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > SIGN_WINDOW_MS) return "Signature expired. Save again.";
  if (!/^0x[0-9a-fA-F]+$/.test(String(signature || ""))) return "Missing signature.";
  try {
    const signer = await recoverMessageAddress({ message: signMessage(address, time), signature });
    return signer.toLowerCase() === address.toLowerCase() ? "" : "Signature doesn't match this wallet.";
  } catch {
    return "Couldn't read the signature.";
  }
}

// weights come in as whole percents, e.g. { SPY: 40, NVDA: 30, USDG: 30 }
function validateCourse(input) {
  const name = String(input.name || "").trim().slice(0, 24) || "My course";
  const raw = input.weights && typeof input.weights === "object" ? input.weights : {};
  const weights = {};
  let sum = 0;
  for (const [sym, val] of Object.entries(raw)) {
    const a = BY_SYMBOL[sym];
    if (!a) return { error: `${sym} isn't a Helm asset.` };
    const pct = Number(val);
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) return { error: `Use whole percents for ${sym}.` };
    if (pct === 0) continue;
    if (a.kind === "stock" && pct > MAX_SINGLE_STOCK) return { error: `Keep any single stock at ${MAX_SINGLE_STOCK}% or less.` };
    weights[sym] = pct / 100;
    sum += pct;
  }
  if (sum !== 100) return { error: `Weights add up to ${sum}%. They need to add up to 100%.` };
  if (Object.keys(weights).length < 2) return { error: "Pick at least two assets." };
  return { name, weights };
}

async function listCourses(address) {
  const docs = await (await getDb()).collection("courses").find({ address: address.toLowerCase() }).sort({ slot: 1 }).toArray();
  return docs.map((d) => ({ id: `custom-${d.slot}`, slot: d.slot, name: d.name, weights: d.weights }));
}

async function saveCourse(address, slot, course) {
  await (await getDb())
    .collection("courses")
    .updateOne({ address: address.toLowerCase(), slot }, { $set: { name: course.name, weights: course.weights, updatedAt: new Date() } }, { upsert: true });
}

async function deleteCourse(address, slot) {
  await (await getDb()).collection("courses").deleteOne({ address: address.toLowerCase(), slot });
}

async function getCourse(address, slot) {
  const d = await (await getDb()).collection("courses").findOne({ address: address.toLowerCase(), slot });
  return d ? { name: d.name, weights: d.weights } : null;
}

module.exports = { signMessage, checkSignature, validateCourse, listCourses, saveCourse, deleteCourse, getCourse, MAX_SINGLE_STOCK };
