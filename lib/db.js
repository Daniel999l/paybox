// Shared MongoDB connection. Connection string from MONGO_URI (or MONGODB_URI / MONGO_URL).
const { MongoClient } = require("mongodb");

const URI = (process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL || "").trim();

let dbPromise = null;
function getDb() {
  if (!URI) return Promise.reject(new Error("MONGO_URI is not set"));
  if (!dbPromise) {
    const client = new MongoClient(URI, { serverSelectionTimeoutMS: 8000 });
    dbPromise = client
      .connect()
      .then(async () => {
        // Database: MONGO_DB if set, else the one named in the URI, else "helm".
        const named = client.options.dbName && client.options.dbName !== "test" ? client.options.dbName : "helm";
        const db = client.db((process.env.MONGO_DB || "").trim() || named);
        await Promise.all([
          db.collection("waitlist").createIndex({ handleLower: 1 }, { unique: true }),
          db.collection("waitlist").createIndex({ ref: 1 }),
          db.collection("courses").createIndex({ address: 1, slot: 1 }, { unique: true }),
          db.collection("buybacks").createIndex({ at: -1 }),
        ]);
        return db;
      })
      .catch((err) => {
        dbPromise = null; // retry on the next request
        throw err;
      });
  }
  return dbPromise;
}

module.exports = { getDb, configured: () => Boolean(URI) };
