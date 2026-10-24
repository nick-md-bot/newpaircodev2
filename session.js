const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "paircode";
const COLLECTION = process.env.MONGODB_COLLECTION || "sessions";

let clientPromise = null;

async function getCollection() {
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  if (!clientPromise) {
    clientPromise = new MongoClient(MONGODB_URI).connect().catch((e) => {
      clientPromise = null;
      throw e;
    });
  }
  const client = await clientPromise;
  return client.db(DB_NAME).collection(COLLECTION);
}

function newKey() {
  return crypto.randomBytes(8).toString("hex"); // 16 chars
}

// Save session (creds.json text) in MongoDB, returns { id }
async function create(data) {
  try {
    const col = await getCollection();
    const id = newKey();
    await col.insertOne({ _id: id, content: data, createdAt: new Date() });
    return { id };
  } catch (error) {
    throw new Error(`Error creating document: ${error.message}`);
  }
}

// Read session from MongoDB, returns { content }
async function get(key) {
  try {
    const col = await getCollection();
    const doc = await col.findOne({ _id: String(key) });
    if (!doc) throw new Error("Session not found");
    return { content: doc.content };
  } catch (error) {
    throw new Error(`Error getting document: ${error.message}`);
  }
}

module.exports = { create, get };
